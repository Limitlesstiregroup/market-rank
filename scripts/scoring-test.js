const assert = require('assert');
const { computeSybilSignals, computeUserScore } = require('../backend/scoring');

const store = {
  users: [
    { id: 'u1', email: 'one+1@test.com', ipHash: 'ip-1', deviceHash: 'dev-1' },
    { id: 'u2', email: 'two+1@test.com', ipHash: 'ip-1', deviceHash: 'dev-1' },
    { id: 'u3', email: 'three@test.com', ipHash: 'ip-1', deviceHash: 'dev-3' }
  ],
  predictions: [
    { userId: 'u1', status: 'open', flagged: false, createdAt: new Date().toISOString() },
    { userId: 'u1', status: 'open', flagged: false, createdAt: new Date().toISOString() },
    { userId: 'u1', status: 'open', flagged: false, createdAt: new Date().toISOString() },
    { userId: 'u1', status: 'open', flagged: false, createdAt: new Date().toISOString() },
    { userId: 'u1', status: 'open', flagged: false, createdAt: new Date().toISOString() },
    { userId: 'u1', status: 'open', flagged: true, createdAt: new Date().toISOString() }
  ],
  moderation: [
    { targetUserId: 'u1', action: 'temp_ban', status: 'active' }
  ]
};

const sybil = computeSybilSignals('u1', store);
assert.ok(sybil.score >= 30, 'sybil score should detect clustered accounts');
assert.ok(sybil.reasons.includes('shared-device-fingerprint'));

const trust = computeUserScore('u1', store);
assert.ok(trust < 50, 'trust score should be penalized by sybil/moderation/spam');

console.log('market-rank scoring test passed');
