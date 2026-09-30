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
const { store, summarizeFromRounds, isValidPlayerId, sanitizeName } = require('./lib/players');

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

// Records one validated round. Never trusts anything from the client
// except which round this is and whether it was correct — both
// independently verified above.
//
// Design history, because this went through a few wrong turns first:
//  1. A read-modify-write on one mutable per-day doc ("read current
//     progress, is this the next tier?, append, save") raced — two guesses
//     close together could both read the state *before* either write
//     landed, so the second looked "out of order" and was silently
//     dropped. Forcing strong-consistency reads to fix that just threw
//     (this runtime's auto-config has no edge URL for it).
//  2. Switched each round to its own key, written once via an atomic
//     onlyIfNew PUT (still true, below) — durable and race-free. But then
//     a *cached day summary* was written back after computing it, and
//     that write could be computed from a still-converging read and get
//     stuck forever, with nothing to ever re-trigger a correction.
//  3. Dropped the cached summary too — score/tierReached are now always
//     recomputed live from the rounds (summarizeFromRounds, lib/players).
//     But the *lifetime* aggregate (streak, best score) was still a
//     maintained doc, folded in here the moment a day finished — gated on
//     a short retry loop waiting for the day to "look" finished. In
//     production, real convergence for a list() read routinely took much
//     longer than any synchronous HTTP request can afford to wait for, so
//     that fold-in essentially never fired: lifetime stats stayed at zero.
//
// So now: this function only ever writes durable, non-conflicting facts —
// the round itself, and two cheap markers so later reads know where to
// look. No retries, no "is the day finished yet" decision made here at
// all. Lifetime stats are derived the same way a day's score is —
// computePlayerStats() (lib/players.js), called fresh by stats.js and
// leaderboard.js whenever they're actually needed.
async function applyProgress({ date, tier, correct, earned, playCount, playerId, name }) {
  const rounds = store('rounds');
  const roster = store('roster');
  const playerDays = store('playerDays');
  const nameClean = sanitizeName(name);

  const roundKey = `${date}/${playerId}/${tier}`;
  await rounds.setJSON(
    roundKey,
    { correct, earned: correct ? earned : 0, playCount },
    { onlyIfNew: true } // first answer for this tier wins; replays are no-ops
  );

  // Markers only — no numeric snapshot, nothing that can go stale. Both
  // just say "this player has activity on this date"; the actual score is
  // always recomputed live from `rounds` by whoever reads it later.
  await Promise.all([
    roster.setJSON(`${date}/${playerId}`, { name: nameClean }),
    playerDays.setJSON(`${playerId}/${date}`, {}, { onlyIfNew: true }),
  ]);

  return summarizeFromRounds(rounds, date, playerId);
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
