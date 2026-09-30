// netlify/functions/leaderboard.js
// GET /.netlify/functions/leaderboard?date=YYYY-MM-DD
// Real scores, pulled from what guess.js has actually persisted — no mock
// data. Falls back to an empty board (never fake names) if Blobs is down.

const { connectLambda, getStore } = require('@netlify/blobs');
const { utcDate } = require('./lib/players');

const TODAY_SCORE_LIMIT = 200;  // bound how many of today's results we'll fetch
const STREAK_LEADER_LIMIT = 200; // bound how many players we'll scan for streaks

exports.handler = async (event) => {
  const qsDate = event && event.queryStringParameters && event.queryStringParameters.date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qsDate || '') ? qsDate : utcDate(0);

  try {
    connectLambda(event);
    const results = getStore('results');
    const players = getStore('players');

    const { blobs } = await results.list({ prefix: `${date}/` });
    const todayKeys = blobs.slice(0, TODAY_SCORE_LIMIT).map((b) => b.key);
    const todayDocs = await Promise.all(todayKeys.map((k) => results.get(k, { type: 'json' })));

    const scores = todayDocs
      .filter(Boolean)
      .map((d, i) => ({
        playerId: todayKeys[i].slice(date.length + 1),
        name: d.name || 'Guest',
        score: d.score || 0,
        tierReached: d.tierReached || 0,
        finished: !!d.finished,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const { blobs: playerBlobs } = await players.list();
    const playerKeys = playerBlobs.slice(0, STREAK_LEADER_LIMIT).map((b) => b.key);
    const playerDocs = await Promise.all(playerKeys.map((k) => players.get(k, { type: 'json' })));

    const streaks = playerDocs
      .filter(Boolean)
      .map((d, i) => ({ playerId: playerKeys[i], name: d.name || 'Guest', currentStreak: d.currentStreak || 0 }))
      .filter((s) => s.currentStreak > 0)
      .sort((a, b) => b.currentStreak - a.currentStreak)
      .slice(0, 5);

    return resp(200, { date, scores, streaks });
  } catch (err) {
    return resp(200, { date, scores: [], streaks: [], error: String(err) });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
