// netlify/functions/lib/schedule.js
// Shared between today.js and guess.js so the daily puzzle can never drift.
// This file lives in a subdirectory, so Netlify does NOT treat it as a function.
//
// The game is a seeded daily: for a given date, each tier deterministically
// picks one artist from POOL. today.js then pulls a random track for that
// artist from the iTunes Search API (30-sec preview, no auth, no key).
// guess.js only needs the artist, which it derives the same way — no API call.

// ─────────────────────────────────────────────────────
// ARTIST POOL  — one bucket per difficulty tier, ALL genres
//   1 = Everyone knows        4 = Deep fan
//   2 = Mainstream            5 = Underground
//   3 = Fan favourite         6 = Scholar level
// Tiers are fame-based, not genre-based: any round can be rock, pop,
// hip-hop, country, EDM, jazz, indie, electronic, etc.
// Each entry: { name, genre, itunesArtistId, region, hint }
// `name` is the accepted answer (see ALIASES in guess.js for alternates).
// `genre` is the clue shown to the player (curated by hand — iTunes'
//   own genre field is far too coarse).
// `hint` must NOT contain the artist's name.
// ─────────────────────────────────────────────────────
const POOL = {
  1: [
    { name: 'The Beatles',    genre: 'Rock',        itunesArtistId: 136975,    region: 'Liverpool, England', hint: 'Four lads from a northern port city who rewrote what a band could be' },
    { name: 'Michael Jackson', genre: 'Pop',        itunesArtistId: 32940,     region: 'Gary, IN',           hint: 'One glove, a moonwalk, and the best-selling album ever pressed' },
    { name: 'Taylor Swift',   genre: 'Pop',         itunesArtistId: 159260351, region: 'Reading, PA',        hint: 'Re-recorded her entire catalogue to own it; toured stadiums for two years' },
    { name: 'Queen',          genre: 'Rock',        itunesArtistId: 3296287,   region: 'London, England',    hint: 'A mock-operatic single with no real chorus that still fills arenas' },
    { name: 'Beyoncé',        genre: 'Pop / R&B',   itunesArtistId: 1419227,   region: 'Houston, TX',        hint: 'Ex-girl-group leader who turned into a one-woman institution' },
    { name: 'Drake',          genre: 'Hip-Hop',     itunesArtistId: 271256,    region: 'Toronto, ON',        hint: 'Teen soap actor who became the streaming era’s default number one' },
    { name: 'Adele',          genre: 'Soul / Pop',  itunesArtistId: 262836961, region: 'Tottenham, London',  hint: 'Names each album after her age and makes the whole planet cry' },
    { name: 'Elton John',     genre: 'Rock / Pop',  itunesArtistId: 54657,     region: 'Pinner, England',    hint: 'Piano, glitter glasses, and a farewell tour that ran for years' },
  ],
  2: [
    { name: 'Coldplay',               genre: 'Alt-Rock',    itunesArtistId: 471744,     region: 'London, England',     hint: 'Stadium-sized melancholy and roughly a ton of confetti per show' },
    { name: 'Bruno Mars',             genre: 'Pop / Funk',  itunesArtistId: 278873078,  region: 'Honolulu, HI',        hint: 'Pompadour, silk suit, and a retro-funk smash with a British producer' },
    { name: 'The Weeknd',             genre: 'R&B / Pop',   itunesArtistId: 479756766,  region: 'Toronto, ON',         hint: 'Uploaded songs anonymously to a blog, ended up headlining the Super Bowl' },
    { name: 'Billie Eilish',          genre: 'Alt-Pop',     itunesArtistId: 1065981054, region: 'Highland Park, LA',    hint: 'Recorded a chart-topping debut in her brother’s bedroom, barely above a whisper' },
    { name: 'Kendrick Lamar',         genre: 'Hip-Hop',     itunesArtistId: 368183298,  region: 'Compton, CA',         hint: 'Has a Pulitzer on the shelf and still enters every GOAT debate' },
    { name: 'Dua Lipa',               genre: 'Dance-Pop',   itunesArtistId: 1031397873, region: 'London, England',     hint: 'Disco-revival hooks and a strict set of "new rules" for the dancefloor' },
    { name: 'Luke Combs',             genre: 'Country',     itunesArtistId: 815635315,  region: 'Asheville, NC',       hint: 'Everyman in a ballcap moving arena country by the truckload' },
    { name: 'Red Hot Chili Peppers',  genre: 'Funk Rock',   itunesArtistId: 889780,     region: 'Los Angeles, CA',     hint: 'Funk-rock lifers who have performed wearing little more than a strategically placed sock' },
  ],
  3: [
    { name: 'Tame Impala',        genre: 'Psych-Pop',   itunesArtistId: 290242959,  region: 'Perth, Australia',   hint: 'Essentially one guy in a home studio drowning everything in phaser' },
    { name: 'Lana Del Rey',       genre: 'Indie Pop',   itunesArtistId: 464296584,  region: 'Lake Placid, NY',    hint: 'Cinematic Americana melancholy, sad girl in a flower crown' },
    { name: 'Zach Bryan',         genre: 'Country',     itunesArtistId: 1436413980, region: 'Oologah, OK',        hint: 'Navy vet who blew up posting raw acoustic songs from his phone' },
    { name: 'Calvin Harris',      genre: 'EDM',         itunesArtistId: 201955086,  region: 'Dumfries, Scotland', hint: 'Stacked supermarket shelves before becoming the highest-paid DJ alive' },
    { name: 'Arctic Monkeys',     genre: 'Indie Rock',  itunesArtistId: 62820413,   region: 'Sheffield, England', hint: 'Went from the fastest-selling UK debut ever to crooning in a space-age lounge' },
    { name: 'Hozier',             genre: 'Indie Soul',  itunesArtistId: 342260741,  region: 'Bray, Ireland',      hint: 'Booming baritone and church-organ blues; wants to be taken to a big chorus' },
    { name: 'Kacey Musgraves',    genre: 'Country / Pop', itunesArtistId: 466044182, region: 'Golden, TX',        hint: 'Rhinestones with a psychedelic streak — country for people who say they hate country' },
    { name: 'Tyler, The Creator', genre: 'Alt-Rap',     itunesArtistId: 420368335,  region: 'Ladera Heights, CA', hint: 'Odd Future ringleader who swapped shock raps for pastel suits' },
  ],
  4: [
    { name: 'Mac DeMarco',                    genre: 'Indie',          itunesArtistId: 501437762,  region: 'Edmonton, Canada',   hint: 'Gap-toothed slacker jangle-pop, a pack of cheap cigarettes always nearby' },
    { name: 'Phoebe Bridgers',                genre: 'Indie Folk',     itunesArtistId: 697833299,  region: 'Pasadena, CA',       hint: 'Skeleton onesie, whisper-to-scream endings, one third of a supergroup' },
    { name: 'KAYTRANADA',                     genre: 'House / Funk',   itunesArtistId: 602382713,  region: 'Montreal, Canada',   hint: 'Haitian-Canadian beatmaker bending house and funk slightly off the grid' },
    { name: 'King Gizzard & The Lizard Wizard', genre: 'Psych Rock',   itunesArtistId: 440629621,  region: 'Melbourne, Australia', hint: 'Aussie band that once released five albums in a year, one of them microtonal' },
    { name: 'Sturgill Simpson',               genre: 'Outlaw Country', itunesArtistId: 569539832,  region: 'Jackson, KY',        hint: 'Country traditionalist who covers Nirvana and feuds with the industry' },
    { name: 'Big Thief',                      genre: 'Indie Folk',     itunesArtistId: 1083255351, region: 'Brooklyn, NY',       hint: 'Ragged, intimate folk-rock built around one singular songwriter' },
    { name: 'Little Simz',                    genre: 'UK Rap',         itunesArtistId: 627674564,  region: 'Islington, London',  hint: 'Self-described introvert with a full orchestra behind her' },
    { name: 'Caroline Polachek',              genre: 'Art Pop',        itunesArtistId: 385592090,  region: 'Greenwich, CT',      hint: 'Ex-Chairlift singer doing gymnastic, keening avant-pop' },
  ],
  5: [
    { name: 'black midi',       genre: 'Experimental Rock', itunesArtistId: 1265994913, region: 'London, England',     hint: 'Math-rock chaos and jazz-school chops, vocals between a yelp and a sermon' },
    { name: 'Yaeji',            genre: 'House',             itunesArtistId: 1087249836, region: 'Queens, NY',          hint: 'Half-whispered bilingual house music made for 4am in Koreatown' },
    { name: 'MJ Lenderman',     genre: 'Alt-Country',       itunesArtistId: 1247728627, region: 'Asheville, NC',       hint: 'Wry Southern slacker-rock; also plays guitar in Wednesday' },
    { name: 'SAULT',            genre: 'Soul / Funk',       itunesArtistId: 771396456,  region: 'London, England',     hint: 'Anonymous collective that drops surprise albums, sometimes free, then vanishes' },
    { name: 'Floating Points',  genre: 'Electronic',        itunesArtistId: 311514259,  region: 'Manchester, England', hint: 'Trained neuroscientist who made an album with a spiritual-jazz saxophone legend' },
    { name: 'Nilüfer Yanya',    genre: 'Indie Rock',        itunesArtistId: 1102497241, region: 'London, England',     hint: 'Scratchy guitar, a saxophone, and a voice stuck happily between genres' },
    { name: 'Aphex Twin',       genre: 'IDM',               itunesArtistId: 39883194,   region: 'Limerick, Ireland',   hint: 'That unsettling grin logo; drill-’n’-bass conjured somewhere in rural Cornwall' },
    { name: 'billy woods',      genre: 'Abstract Hip-Hop',  itunesArtistId: 18117504,   region: 'New York, NY',        hint: 'Never shows his face in photos, runs Backwoodz, one half of Armand Hammer' },
  ],
  6: [
    { name: 'Duster',            genre: 'Slowcore',              itunesArtistId: 47720654,   region: 'San Jose, CA',       hint: '’90s basement four-track haze that teenagers rediscovered on TikTok decades later' },
    { name: 'Alice Coltrane',    genre: 'Spiritual Jazz',        itunesArtistId: 72553,      region: 'Detroit, MI',        hint: 'Harp, Wurlitzer and Vedic devotion; married to a saxophone titan' },
    { name: 'Jlin',              genre: 'Footwork',              itunesArtistId: 978807589,  region: 'Gary, IN',           hint: 'Ex–steel mill worker building brutalist rhythm puzzles out of Chicago footwork' },
    { name: 'Broadcast',         genre: 'Experimental Pop',      itunesArtistId: 39790546,   region: 'Birmingham, England', hint: 'Hauntological retro-futurism fronted by the late Trish Keenan' },
    { name: 'Ka',                genre: 'Hip-Hop',               itunesArtistId: 1016140666, region: 'Brownsville, NY',     hint: 'Was a captain in the FDNY by day, monk-like coke-rap poet by night' },
    { name: 'Fievel Is Glauque', genre: 'Jazz-Pop',              itunesArtistId: 1550180814, region: 'Brussels / NYC',      hint: 'Two-minute songs that cram a whole jazz record’s worth of chord changes' },
    { name: 'Loraine James',     genre: 'Experimental Electronic', itunesArtistId: 1368596163, region: 'London, England',   hint: 'Fractured, tender club music from the glitchy end of the spectrum' },
    { name: 'Sweet Trip',        genre: 'Shoegaze / IDM',        itunesArtistId: 6949189,    region: 'San Francisco, CA',   hint: 'A glitch-flecked dream-pop cult record the internet caught up to 20 years late' },
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
