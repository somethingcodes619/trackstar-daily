// netlify/functions/guess.js
// POST /.netlify/functions/guess
// Validates a guess server-side so the artist answer is never in the frontend.
// Returns { correct: bool, artist: string }

// Must match the same SCHEDULE as today.js
// In production, move SCHEDULE to a shared module or database.
const SCHEDULE = [
  {
    date:   '2026-09-09',
    number: 142,
    rounds: [
      { tier:1, artist:'Drake',             genre:'Rap',              era:'2010s', region:'Toronto, ON',       hint:'Blew the whole video budget handing out stacks in Miami'          },
      { tier:2, artist:'SZA',               genre:'Alt-R&B',          era:'2020s', region:'Maplewood, NJ',     hint:'A Tarantino revenge fantasy sung sweet as a lullaby'             },
      { tier:3, artist:'Tyler the Creator', genre:'Alt-Rap',          era:'2010s', region:'Ladera Heights, CA', hint:'Swapped the ski mask for a blond wig and pastel synths'           },
      { tier:4, artist:'JID',               genre:'Rap',              era:'2020s', region:'East Atlanta, GA',   hint:'Dreamville\'s pocket-sized MC stacking syllables like Jenga'      },
      { tier:5, artist:'Saba',              genre:'Hip-Hop',          era:'2020s', region:'West Side, Chicago', hint:'PIVOT Gang poet who turned grief into his prettiest record'       },
      { tier:6, artist:'billy woods',       genre:'Abstract Hip-Hop', era:'2020s', region:'New York, NY',      hint:'Face never in the photo, runs Backwoodz, one half of Armand Hammer' },
    ],
  },
  // Add more dates here to match today.js
];

// Case, space, and punctuation insensitive matching
// "lil wayne", "Lil Wayne", "lil'wayne", "LIL WAYNE" all match
function normalize(str) {
  return str.toLowerCase().replace(/[\s\-''.!&]/g, '');
}

// Also accept common alternate names / abbreviations
const ALIASES = {
  'drake':             ['aubrey graham', 'champagnepapi'],
  'kendrick lamar':    ['kdot', 'k dot'],
  'tyler the creator': ['tyler okonma', 'tyler'],
  'frank ocean':       ['christopher breaux'],
  'kanye west':        ['ye', 'yeezy'],
  'jay-z':             ['jay z', 'jayz', 'shawn carter', 'hov'],
  'the weeknd':        ['abel tesfaye', 'weeknd'],
  'childish gambino':  ['donald glover'],
  'lil wayne':         ['weezy', 'dwayne carter'],
  'eminem':            ['slim shady', 'marshall mathers'],
  'snoop dogg':        ['snoop lion', 'calvin broadus'],
  'chance the rapper': ['chancellor bennett', 'chancelor bennett'],
  'sza':               ['solana rowe'],
  'fka twigs':         ['tahliah barnett'],
};

function isMatch(guess, artist) {
  const normGuess  = normalize(guess);
  const normArtist = normalize(artist);

  if (normGuess === normArtist) return true;

  // Check aliases
  const artistKey = artist.toLowerCase();
  const aliases   = ALIASES[artistKey] || [];
  return aliases.some(alias => normalize(alias) === normGuess);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { date, roundIdx, guess } = body;

  if (!date || roundIdx === undefined || !guess) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing date, roundIdx, or guess' }) };
  }

  const drop = SCHEDULE.find(d => d.date === date);
  if (!drop) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No drop for this date' }) };
  }

  const round = drop.rounds[roundIdx];
  if (!round) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Round not found' }) };
  }

  const correct = isMatch(guess, round.artist);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      correct,
      artist: round.artist, // revealed only after guess is submitted
      tier:   round.tier,
    }),
  };
};
