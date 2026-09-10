// netlify/functions/lib/schedule.js
// Shared between today.js and guess.js so the daily puzzle can never drift.
// This file lives in a subdirectory, so Netlify does NOT treat it as a function.
//
// The game is a seeded daily: for a given date, each tier deterministically
// picks one artist from POOL. today.js then pulls a random track for that
// artist from the iTunes Search API (30-sec preview, no auth, no key).
// guess.js only needs the artist, which it derives the same way — no API call.

// ─────────────────────────────────────────────────────
// ARTIST POOL  — one bucket per difficulty tier
//   1 = Everyone knows        4 = Deep fan
//   2 = Mainstream            5 = Underground
//   3 = Fan favourite         6 = Scholar level
// Each entry: { name, genre, itunesArtistId, region, hint }
// `name` is the accepted answer (see ALIASES in guess.js for alternates).
// `genre` is the clue shown to the player (iTunes only ever reports
//   "Hip-Hop/Rap", so we curate this by hand for real variety).
// `hint` must NOT contain the artist's name.
// ─────────────────────────────────────────────────────
const POOL = {
  1: [
    { name: 'Drake',            genre: 'Rap',            itunesArtistId: 271256,     region: 'Toronto, ON',      hint: 'Started on a teen soap opera, ended up owning the charts' },
    { name: 'Kendrick Lamar',   genre: 'Conscious Rap',  itunesArtistId: 368183298,  region: 'Compton, CA',      hint: 'Has a Pulitzer on the shelf and still enters every GOAT debate' },
    { name: 'Kanye West',       genre: 'Hip-Hop',        itunesArtistId: 2715720,    region: 'Chicago, IL',      hint: 'Producer turned rap star turned walking headline' },
    { name: 'Beyoncé',          genre: 'Pop / R&B',      itunesArtistId: 1419227,    region: 'Houston, TX',      hint: 'Ex-girl-group leader who became an entire industry' },
    { name: 'Nicki Minaj',      genre: 'Pop-Rap',        itunesArtistId: 278464538,  region: 'Queens, NY',       hint: 'Pink wigs, cartoon alter egos, and a very loud fanbase' },
    { name: 'Eminem',           genre: 'Rap',            itunesArtistId: 111051,     region: 'Detroit, MI',      hint: 'Trailer-park kid who rhymed his way into the Hall of Fame' },
    { name: 'J. Cole',          genre: 'Rap',            itunesArtistId: 73705833,   region: 'Fayetteville, NC', hint: 'Went double platinum with no features and never lets you forget' },
    { name: 'Travis Scott',     genre: 'Trap',           itunesArtistId: 549236696,  region: 'Houston, TX',      hint: 'Auto-tuned ad-libs and a stadium-sized "it’s lit"' },
  ],
  2: [
    { name: 'SZA',                 genre: 'Alt-R&B',       itunesArtistId: 605800394,  region: 'Maplewood, NJ',  hint: 'TDE’s first lady, turning heartbreak into diamond plaques' },
    { name: 'Post Malone',         genre: 'Pop-Rap',       itunesArtistId: 966309175,  region: 'Grapevine, TX',  hint: 'Face tattoos, a country pivot, and a beer sponsorship' },
    { name: 'Doja Cat',            genre: 'Pop-Rap',       itunesArtistId: 830588310,  region: 'Los Angeles, CA', hint: 'Went viral as a cartoon cow, stayed for the pop domination' },
    { name: '21 Savage',           genre: 'Trap',          itunesArtistId: 894820464,  region: 'Atlanta, GA',    hint: 'Deadpan menace over icy Metro Boomin drums' },
    { name: 'Future',              genre: 'Trap',          itunesArtistId: 128050210,  region: 'Atlanta, GA',    hint: 'Wrote the blueprint for melodic, codeine-soaked heartbreak' },
    { name: 'Megan Thee Stallion', genre: 'Southern Rap',  itunesArtistId: 1258989914, region: 'Houston, TX',    hint: 'Hot Girl Summer, with a college degree to match' },
    { name: 'Metro Boomin',        genre: 'Trap',          itunesArtistId: 670534462,  region: 'St. Louis, MO',  hint: 'If Young Metro don’t trust you — the producer tag heard round the world' },
    { name: 'Don Toliver',         genre: 'Melodic Trap',  itunesArtistId: 1237012992, region: 'Houston, TX',    hint: 'Cactus Jack’s woozy crooner with the helium hooks' },
  ],
  3: [
    { name: 'Tyler, The Creator', genre: 'Alt-Rap',         itunesArtistId: 420368335,  region: 'Ladera Heights, CA', hint: 'Odd Future ringleader who traded shock raps for pastel suits' },
    { name: 'JID',                genre: 'Rap',             itunesArtistId: 282841404,  region: 'East Atlanta, GA',  hint: 'Dreamville’s smallest guy with the most syllables per bar' },
    { name: 'Kali Uchis',         genre: 'Alt-R&B',         itunesArtistId: 894731301,  region: 'Alexandria, VA',    hint: 'Bilingual retro-soul with Colombiana glamour' },
    { name: 'Vince Staples',      genre: 'West Coast Rap',  itunesArtistId: 566639154,  region: 'Long Beach, CA',    hint: 'Deadpan comic timing over knocking Def Jam beats' },
    { name: 'Denzel Curry',       genre: 'Rap',             itunesArtistId: 631440154,  region: 'Carol City, FL',    hint: 'Carol City’s punk-rap live wire — ultimate energy' },
    { name: 'Cordae',             genre: 'Rap',             itunesArtistId: 1384072011, region: 'Raleigh, NC',       hint: 'The kid from the YBN crew who out-lyricised the label' },
    { name: 'Baby Keem',          genre: 'Experimental Rap', itunesArtistId: 1413572916, region: 'Las Vegas, NV',    hint: 'Cousin of a certain Pulitzer winner — "top of the morning"' },
    { name: 'Isaiah Rashad',      genre: 'Southern Rap',    itunesArtistId: 605391263,  region: 'Chattanooga, TN',   hint: 'TDE’s laid-back Southern soul, always a little sleepy' },
  ],
  4: [
    { name: 'Saba',              genre: 'Hip-Hop',         itunesArtistId: 1140260329, region: 'West Side, Chicago', hint: 'PIVOT Gang founder who made grief sound gorgeous' },
    { name: 'Ari Lennox',        genre: 'Neo-Soul',        itunesArtistId: 448854570,  region: 'Washington, DC',     hint: 'Dreamville’s velvet-voiced Shea Butter Baby' },
    { name: 'EARTHGANG',         genre: 'Psychedelic Rap', itunesArtistId: 883745032,  region: 'Atlanta, GA',        hint: 'Dreamville duo forever compared to a certain ATL legend pair' },
    { name: 'Little Simz',       genre: 'UK Rap',          itunesArtistId: 627674564,  region: 'Islington, London',  hint: 'Self-described introvert with a full orchestra behind her' },
    { name: 'Freddie Gibbs',     genre: 'Gangsta Rap',     itunesArtistId: 302166615,  region: 'Gary, IN',           hint: 'Gangsta-rap technician who makes albums with Madlib and Alchemist' },
    { name: 'Joey Bada$$',       genre: 'Boom Bap',        itunesArtistId: 577261450,  region: 'Brooklyn, NY',       hint: 'Pro Era kid who raps like it’s still 1995' },
    { name: 'Mick Jenkins',      genre: 'Jazz-Rap',        itunesArtistId: 885270234,  region: 'Chicago, IL',        hint: 'Spoken-word cadence, jazz-soaked beats, lots of water metaphors' },
    { name: 'Benny the Butcher', genre: 'Boom Bap',        itunesArtistId: 1281676587, region: 'Buffalo, NY',        hint: 'Griselda’s coke-rap closer in a fur coat' },
  ],
  5: [
    { name: 'Mavi',       genre: 'Abstract Hip-Hop', itunesArtistId: 1195625355, region: 'Charlotte, NC',            hint: 'Pre-med brain, philosophy-heavy pen, allergic to a wasted bar' },
    { name: 'redveil',    genre: 'Alt-Hip-Hop',      itunesArtistId: 1470333896, region: "Prince George's County, MD", hint: 'Made a full project in his bedroom before he could legally drive' },
    { name: 'Navy Blue',  genre: 'Soulful Hip-Hop',  itunesArtistId: 1490188561, region: 'Los Angeles, CA',          hint: 'Pro skater and Earl affiliate, permanently introspective' },
    { name: 'Maxo',       genre: 'Lo-Fi Hip-Hop',    itunesArtistId: 1439454983, region: 'Los Angeles, CA',          hint: 'Def Jam signee who mostly seems to want to be left alone' },
    { name: 'Liv.e',      genre: 'Alt-R&B',          itunesArtistId: 1492448432, region: 'Dallas, TX',               hint: 'Woozy lo-fi R&B that sounds like a warped cassette' },
    { name: 'Pink Siifu', genre: 'Experimental',     itunesArtistId: 1087355934, region: 'Birmingham, AL',           hint: 'Swings from ambient soul to full noise-punk screaming, same album' },
    { name: 'AKAI SOLO',  genre: 'Abstract Hip-Hop', itunesArtistId: 1083661855, region: 'Brooklyn, NY',             hint: 'Stream-of-consciousness flurries, Backwoodz-adjacent' },
    { name: 'MIKE',       genre: 'Ambient Hip-Hop',  itunesArtistId: 1253023714, region: 'The Bronx, NY',            hint: 'sLUms collective, foggy loops, mumbled wisdom, self-produced as dj blackpower' },
  ],
  6: [
    { name: 'billy woods',     genre: 'Abstract Hip-Hop',     itunesArtistId: 18117504,   region: 'New York, NY',    hint: 'Never shows his face in photos, runs Backwoodz, one half of Armand Hammer' },
    { name: 'Mach-Hommy',      genre: 'Experimental Rap',      itunesArtistId: 768292263,  region: 'Newark, NJ',      hint: 'Sells records for hundreds of dollars and performs in a bandana mask' },
    { name: 'Quelle Chris',    genre: 'Left-Field Hip-Hop',   itunesArtistId: 470208519,  region: 'Detroit, MI',     hint: 'Deadpan surrealist who produces his own off-kilter beats' },
    { name: 'Fatboi Sharif',   genre: 'Experimental Hip-Hop', itunesArtistId: 1406017945, region: 'Rahway, NJ',      hint: 'Horrorcore art-rap — like a haunted house pressed to wax' },
    { name: 'R.A.P. Ferreira', genre: 'Jazz-Rap',             itunesArtistId: 1466149994, region: 'Biddeford, ME',   hint: 'Formerly recorded under a one-word name — jazz-rap koans for lit majors' },
    { name: 'Ka',              genre: 'Hardcore Hip-Hop',     itunesArtistId: 1016140666, region: 'Brownsville, NY',  hint: 'Was a captain in the FDNY by day, monk-like coke-rap poet by night' },
    { name: 'Lojii',           genre: 'Lo-Fi Hip-Hop',        itunesArtistId: 1112271796, region: 'Philadelphia, PA', hint: 'Lo-fi loosie raps, blunted and low-key' },
  ],
};

const TIERS = {
  1: 'Everyone knows this',
  2: 'Mainstream',
  3: 'Fan favourite',
  4: 'Deep fan',
  5: 'Underground',
  6: 'Scholar level',
};

// Optional manual overrides. Map an ISO date to 6 artist names (tier order).
// Names must exist in POOL for that tier. Leave empty for a pure random daily.
const PINNED = {
  // '2026-09-09': ['Drake','SZA','Tyler, The Creator','JID','Saba','billy woods'],
};

// ─────────────────────────────────────────────────────
// Deterministic seeded RNG (xmur3 + mulberry32)
// ─────────────────────────────────────────────────────
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(seed) {
  return mulberry32(xmur3(String(seed))());
}

// Deterministic shuffle of a copy of `arr` for a given seed.
function seededShuffle(arr, seed) {
  const a = arr.slice();
  const rnd = rngFor(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The one true "which artist for this date + tier" function.
function pickArtist(dateStr, tier) {
  const list = POOL[tier];
  if (!list || !list.length) return null;

  const pin = PINNED[dateStr];
  if (pin && pin[tier - 1]) {
    const hit = list.find((a) => a.name === pin[tier - 1]);
    if (hit) return hit;
  }

  const rnd = rngFor(`${dateStr}|tier${tier}|artist`);
  return list[Math.floor(rnd() * list.length)];
}

// Puzzle number: day count since the launch reference date.
const EPOCH_DATE = Date.UTC(2026, 8, 9); // 2026-09-09
const EPOCH_NUMBER = 142;
function dropNumber(dateStr) {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d)) return EPOCH_NUMBER;
  return EPOCH_NUMBER + Math.round((d - EPOCH_DATE) / 86400000);
}

module.exports = {
  POOL, TIERS, PINNED,
  rngFor, seededShuffle, pickArtist, dropNumber,
};
