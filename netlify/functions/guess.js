// netlify/functions/guess.js
// POST /.netlify/functions/guess   { date, roundIdx, guess }
// Validates a guess server-side so the artist answer is never in the frontend.
// Returns { correct, artist, tier }.
//
// The answer is derived from lib/schedule.js — the SAME seeded pick today.js
// uses — so no database and no drift. No external API call needed here.

const { POOL, pickArtist } = require('./lib/schedule');

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

  const { date, roundIdx, guess } = body;
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

  return resp(200, {
    correct: isMatch(guess, artist.name),
    artist: artist.name, // revealed only after a guess is submitted
    tier,
  });
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
