// netlify/functions/player.js
// POST /.netlify/functions/player   { playerId, name }
// Registers (or renames) an anonymous player. Called once on first visit so
// a `players/{playerId}` record exists before they've played anything, and
// again whenever they change their display name.

const { connectLambda, getStore } = require('@netlify/blobs');
const { isValidPlayerId, sanitizeName, blankPlayer } = require('./lib/players');

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
    const players = getStore('players');
    const existing = await players.get(playerId, { type: 'json' });
    const updated = existing
      ? { ...existing, name: sanitizeName(name) }
      : blankPlayer(name);
    await players.setJSON(playerId, updated);
    return resp(200, { ok: true, name: updated.name });
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
