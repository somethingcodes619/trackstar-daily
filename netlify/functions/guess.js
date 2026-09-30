// netlify/functions/guess.js
// POST /.netlify/functions/guess   { date, roundIdx, guess, playCount, playerId, name }
// Validates a guess server-side so the artist answer is never in the frontend.
// Returns { correct, artist, tier, earned, ... }.
//
// The answer is derived from lib/schedule.js — the SAME seeded pick today.js
// uses — so no database and no drift for *validating* a guess.
//
// If a playerId is attached, this is also the ONLY place a player's score
// is ever written. Each round is scored and appended here, one at a time,
// in order — the client never gets to hand over a final score. See
// applyProgress() below.

const { connectLambda } = require('@netlify/blobs');
const { POOL, pickArtist, scoreFor } = require('./lib/schedule');
const { store, summarizeDay, isValidPlayerId, sanitizeName, shiftDate, blankPlayer } = require('./lib/players');

// Case / space / punctuation insensitive matching.
function normalize(str) {
  return String(str).toLowerCase().replace(/[\s\-'’.!&,()]/g, '');
}

// Accepted alternates / abbreviations, keyed by the POOL `name` (lowercased).
const ALIASES = {
  // Tier 1
  'the beatles':        ['beatles', 'fab four', 'the fab four'],
  'michael jackson':    ['mj', 'king of pop', 'the king of pop', 'mike jackson'],
  'taylor swift':       ['taylor', 'tswift', 't swift', 'tay tay'],
  'queen':              ['freddie mercury and queen'],
  'beyoncé':            ['beyonce', 'queen b', 'queen bey', 'sasha fierce', 'knowles'],
  'drake':              ['aubrey graham', 'champagne papi', 'drizzy'],
  'adele':              ['adele adkins'],
  'elton john':         ['elton', 'reginald dwight', 'sir elton john'],
  // Tier 2
  'coldplay':           ['chris martin and coldplay'],
  'bruno mars':         ['bruno', 'peter hernandez'],
  'the weeknd':         ['weeknd', 'abel tesfaye', 'abel'],
  'billie eilish':      ['billie', 'eilish', 'billie eilish oconnell'],
  'kendrick lamar':     ['kendrick', 'kdot', 'k dot', 'kung fu kenny'],
  'dua lipa':           ['dua'],
  'luke combs':         ['combs'],
  'red hot chili peppers': ['rhcp', 'chili peppers', 'the chili peppers', 'chilli peppers'],
  // Tier 3
  'tame impala':        ['kevin parker'],
  'lana del rey':       ['lana', 'lizzy grant', 'elizabeth grant'],
  'zach bryan':         ['zach bryant', 'bryan'],
  'calvin harris':      ['adam wiles', 'adam richard wiles'],
  'arctic monkeys':     ['the arctic monkeys', 'am', 'alex turner and arctic monkeys'],
  'hozier':             ['andrew hozier byrne', 'andrew hozier-byrne', 'andrew byrne'],
  'kacey musgraves':    ['casey musgraves', 'kacy musgraves', 'kacey'],
  'tyler, the creator': ['tyler the creator', 'tyler', 'tyler okonma', 'wolf haley', 'igor'],
  // Tier 4
  'mac demarco':        ['macdemarco', 'mac', 'vernor winfield mckinnon smith'],
  'phoebe bridgers':    ['pheobe bridgers', 'phoebe', 'bridgers'],
  'kaytranada':         ['kaytra', 'kaytranda', 'louis kevin celestin', 'the celestics'],
  'king gizzard & the lizard wizard': ['king gizzard', 'kglw', 'king gizzard and the lizard wizard', 'gizzard'],
  'sturgill simpson':   ['sturgill', 'johnny blue skies'],
  'big thief':          ['bigthief'],
  'little simz':        ['simz', 'simbi', 'simbiatu ajikawo', 'little simbi'],
  'caroline polachek':  ['caroline polacheck', 'polachek', 'ramona lisa', 'cep'],
  // Tier 5
  'black midi':         ['blackmidi', 'bmbmbm', 'bm'],
  'yaeji':              ['kathy yaeji lee', 'kathy lee'],
  'mj lenderman':       ['jake lenderman', 'lenderman', 'mark jacob lenderman'],
  'sault':              ['salt'],
  'floating points':    ['sam shepherd', 'floatingpoints'],
  'nilüfer yanya':      ['nilufer yanya', 'nilufer', 'nilüfer'],
  'aphex twin':         ['richard d james', 'richard james', 'afx', 'rdj', 'polygon window'],
  'billy woods':        ['woods', 'billywoods'],
  // Tier 6
  'duster':             ['duster band'],
  'alice coltrane':     ['turiya', 'turiyasangitananda', 'alice mcleod', 'swamini turiyasangitananda'],
  'jlin':               ['jerrilynn patton', 'jerrilyn patton'],
  'broadcast':          ['trish keenan', 'broadcast band'],
  'ka':                 ['brownsville ka', 'kaczmarek', 'dr yen lo', 'kane'],
  'fievel is glauque':  ['fievel', 'fievelisglauque'],
  'loraine james':      ['loraine', 'whatever the weather'],
  'sweet trip':         ['sweettrip', 'roberto burgos and valerie cooper'],
};

function isMatch(guess, artist) {
  const g = normalize(guess);
  if (!g) return false;
  if (g === normalize(artist)) return true;
  const aliases = ALIASES[artist.toLowerCase()] || [];
  return aliases.some((a) => normalize(a) === g);
}

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

  const { date, roundIdx, guess, playCount, playerId, name } = body;
  if (!date || roundIdx === undefined || guess === undefined) {
    return resp(400, { error: 'Missing date, roundIdx, or guess' });
  }

  const tier = Number(roundIdx) + 1;
  if (!POOL[tier]) {
    return resp(404, { error: 'Round not found' });
  }

  const artist = pickArtist(date, tier);
  if (!artist) {
    return resp(404, { error: 'No drop for this date' });
  }

  const correct = isMatch(guess, artist.name);
  // Points are computed here, not trusted from the client — a guess can
  // only ever earn what a real playCount of 1-3 on this tier is worth.
  const { earned, playCount: usedPlays } = scoreFor(tier, Number(playCount));

  let persisted = null;
  if (isValidPlayerId(playerId)) {
    try {
      connectLambda(event);
      persisted = await applyProgress({ date, tier, correct, earned, playCount: usedPlays, playerId, name });
    } catch (_) {
      // A Blobs hiccup shouldn't block the round from resolving for the
      // player — it just won't be reflected on the leaderboard this time.
    }
  }

  return resp(200, {
    correct,
    earned: correct ? earned : 0,
    playCount: usedPlays,
    artist: artist.name, // revealed only after a guess is submitted
    tier,
    totalScore: persisted ? persisted.score : undefined,
  });
};

// Records one validated round and returns the day's running summary. Never
// trusts anything from the client except which round this is and whether
// it was correct — both independently verified above.
//
// Design note: this used to be a read-modify-write on one mutable per-day
// doc ("read current progress, is this the next tier?, append, save").
// That raced — two guesses submitted close together could both read the
// state *before* either write landed, so the second one looked "out of
// order" and was silently dropped. Blobs defaults to eventually-consistent
// reads, and forcing strong consistency turned out to need an edge URL
// this runtime doesn't get auto-configured with (it just threw).
//
// So instead: each round is written to its own key, once, via an atomic
// onlyIfNew conditional PUT — no read-before-write, no ordering to race.
// The day's score/tierReached/finished is then *derived* fresh from
// whatever rounds are on record, every time — a pure function of durable
// facts, never mutable state carried forward, so it can't be corrupted by
// a stale read. See summarizeDay() in lib/players.js.
async function applyProgress({ date, tier, correct, earned, playCount, playerId, name }) {
  const rounds = store('rounds');
  const results = store('results');
  const history = store('history');
  const players = store('players');
  const nameClean = sanitizeName(name);

  const roundKey = `${date}/${playerId}/${tier}`;
  const write = await rounds.setJSON(
    roundKey,
    { correct, earned: correct ? earned : 0, playCount },
    { onlyIfNew: true }
  );
  // write.modified === false means this exact tier was already recorded
  // for this player+day (a replay) — harmless, we still recompute below,
  // just won't touch the lifetime aggregate for it again.

  const shouldHaveFinished = !correct || tier === 6;
  let summary = await deriveSummary(rounds, date, playerId);
  // Our own read here can, rarely, still lag our own write by a beat. If
  // we know this exact round should have ended the day but the freshly
  // recomputed summary doesn't agree yet, give it a couple of short
  // retries so the lifetime-aggregate fold-in below isn't skipped.
  for (let i = 0; i < 3 && shouldHaveFinished && !summary.finished; i++) {
    await new Promise((r) => setTimeout(r, 200));
    summary = await deriveSummary(rounds, date, playerId);
  }

  const summaryDoc = { name: nameClean, ...summary, updatedAt: new Date().toISOString() };
  // Two requests can finish out of the order they were sent in (the one
  // sent first isn't guaranteed to be the one that *completes* first), so
  // a plain overwrite here could let an older, less-complete summary land
  // after — and clobber — a newer one. Guard with a monotonic rank so a
  // write can only ever move a day's stored progress forward, never back.
  await Promise.all([
    writeIfProgressed(results, `${date}/${playerId}`, summaryDoc),
    writeIfProgressed(history, `${playerId}/${date}`, summaryDoc),
  ]);

  if (write.modified && summary.finished) {
    const player = (await players.get(playerId, { type: 'json' })) || blankPlayer(nameClean);
    const yesterday = shiftDate(date, -1);
    player.currentStreak = player.lastPlayedDate === yesterday ? player.currentStreak + 1
      : player.lastPlayedDate === date ? player.currentStreak
      : 1;
    player.bestStreak = Math.max(player.bestStreak, player.currentStreak);
    player.lastPlayedDate = date;
    player.bestScore = Math.max(player.bestScore, summary.score);
    player.totalPlayed += 1;
    player.name = nameClean || player.name;
    if (summary.tierReached >= 1) {
      player.wins += 1;
      player.tierCounts[summary.tierReached - 1] = (player.tierCounts[summary.tierReached - 1] || 0) + 1;
    }
    await players.setJSON(playerId, player);
  }

  return summary;
}

async function deriveSummary(rounds, date, playerId) {
  const prefix = `${date}/${playerId}/`;
  const { blobs } = await rounds.list({ prefix });
  const entries = await Promise.all(
    blobs.map(async (b) => [Number(b.key.slice(prefix.length)), await rounds.get(b.key, { type: 'json' })])
  );
  const byTier = {};
  for (const [tier, doc] of entries) if (doc) byTier[tier] = doc;
  return summarizeDay(byTier);
}

// A day's progress only ever moves forward: more tiers cleared, or cleared
// ranking above not-yet-finished. Rank the doc on that scale and skip the
// write if it wouldn't advance the stored value — the guard against two
// concurrent requests' writes landing out of order and the later (but
// staler-computed) one clobbering the more-complete one.
function progressRank(doc) {
  return (doc.tierReached || 0) * 2 + (doc.finished ? 1 : 0);
}
async function writeIfProgressed(blobStore, key, doc) {
  let existing = null;
  try { existing = await blobStore.get(key, { type: 'json' }); } catch (_) { /* treat as absent */ }
  if (existing && progressRank(existing) > progressRank(doc)) return; // would regress — skip
  await blobStore.setJSON(key, doc);
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
