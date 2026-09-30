// netlify/functions/stats.js
// GET /.netlify/functions/stats?playerId=...
// A player's real history — streak, best score, win rate, last 7 days,
// weekly scores, and the tier-reached distribution — all derived from
// what guess.js has actually persisted for them.

const { connectLambda } = require('@netlify/blobs');
const { store, isValidPlayerId, utcDate, blankPlayer } = require('./lib/players');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

exports.handler = async (event) => {
  const playerId = event && event.queryStringParameters && event.queryStringParameters.playerId;
  if (!isValidPlayerId(playerId)) {
    return resp(400, { error: 'Invalid playerId' });
  }

  try {
    connectLambda(event);
    const players = store('players');
    const history = store('history');

    const player = (await players.get(playerId, { type: 'json' })) || blankPlayer();

    // Last 7 calendar days (UTC), oldest first, today last.
    const dates = [-6, -5, -4, -3, -2, -1, 0].map((off) => utcDate(off));
    const days = await Promise.all(
      dates.map((d) => history.get(`${playerId}/${d}`, { type: 'json' }))
    );

    const last7 = dates.map((d, i) => {
      const rec = days[i];
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return {
        date: d,
        label: DAY_LABELS[dow],
        played: !!rec,
        won: rec ? rec.tierReached >= 1 : null,
        score: rec ? rec.score : null,
        today: d === utcDate(0),
      };
    });

    const winRate = player.totalPlayed ? Math.round((player.wins / player.totalPlayed) * 100) : 0;

    return resp(200, {
      name: player.name,
      currentStreak: player.currentStreak,
      bestStreak: player.bestStreak,
      totalPlayed: player.totalPlayed,
      winRate,
      bestScore: player.bestScore,
      tierCounts: player.tierCounts,
      last7,
      weeklyScores: last7.map((d) => ({ label: d.label, score: d.score || 0 })),
    });
  } catch (err) {
    return resp(200, { error: String(err), ...blankPlayer(), winRate: 0, tierCounts: [0, 0, 0, 0, 0, 0], last7: [], weeklyScores: [] });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
