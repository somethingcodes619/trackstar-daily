// netlify/functions/lib/players.js
// Small shared helpers for the persistence layer (Netlify Blobs).
// Lives in a subdirectory, so Netlify does NOT treat it as a function.

const { getStore } = require('@netlify/blobs');

// Every store here is a read-modify-write state machine (scores, streaks,
// "have they already played today") — not a cache. @netlify/blobs defaults
// to eventually-consistent reads, which is exactly wrong for that: two
// guesses submitted moments apart can otherwise race, the second one reads
// a stale "nothing scored yet" and gets treated as out-of-order, and the
// round silently never gets persisted. Force strong consistency everywhere.
function store(name) {
  return getStore({ name, consistency: 'strong' });
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

module.exports = { store, isValidPlayerId, sanitizeName, utcDate, shiftDate, blankPlayer };
