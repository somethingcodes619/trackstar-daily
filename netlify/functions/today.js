// netlify/functions/today.js
// GET /.netlify/functions/today            → today's puzzle
// GET /.netlify/functions/today?date=YYYY-MM-DD  → a specific day (for testing)
//
// Seeded daily: lib/schedule.js decides which artist each tier gets.
// Here we pull a RANDOM track for that artist from the iTunes Search API
// (public, no key, 30-second preview + artwork). The artist name is never
// returned — guessing is validated server-side in guess.js.

const { POOL, TIERS, pickArtist, dropNumber, seededShuffle } = require('./lib/schedule');

// Node 18+ (Netlify default) ships a global fetch; fall back to node-fetch locally.
const fetch = globalThis.fetch
  ? (...a) => globalThis.fetch(...a)
  : (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ─────────────────────────────────────────────────────
// iTunes helpers
// ─────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().replace(/[\s\-'’.!&,()]/g, '');
const JUNK = /karaoke|tribute|originally performed|made famous|\binstrumental\b|\blive\b|live at|live from|sped ?up|slowed|nightcore|8d audio|commentary|a ?cappella|cover version|as made famous/i;

async function itunesJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'trackstar-daily/2.0 (daily music quiz)' } });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return res.json();
}

// Every previewable song we can find for an artist, newest catalog first.
async function artistSongs(artist) {
  let results = [];

  // Primary: catalog lookup by artist id
  try {
    const data = await itunesJson(
      `https://itunes.apple.com/lookup?id=${artist.itunesArtistId}&entity=song&limit=200&country=US`
    );
    results = data.results || [];
  } catch (_) { /* fall through to search */ }

  // Fallback: song search scoped to the artist name
  if (results.filter((r) => r.kind === 'song').length < 4) {
    try {
      const data = await itunesJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(artist.name)}` +
        `&attribute=artistTerm&entity=song&limit=200&country=US`
      );
      results = results.concat(data.results || []);
    } catch (_) { /* ignore */ }
  }

  const wantName = norm(artist.name);
  const byKey = new Map();
  for (const t of results) {
    if (t.wrapperType !== 'track' || t.kind !== 'song' || !t.previewUrl) continue;
    if (norm(t.artistName) !== wantName) continue;                 // primary artist only
    if (JUNK.test(`${t.trackName} ${t.collectionName || ''}`)) continue;
    const key = norm(t.trackName);
    if (!byKey.has(key)) byKey.set(key, t);
  }
  return [...byKey.values()];
}

function tidyGenre(g) {
  if (!g) return 'Hip-Hop';
  return g.replace('Hip-Hop/Rap', 'Hip-Hop').replace('R&B/Soul', 'R&B');
}
function decadeOf(releaseDate) {
  const y = parseInt(String(releaseDate || '').slice(0, 4), 10);
  return y ? `${Math.floor(y / 10) * 10}s` : '';
}

async function buildRound(dateStr, tier) {
  const artist = pickArtist(dateStr, tier);
  const songs = await artistSongs(artist);
  const pick = seededShuffle(songs, `${dateStr}|tier${tier}|track`)[0];

  const round = {
    tier,
    tierLabel: TIERS[tier],
    genre: tidyGenre(pick && pick.primaryGenreName),
    era: pick ? decadeOf(pick.releaseDate) : '',
    region: artist.region,
    hint: artist.hint,
    previewUrl: pick ? pick.previewUrl : null,
    albumArt: pick && pick.artworkUrl100
      ? pick.artworkUrl100.replace('100x100bb', '600x600bb')
      : null,
  };
  return round;
}

// ─────────────────────────────────────────────────────
// Per-day cache (survives warm invocations) so we hit
// iTunes at most once per day per lambda instance.
// ─────────────────────────────────────────────────────
const cache = new Map(); // date -> payload (only cached once fully resolved)

exports.handler = async (event) => {
  const qsDate = event && event.queryStringParameters && event.queryStringParameters.date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qsDate || '')
    ? qsDate
    : new Date().toISOString().split('T')[0];

  if (cache.has(date)) {
    return json(200, cache.get(date), 'HIT', true);
  }

  let rounds;
  try {
    rounds = await Promise.all(
      Object.keys(POOL).map((t) => buildRound(date, Number(t)))
    );
  } catch (err) {
    return json(502, { error: 'Could not build today’s drop', detail: String(err) });
  }

  const payload = { number: dropNumber(date), date, rounds };
  const complete = rounds.every((r) => r.previewUrl);
  if (complete) cache.set(date, payload); // don't cache a partial day

  return json(200, payload, complete ? 'MISS' : 'PARTIAL', complete);
};

function json(statusCode, body, cacheState, cacheable) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // The puzzle only changes once a day, so let the Netlify edge hold a
      // fully-resolved response. Never cache a partial/failed build.
      'Cache-Control': cacheable
        ? 'public, max-age=600, s-maxage=3600'
        : 'no-store',
      'X-Trackstar-Cache': cacheState || 'n/a',
    },
    body: JSON.stringify(body),
  };
}
