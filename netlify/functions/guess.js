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
  'drake':              ['aubrey graham', 'champagne papi', 'drizzy'],
  'kendrick lamar':     ['kendrick', 'kdot', 'k dot', 'kung fu kenny'],
  'kanye west':         ['ye', 'yeezy', 'kanye'],
  'beyoncé':            ['beyonce', 'queen b', 'sasha fierce'],
  'nicki minaj':        ['nicki', 'onika'],
  'eminem':             ['slim shady', 'marshall mathers', 'em'],
  'j. cole':            ['jcole', 'j cole', 'jermaine cole', 'cole'],
  'travis scott':       ['travis', 'la flame', 'jacques webster', 'cactus jack'],
  'sza':                ['solana rowe', 'solana'],
  'post malone':        ['posty', 'austin post'],
  'doja cat':           ['doja', 'amala'],
  '21 savage':          ['21', 'twenty one savage', 'shéyaa', 'sheyaa'],
  'future':             ['future hendrix', 'nayvadius', 'pluto'],
  'megan thee stallion':['megan', 'meg', 'tina snow', 'hot girl meg'],
  'metro boomin':       ['metro', 'young metro', 'leland wayne'],
  'don toliver':        ['don', 'caleb toliver'],
  'tyler, the creator': ['tyler the creator', 'tyler', 'tyler okonma', 'wolf haley', 'igor'],
  'jid':                ['j.i.d', 'destin route'],
  'kali uchis':         ['kali', 'karly loaiza'],
  'vince staples':      ['vince'],
  'denzel curry':       ['denzel', 'zeltron', 'aquarius killa'],
  'cordae':             ['ybn cordae', 'cordae dunston'],
  'baby keem':          ['keem', 'hykeem carter'],
  'isaiah rashad':      ['zay', 'isaiah'],
  'saba':               ['saba pivot', 'tahj chandler'],
  'ari lennox':         ['ari', 'courtney shanade salter'],
  'earthgang':          ['earth gang', 'olu and wowgr8', 'doctur dot and johnny venus'],
  'little simz':        ['simz', 'simbi', 'simbiatu ajikawo'],
  'freddie gibbs':      ['gibbs', 'freddie', 'big boss rabbit', 'gangsta gibbs'],
  'joey bada$$':        ['joey badass', 'joey bada', 'jozif badmon', 'jo vaughn scott'],
  'mick jenkins':       ['mick'],
  'benny the butcher':  ['benny', 'jeremie pennick', 'the butcher'],
  'mavi':               ['omavi minder'],
  'redveil':            ['red veil', 'marcus morton'],
  'navy blue':          ['sage elsesser', 'navy', 'sage'],
  'maxo':               ['maxo west', 'maxwell allen'],
  'liv.e':              ['live', 'liv e', 'olivia williams'],
  'pink siifu':         ['siifu', 'livingsifu', 'iiye'],
  'akai solo':          ['akai'],
  'mike':               ['dj blackpower', 'michael bonema'],
  'billy woods':        ['woods', 'billywoods'],
  'mach-hommy':         ['mach hommy', 'mach', 'dgaf'],
  'quelle chris':       ['quelle', 'gauntlet'],
  'fatboi sharif':      ['sharif', 'fatboy sharif'],
  'r.a.p. ferreira':    ['rap ferreira', 'milo', 'scallops hotel', 'rory ferreira'],
  'ka':                 ['brownsville ka', 'kaczmarek', 'dr yen lo'],
  'lojii':              ['loji', 'lo-ji'],
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
