function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function computeSybilSignals(userId, store) {
  const user = store.users.find((u) => u.id === userId);
  if (!user) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const peers = store.users.filter((u) => u.id !== userId);
  const sharedIp = peers.filter((u) => user.ipHash && u.ipHash === user.ipHash).length;
  const sharedDevice = peers.filter((u) => user.deviceHash && u.deviceHash === user.deviceHash).length;

  if (sharedIp >= 2) {
    score += Math.min(30, sharedIp * 8);
    reasons.push('shared-ip-cluster');
  }
  if (sharedDevice >= 1) {
    score += Math.min(40, sharedDevice * 15);
    reasons.push('shared-device-fingerprint');
  }

  const userPreds = store.predictions.filter((p) => p.userId === userId);
  const shortBurst = userPreds.filter((p) => (Date.now() - new Date(p.createdAt).getTime()) < 60 * 60 * 1000).length;
  if (shortBurst >= 6) {
    score += 20;
    reasons.push('high-frequency-posting-burst');
  }

  if (user.email && /\+\w+@/.test(user.email)) {
    score += 5;
    reasons.push('plus-address-pattern');
  }

  return { score: clamp(score, 0, 100), reasons };
}

function computeUserScore(userId, store, now = new Date()) {
  const preds = store.predictions.filter((p) => p.userId === userId);
  if (!preds.length) return 50;

  const closed = preds.filter((p) => p.status === 'closed');
  const open = preds.filter((p) => p.status === 'open');

  const hitRate = closed.length
    ? closed.filter((p) => p.outcome === 'correct').length / closed.length
    : 0.5;

  const accuracyComponent = hitRate * 60;
  const calibrationComponent = Math.max(0, 15 - Math.abs(0.5 - hitRate) * 20);
  const consistencyComponent = clamp(closed.length / 20, 0, 1) * 15;
  const reliabilityComponent = clamp((closed.length + open.length) / 50, 0, 1) * 10;

  const spamPenalty = preds.filter((p) => p.flagged).length * 2;
  const moderationPenalty = store.moderation
    .filter((m) => m.targetUserId === userId && ['temp_ban', 'perm_ban'].includes(m.action) && m.status !== 'reverted')
    .length * 8;
  const sybilPenalty = Math.round(computeSybilSignals(userId, store, now).score / 8);

  return clamp(Math.round(accuracyComponent + calibrationComponent + consistencyComponent + reliabilityComponent - spamPenalty - moderationPenalty - sybilPenalty), 0, 100);
}

module.exports = { computeUserScore, computeSybilSignals };
