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

const { connectLambda, getStore } = require('@netlify/blobs');
const { POOL, pickArtist, scoreFor } = require('./lib/schedule');
const { isValidPlayerId, sanitizeName, shiftDate, blankPlayer } = require('./lib/players');

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
      persisted = await applyProgress({ date, tier, correct, earned, playerId, name });
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

// Appends one validated round onto the player's day, in order, and — only
// the instant the day actually finishes — folds it into their lifetime
// aggregate (streak, best score, tier distribution). Never trusts anything
// from the client except which round this is and whether it was correct,
// both of which were just independently verified above.
async function applyProgress({ date, tier, correct, earned, playerId, name }) {
  const results = getStore('results');
  const history = getStore('history');
  const players = getStore('players');

  const key = `${date}/${playerId}`;
  const existing = await results.get(key, { type: 'json' });
  const progress = existing || {
    name: sanitizeName(name), score: 0, clearedTiers: [], tierReached: 0,
    finished: false, cleared: false,
  };

  if (progress.finished) return progress; // already resolved — ignore replays

  const expectedTier = progress.clearedTiers.length + 1;
  if (tier !== expectedTier) return progress; // out of order — ignore, don't score

  progress.name = sanitizeName(name) || progress.name;
  if (correct) {
    progress.score += earned;
    progress.clearedTiers.push(tier);
    progress.tierReached = tier;
    if (tier === 6) { progress.finished = true; progress.cleared = true; }
  } else {
    progress.finished = true;
    progress.cleared = false;
  }
  progress.updatedAt = new Date().toISOString();

  await Promise.all([
    results.setJSON(key, progress),
    history.setJSON(`${playerId}/${date}`, progress),
  ]);

  if (progress.finished) {
    const player = (await players.get(playerId, { type: 'json' })) || blankPlayer(progress.name);
    const yesterday = shiftDate(date, -1);
    player.currentStreak = player.lastPlayedDate === yesterday ? player.currentStreak + 1
      : player.lastPlayedDate === date ? player.currentStreak
      : 1;
    player.bestStreak = Math.max(player.bestStreak, player.currentStreak);
    player.lastPlayedDate = date;
    player.bestScore = Math.max(player.bestScore, progress.score);
    player.totalPlayed += 1;
    player.name = progress.name || player.name;
    if (progress.tierReached >= 1) {
      player.wins += 1;
      player.tierCounts[progress.tierReached - 1] = (player.tierCounts[progress.tierReached - 1] || 0) + 1;
    }
    await players.setJSON(playerId, player);
  }

  return progress;
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
