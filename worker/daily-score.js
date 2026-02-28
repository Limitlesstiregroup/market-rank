const { loadStore, saveStore } = require('../backend/store');
const { computeUserScore } = require('../backend/scoring');

function runDailyScore(now = new Date()) {
  const store = loadStore();
  for (const user of store.users) {
    user.trustScore = computeUserScore(user.id, store, now);
    user.updatedAt = now.toISOString();
  }
  saveStore(store);
  return { usersScored: store.users.length, at: now.toISOString() };
}

if (require.main === module) {
  const r = runDailyScore();
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { runDailyScore };
