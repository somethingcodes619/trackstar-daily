// netlify/functions/today.js
// GET /.netlify/functions/today
// Returns today's tiered rounds with audio preview URLs.
// Uses Spotify for tiers 1-2 (mainstream), Audius for tiers 3-6 (deeper cuts).
// The artist answer is NEVER returned here — only sent after a guess via guess.js

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// ─────────────────────────────────────────────────────
// YOUR CURATED DAILY SCHEDULE
// Add one entry per date. Tracks must be pre-verified
// to have a Spotify preview_url or Audius stream URL.
//
// TIER GUIDE:
//   1 = Everyone knows (Drake, Beyoncé, Kendrick, Taylor)
//   2 = Mainstream (SZA, J. Cole, Post Malone, Doja Cat)
//   3 = Fan fave (Tyler, Kali Uchis, JID, Cordae)
//   4 = Deep fan (Saba, Smino, Ari Lennox, Buddy)
//   5 = Underground (Mavi, Armand Hammer, Liv.e)
//   6 = Scholar level (billy woods, MIKE, Lojii)
//
// AUDIO SOURCE:
//   spotifyId — Spotify track ID (30-sec preview, tier 1-2 recommended)
//   audiusId  — Audius track ID  (full stream, tier 3-6 recommended)
//   One of the two is required per round.
// ─────────────────────────────────────────────────────
const SCHEDULE = [
  {
    date:   '2026-09-09',
    number: 142,
    rounds: [
      { tier:1, artist:'Drake',             genre:'Rap',              era:'2010s', region:'Toronto, ON',       hint:'Blew the whole video budget handing out stacks in Miami',          spotifyId:'6DCZcSspjsKoFjzjrWoCdn' }, // God's Plan
      { tier:2, artist:'SZA',               genre:'Alt-R&B',          era:'2020s', region:'Maplewood, NJ',     hint:'A Tarantino revenge fantasy sung sweet as a lullaby',             spotifyId:'1Qrg8KqiBpW07V7PNxwwwL' }, // Kill Bill
      { tier:3, artist:'Tyler the Creator', genre:'Alt-Rap',          era:'2010s', region:'Ladera Heights, CA', hint:'Swapped the ski mask for a blond wig and pastel synths',           spotifyId:'5hVghJ4KaYES3BFUATCYn0' }, // EARFQUAKE
      { tier:4, artist:'JID',               genre:'Rap',              era:'2020s', region:'East Atlanta, GA',   hint:'Dreamville\'s pocket-sized MC stacking syllables like Jenga',      spotifyId:'0cp97b37sFNsdIbQH6po3T' }, // Surround Sound (feat. 21 Savage & Baby Tate)
      { tier:5, artist:'Saba',              genre:'Hip-Hop',          era:'2020s', region:'West Side, Chicago', hint:'PIVOT Gang poet who turned grief into his prettiest record',       spotifyId:'632yrSGGr6F4HQdGVUykBI' }, // Come My Way (feat. Krayzie Bone)
      { tier:6, artist:'billy woods',       genre:'Abstract Hip-Hop', era:'2020s', region:'New York, NY',      hint:'Face never in the photo, runs Backwoodz, one half of Armand Hammer', spotifyId:'1nyWOn19RBU0J9LIzgfNJK' }, // Corinthians (feat. Despot & El-P)
    ],
  },
  // Add more dates below:
  // {
  //   date: '2026-05-13',
  //   number: 143,
  //   rounds: [ ... ]
  // },
];

// ─────────────────────────────────────────────────────
// SPOTIFY — CLIENT CREDENTIALS (server-side only)
// ─────────────────────────────────────────────────────
let spotifyTokenCache = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyTokenCache && Date.now() < spotifyTokenExpiry) return spotifyTokenCache;

  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=client_credentials',
  });
  const data = await res.json();
  spotifyTokenCache  = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyTokenCache;
}

async function getSpotifyPreview(trackId) {
  try {
    const token = await getSpotifyToken();
    const res   = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const track = await res.json();

    let previewUrl = track.preview_url || null;
    const albumArt = track.album?.images?.[1]?.url || null;

    // Spotify stopped populating `preview_url` in the Web API for most
    // client-credentials apps (late 2024). Fall back to the preview URL
    // that Spotify still ships in its public embed player payload.
    if (!previewUrl) {
      previewUrl = await getSpotifyEmbedPreview(trackId);
    }

    return { previewUrl, albumArt };
  } catch {
    return { previewUrl: null, albumArt: null };
  }
}

// Reads `audioPreview.url` from the __NEXT_DATA__ blob on Spotify's own
// oEmbed/embed page — no auth required, same data the website uses.
async function getSpotifyEmbedPreview(trackId) {
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; trackstar-daily/1.0)' },
    });
    if (!res.ok) return null;
    const html  = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    return data?.props?.pageProps?.state?.data?.entity?.audioPreview?.url || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────
// AUDIUS — OPEN API, NO KEY NEEDED
// ─────────────────────────────────────────────────────
async function getAudiusStream(trackId) {
  try {
    // Get a healthy discovery node first
    const nodesRes = await fetch('https://api.audius.co');
    const nodesData = await nodesRes.json();
    const node = nodesData.data?.[0] || 'https://discoveryprovider.audius.co';

    // Get track metadata for album art
    const metaRes  = await fetch(`${node}/v1/tracks/${trackId}?app_name=trackstar-daily`);
    const metaData = await metaRes.json();
    const artwork  = metaData.data?.artwork?.['480x480'] || null;

    // Stream URL — direct 30+ second stream
    const streamUrl = `${node}/v1/tracks/${trackId}/stream?app_name=trackstar-daily`;

    return { previewUrl: streamUrl, albumArt: artwork };
  } catch {
    return { previewUrl: null, albumArt: null };
  }
}

// ─────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────
exports.handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  const drop  = SCHEDULE.find(d => d.date === today);

  if (!drop) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'No drop scheduled for today' }),
    };
  }

  // Resolve audio URLs for each round in parallel
  const rounds = await Promise.all(
    drop.rounds.map(async (r) => {
      let previewUrl = null;
      let albumArt   = null;

      if (r.spotifyId && r.spotifyId !== 'REPLACE_ME') {
        ({ previewUrl, albumArt } = await getSpotifyPreview(r.spotifyId));
      } else if (r.audiusId && r.audiusId !== 'REPLACE_ME') {
        ({ previewUrl, albumArt } = await getAudiusStream(r.audiusId));
      }

      // Return round data — NO artist name
      return {
        tier:       r.tier,
        genre:      r.genre,
        era:        r.era,
        region:     r.region,
        hint:       r.hint,
        previewUrl,
        albumArt,
      };
    })
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      number: drop.number,
      date:   drop.date,
      rounds,
    }),
  };
};
