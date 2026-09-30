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

const BLANK_STATS = {
  currentStreak: 0, bestStreak: 0, bestScore: 0, totalPlayed: 0, wins: 0,
  tierCounts: [0, 0, 0, 0, 0, 0], // index 0..5 -> highest tier cleared 1..6
};

// A player's lifetime stats — streak, best score, tier distribution — are
// derived the same way a single day's score is: read the durable facts,
// compute fresh, never trust a pre-written snapshot. An earlier version
// tried to maintain this as a running total in a `players` doc, updated
// the moment a day finished. In production that update needed to read
// back "did this day actually finish", and real Blobs list()/get()
// convergence turned out to routinely take much longer than any
// synchronous HTTP request can afford to retry for — so the fold-in
// almost never fired, and lifetime stats just silently stayed at zero.
//
// `playerDays/{playerId}/{date}` is a cheap marker (written once per day
// played, see guess.js) that lets this enumerate which dates to look at
// without scanning the whole `rounds` store. Each of those days' actual
// score/tierReached is then recomputed via summarizeFromRounds(), exactly
// as leaderboard.js and today.js already do.
async function computePlayerStats(playerId, { maxDays = 400 } = {}) {
  const days = store('playerDays');
  const rounds = store('rounds');

  const prefix = `${playerId}/`;
  const { blobs } = await days.list({ prefix });
  const dates = blobs.map((b) => b.key.slice(prefix.length)).sort().slice(-maxDays);

  const summaries = await Promise.all(dates.map((d) => summarizeFromRounds(rounds, d, playerId)));
  const finished = dates
    .map((date, i) => ({ date, summary: summaries[i] }))
    .filter((x) => x.summary.finished);

  const stats = { ...BLANK_STATS, tierCounts: [0, 0, 0, 0, 0, 0] };
  stats.totalPlayed = finished.length;
  for (const { summary } of finished) {
    stats.bestScore = Math.max(stats.bestScore, summary.score);
    if (summary.tierReached >= 1) {
      stats.wins += 1;
      stats.tierCounts[summary.tierReached - 1] += 1;
    }
  }

  const finishedDates = new Set(finished.map((x) => x.date));
  let cursor = utcDate(0);
  if (!finishedDates.has(cursor)) cursor = shiftDate(cursor, -1); // today not finished yet still counts yesterday's streak
  while (finishedDates.has(cursor)) { stats.currentStreak += 1; cursor = shiftDate(cursor, -1); }

  let run = 0, prev = null;
  for (const d of [...finishedDates].sort()) {
    run = prev && shiftDate(prev, 1) === d ? run + 1 : 1;
    stats.bestStreak = Math.max(stats.bestStreak, run);
    prev = d;
  }

  return stats;
}

module.exports = {
  store, summarizeDay, summarizeFromRounds, computePlayerStats,
  isValidPlayerId, sanitizeName, utcDate, shiftDate,
};
