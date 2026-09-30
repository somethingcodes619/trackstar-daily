// netlify/functions/player.js
// POST /.netlify/functions/player   { playerId, name }
// Registers (or renames) an anonymous player. Called once on first visit so
// a `players/{playerId}` record exists before they've played anything, and
// again whenever they change their display name.
//
// The `players` store is deliberately just a name registry — {name} — not
// an aggregate. Streak/best-score/etc. are all derived on read from the
// durable per-round facts (see computePlayerStats in lib/players.js); this
// is the one doc that genuinely needs to just be a mutable "current value"
// (a display name has no ordering invariant to protect), so a plain
// overwrite is exactly right here, unlike anywhere else in this app.

const { connectLambda } = require('@netlify/blobs');
const { store, isValidPlayerId, sanitizeName } = require('./lib/players');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  const { playerId, name } = body;
  if (!isValidPlayerId(playerId)) {
    return resp(400, { error: 'Invalid playerId' });
  }

  try {
    connectLambda(event);
    const cleanName = sanitizeName(name);
    await store('players').setJSON(playerId, { name: cleanName });
    return resp(200, { ok: true, name: cleanName });
  } catch (err) {
    // Blobs hiccup shouldn't block the game from loading — the name just
    // won't have stuck server-side this time.
    return resp(200, { ok: false, detail: String(err) });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
