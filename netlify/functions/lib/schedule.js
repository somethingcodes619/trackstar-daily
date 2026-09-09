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
// Each entry: { name, itunesArtistId, region, hint }
// `name` is the accepted answer (see ALIASES in guess.js for alternates).
// `hint` must NOT contain the artist's name.
// ─────────────────────────────────────────────────────
const POOL = {
  1: [
    { name: 'Drake',            itunesArtistId: 271256,     region: 'Toronto, ON',      hint: 'Started on a teen soap opera, ended up owning the charts' },
    { name: 'Kendrick Lamar',   itunesArtistId: 368183298,  region: 'Compton, CA',      hint: 'Has a Pulitzer on the shelf and still enters every GOAT debate' },
    { name: 'Kanye West',       itunesArtistId: 2715720,    region: 'Chicago, IL',      hint: 'Producer turned rap star turned walking headline' },
    { name: 'Beyoncé',          itunesArtistId: 1419227,    region: 'Houston, TX',      hint: 'Ex-girl-group leader who became an entire industry' },
    { name: 'Nicki Minaj',      itunesArtistId: 278464538,  region: 'Queens, NY',       hint: 'Pink wigs, cartoon alter egos, and a very loud fanbase' },
    { name: 'Eminem',           itunesArtistId: 111051,     region: 'Detroit, MI',      hint: 'Trailer-park kid who rhymed his way into the Hall of Fame' },
    { name: 'J. Cole',          itunesArtistId: 73705833,   region: 'Fayetteville, NC', hint: 'Went double platinum with no features and never lets you forget' },
    { name: 'Travis Scott',     itunesArtistId: 549236696,  region: 'Houston, TX',      hint: 'Auto-tuned ad-libs and a stadium-sized "it’s lit"' },
  ],
  2: [
    { name: 'SZA',                 itunesArtistId: 605800394,  region: 'Maplewood, NJ',  hint: 'TDE’s first lady, turning heartbreak into diamond plaques' },
    { name: 'Post Malone',         itunesArtistId: 966309175,  region: 'Grapevine, TX',  hint: 'Face tattoos, a country pivot, and a beer sponsorship' },
    { name: 'Doja Cat',            itunesArtistId: 830588310,  region: 'Los Angeles, CA', hint: 'Went viral as a cartoon cow, stayed for the pop domination' },
    { name: '21 Savage',           itunesArtistId: 894820464,  region: 'Atlanta, GA',    hint: 'Deadpan menace over icy Metro Boomin drums' },
    { name: 'Future',              itunesArtistId: 128050210,  region: 'Atlanta, GA',    hint: 'Wrote the blueprint for melodic, codeine-soaked heartbreak' },
    { name: 'Megan Thee Stallion', itunesArtistId: 1258989914, region: 'Houston, TX',    hint: 'Hot Girl Summer, with a college degree to match' },
    { name: 'Metro Boomin',        itunesArtistId: 670534462,  region: 'St. Louis, MO',  hint: 'If Young Metro don’t trust you — the producer tag heard round the world' },
    { name: 'Don Toliver',         itunesArtistId: 1237012992, region: 'Houston, TX',    hint: 'Cactus Jack’s woozy crooner with the helium hooks' },
  ],
  3: [
    { name: 'Tyler, The Creator', itunesArtistId: 420368335,  region: 'Ladera Heights, CA', hint: 'Odd Future ringleader who traded shock raps for pastel suits' },
    { name: 'JID',                itunesArtistId: 282841404,  region: 'East Atlanta, GA',  hint: 'Dreamville’s smallest guy with the most syllables per bar' },
    { name: 'Kali Uchis',         itunesArtistId: 894731301,  region: 'Alexandria, VA',    hint: 'Bilingual retro-soul with Colombiana glamour' },
    { name: 'Vince Staples',      itunesArtistId: 566639154,  region: 'Long Beach, CA',    hint: 'Deadpan comic timing over knocking Def Jam beats' },
    { name: 'Denzel Curry',       itunesArtistId: 631440154,  region: 'Carol City, FL',    hint: 'Carol City’s punk-rap live wire — ultimate energy' },
    { name: 'Cordae',             itunesArtistId: 1384072011, region: 'Raleigh, NC',       hint: 'The kid from the YBN crew who out-lyricised the label' },
    { name: 'Baby Keem',          itunesArtistId: 1413572916, region: 'Las Vegas, NV',     hint: 'Cousin of a certain Pulitzer winner — "top of the morning"' },
    { name: 'Isaiah Rashad',      itunesArtistId: 605391263,  region: 'Chattanooga, TN',   hint: 'TDE’s laid-back Southern soul, always a little sleepy' },
  ],
  4: [
    { name: 'Saba',              itunesArtistId: 1140260329, region: 'West Side, Chicago', hint: 'PIVOT Gang founder who made grief sound gorgeous' },
    { name: 'Ari Lennox',        itunesArtistId: 448854570,  region: 'Washington, DC',     hint: 'Dreamville’s velvet-voiced Shea Butter Baby' },
    { name: 'EARTHGANG',         itunesArtistId: 883745032,  region: 'Atlanta, GA',        hint: 'Dreamville duo forever compared to a certain ATL legend pair' },
    { name: 'Little Simz',       itunesArtistId: 627674564,  region: 'Islington, London',  hint: 'Self-described introvert with a full orchestra behind her' },
    { name: 'Freddie Gibbs',     itunesArtistId: 302166615,  region: 'Gary, IN',           hint: 'Gangsta-rap technician who makes albums with Madlib and Alchemist' },
    { name: 'Joey Bada$$',       itunesArtistId: 577261450,  region: 'Brooklyn, NY',       hint: 'Pro Era kid who raps like it’s still 1995' },
    { name: 'Mick Jenkins',      itunesArtistId: 885270234,  region: 'Chicago, IL',        hint: 'Spoken-word cadence, jazz-soaked beats, lots of water metaphors' },
    { name: 'Benny the Butcher', itunesArtistId: 1281676587, region: 'Buffalo, NY',        hint: 'Griselda’s coke-rap closer in a fur coat' },
  ],
  5: [
    { name: 'Mavi',       itunesArtistId: 1195625355, region: 'Charlotte, NC',            hint: 'Pre-med brain, philosophy-heavy pen, allergic to a wasted bar' },
    { name: 'redveil',    itunesArtistId: 1470333896, region: "Prince George's County, MD", hint: 'Made a full project in his bedroom before he could legally drive' },
    { name: 'Navy Blue',  itunesArtistId: 1490188561, region: 'Los Angeles, CA',          hint: 'Pro skater and Earl affiliate, permanently introspective' },
    { name: 'Maxo',       itunesArtistId: 1439454983, region: 'Los Angeles, CA',          hint: 'Def Jam signee who mostly seems to want to be left alone' },
    { name: 'Liv.e',      itunesArtistId: 1492448432, region: 'Dallas, TX',               hint: 'Woozy lo-fi R&B that sounds like a warped cassette' },
    { name: 'Pink Siifu', itunesArtistId: 1087355934, region: 'Birmingham, AL',           hint: 'Swings from ambient soul to full noise-punk screaming, same album' },
    { name: 'AKAI SOLO',  itunesArtistId: 1083661855, region: 'Brooklyn, NY',             hint: 'Stream-of-consciousness flurries, Backwoodz-adjacent' },
    { name: 'MIKE',       itunesArtistId: 1253023714, region: 'The Bronx, NY',            hint: 'sLUms collective, foggy loops, mumbled wisdom, self-produced as dj blackpower' },
  ],
  6: [
    { name: 'billy woods',     itunesArtistId: 18117504,   region: 'New York, NY',    hint: 'Never shows his face in photos, runs Backwoodz, one half of Armand Hammer' },
    { name: 'Mach-Hommy',      itunesArtistId: 768292263,  region: 'Newark, NJ',      hint: 'Sells records for hundreds of dollars and performs in a bandana mask' },
    { name: 'Quelle Chris',    itunesArtistId: 470208519,  region: 'Detroit, MI',     hint: 'Deadpan surrealist who produces his own off-kilter beats' },
    { name: 'Fatboi Sharif',   itunesArtistId: 1406017945, region: 'Rahway, NJ',      hint: 'Horrorcore art-rap — like a haunted house pressed to wax' },
    { name: 'R.A.P. Ferreira', itunesArtistId: 1466149994, region: 'Biddeford, ME',   hint: 'Formerly recorded under a one-word name — jazz-rap koans for lit majors' },
    { name: 'Ka',              itunesArtistId: 1016140666, region: 'Brownsville, NY',  hint: 'Was a captain in the FDNY by day, monk-like coke-rap poet by night' },
    { name: 'Lojii',           itunesArtistId: 1112271796, region: 'Philadelphia, PA', hint: 'Lo-fi loosie raps, blunted and low-key' },
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
