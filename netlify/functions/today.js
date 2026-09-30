// netlify/functions/today.js
// GET /.netlify/functions/today            → today's puzzle
// GET /.netlify/functions/today?date=YYYY-MM-DD  → a specific day (for testing)
//
// Seeded daily: lib/schedule.js decides which artist each tier gets.
// Here we pull a RANDOM track for that artist from the iTunes Search API
// (public, no key, 30-second preview + artwork). The artist name is never
// returned — guessing is validated server-side in guess.js.

const { connectLambda } = require('@netlify/blobs');
const { POOL, TIERS, pickArtist, dropNumber, seededShuffle } = require('./lib/schedule');
const { store, isValidPlayerId } = require('./lib/players');

// Node 18+ (Netlify default) ships a global fetch; fall back to node-fetch locally.
const fetch = globalThis.fetch
  ? (...a) => globalThis.fetch(...a)
  : (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ─────────────────────────────────────────────────────
// iTunes helpers
// ─────────────────────────────────────────────────────
const norm = (s) => (s || '').toLowerCase().replace(/[\s\-'’.!&,()]/g, '');

// Alternate cuts we never want to surface — these aren't "the song", they're
// a different version of it (a DJ remix, a sped-up TikTok edit, etc.).
const JUNK = /karaoke|tribute|originally performed|made famous|\binstrumental\b|\blive\b|live at|live from|sped ?up|slowed|nightcore|8d audio|commentary|a ?cappella|cover version|as made famous|\bremix(es)?\b|\bmashup\b|\bvip mix\b|\bextended mix\b|\bacoustic\b|\bdemo\b|\brework\b|\bbootleg\b/i;

// Strip a trailing parenthetical/bracketed qualifier so "Track (2019
// Remaster)", "Track (Single Version)" and "Track (Clean)" all collapse to
// the same underlying song — "Track".
function baseTitle(trackName) {
  return String(trackName || '').replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
}

// Given every release of the same song we found, prefer the plainest one —
// a bare title over any qualified version — so a remaster/edit/alt-version
// never gets played in place of the version people actually recognize.
function pickCanonical(versions) {
  if (versions.length === 1) return versions[0];
  const plain = versions.find((t) => !/[([]/.test(t.trackName));
  if (plain) return plain;
  const remastered = versions.find((t) => /remaster/i.test(t.trackName));
  if (remastered) return remastered;
  return [...versions].sort((a, b) => a.trackName.length - b.trackName.length)[0];
}

async function itunesJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'trackstar-daily/2.0 (daily music quiz)' } });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  return res.json();
}

// Every previewable song we can find for an artist, one canonical version
// per song (see pickCanonical) — no duplicate remasters/remixes/edits.
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
  const seenExact = new Set();
  const candidates = [];
  for (const t of results) {
    if (t.wrapperType !== 'track' || t.kind !== 'song' || !t.previewUrl) continue;
    if (norm(t.artistName) !== wantName) continue;                 // primary artist only
    if (JUNK.test(`${t.trackName} ${t.collectionName || ''}`)) continue;
    const exactKey = norm(t.trackName);
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);
    candidates.push(t);
  }

  // Collapse every release of the same underlying song into one canonical pick.
  const bySong = new Map();
  for (const t of candidates) {
    const key = norm(baseTitle(t.trackName));
    if (!bySong.has(key)) bySong.set(key, []);
    bySong.get(key).push(t);
  }
  return [...bySong.values()].map(pickCanonical);
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
    genre: artist.genre || tidyGenre(pick && pick.primaryGenreName),
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
  const qp = (event && event.queryStringParameters) || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qp.date || '')
    ? qp.date
    : new Date().toISOString().split('T')[0];

  let payload, cacheState, cacheable;
  if (cache.has(date)) {
    payload = cache.get(date); cacheState = 'HIT'; cacheable = true;
  } else {
    let rounds;
    try {
      rounds = await Promise.all(
        Object.keys(POOL).map((t) => buildRound(date, Number(t)))
      );
    } catch (err) {
      return json(502, { error: 'Could not build today’s drop', detail: String(err) });
    }
    payload = { number: dropNumber(date), date, rounds };
    cacheable = rounds.every((r) => r.previewUrl);
    if (cacheable) cache.set(date, payload); // don't cache a partial day
    cacheState = cacheable ? 'MISS' : 'PARTIAL';
  }

  // Per-request only — never folded into the shared cached payload above,
  // since that would leak one player's progress to every other viewer.
  const alreadyPlayed = await lookupAlreadyPlayed(event, date, qp.playerId);
  const body = alreadyPlayed ? { ...payload, alreadyPlayed } : payload;

  // Any request carrying a playerId must never be cached — by a CDN *or*
  // by the requesting browser itself — even on a run where alreadyPlayed
  // comes back empty. A "not played yet" response sitting in the browser's
  // own HTTP cache for up to 10 minutes would keep reporting "not played"
  // long after the player actually finishes, which is exactly backwards.
  return json(200, body, cacheState, cacheable && !qp.playerId);
};

async function lookupAlreadyPlayed(event, date, playerId) {
  if (!isValidPlayerId(playerId)) return null;
  try {
    connectLambda(event);
    const progress = await store('results').get(`${date}/${playerId}`, { type: 'json' });
    if (!progress || !progress.finished) return null;
    return { score: progress.score, tierReached: progress.tierReached, cleared: progress.cleared };
  } catch (_) {
    return null; // Blobs hiccup — just don't report a played-status this time
  }
}

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
