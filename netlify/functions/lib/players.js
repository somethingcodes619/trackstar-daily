// netlify/functions/lib/players.js
// Small shared helpers for the persistence layer (Netlify Blobs).
// Lives in a subdirectory, so Netlify does NOT treat it as a function.

const { getStore } = require('@netlify/blobs');

function store(name) {
  return getStore(name);
}

// Recompute a day's {score, tierReached, finished, cleared} from whatever
// per-round results are on record, in tier order, stopping at the first
// missing or wrong tier. This is deliberately a pure derivation with no
// dependency on write order or timing — see guess.js's applyProgress()
// for why: each round is written once, idempotently, and this is re-run
// from scratch after every write rather than carried forward as mutable
// state, so it can never be corrupted by a stale read racing a write.
function summarizeDay(roundsByTier) {
  let score = 0, tierReached = 0, finished = false, cleared = false;
  for (let tier = 1; tier <= 6; tier++) {
    const r = roundsByTier[tier];
    if (!r) break; // nothing on record at/after this tier yet
    if (!r.correct) { finished = true; break; }
    score += r.earned || 0;
    tierReached = tier;
  }
  if (tierReached === 6) { finished = true; cleared = true; }
  return { score, tierReached, finished, cleared };
}

// The single source of truth for "what has this player scored today":
// read every round on record for them and derive the summary fresh, every
// time. Deliberately NOT cached anywhere — an earlier version wrote a
// snapshot of this back to Blobs after each round, and that snapshot could
// end up permanently stuck if the write happened to be computed from a
// still-converging read, with no later event to ever correct it. The
// rounds themselves (written once, idempotently, never overwritten) are
// the durable fact; everything else is just a read of them.
async function summarizeFromRounds(roundsStore, date, playerId) {
  const prefix = `${date}/${playerId}/`;
  const { blobs } = await roundsStore.list({ prefix });
  const entries = await Promise.all(
    blobs.map(async (b) => [Number(b.key.slice(prefix.length)), await roundsStore.get(b.key, { type: 'json' })])
  );
  const byTier = {};
  for (const [tier, doc] of entries) if (doc) byTier[tier] = doc;
  return summarizeDay(byTier);
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Player IDs are client-generated (crypto.randomUUID()) — just check the
// shape so the keyspace in Blobs can't be used to store arbitrary junk.
function isValidPlayerId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function sanitizeName(name) {
  const s = String(name == null ? '' : name)
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '') // strip control chars
    .slice(0, 24);
  return s || 'Guest';
}

// YYYY-MM-DD, `offsetDays` from today, in UTC — matches how today.js/
// schedule.js key the daily drop, so "today" for the leaderboard always
// agrees with the puzzle's own clock.
function utcDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// `offsetDays` from an arbitrary YYYY-MM-DD, in UTC. Streak math needs "the
// day before the one just played", not "yesterday relative to right now" —
// those only coincide when the round being scored happens to be for today.
function shiftDate(dateStr, offsetDays) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Default shape for a brand-new player's aggregate record.
function blankPlayer(name) {
  return {
    name: sanitizeName(name),
    currentStreak: 0,
    bestStreak: 0,
    lastPlayedDate: null,
    bestScore: 0,
    totalPlayed: 0,
    wins: 0,
    tierCounts: [0, 0, 0, 0, 0, 0], // index 0..5 -> highest tier cleared 1..6
  };
}

module.exports = { store, summarizeDay, summarizeFromRounds, isValidPlayerId, sanitizeName, utcDate, shiftDate, blankPlayer };
