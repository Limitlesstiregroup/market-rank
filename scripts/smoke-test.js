const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function post(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rank-test-'));
  const storeFile = path.join(tempDir, 'store.json');

  const child = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4520', STORE_FILE: storeFile, MODERATOR_KEY: 'test-mod-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await wait(500);

    const health = await fetch('http://127.0.0.1:4520/api/health');
    const healthJson = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthJson.ok, true);

    const register = await post('http://127.0.0.1:4520/api/auth/register', {
      email: 'flagger@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-a' });
    assert.equal(register.status, 201);

    const targetRegister = await post('http://127.0.0.1:4520/api/auth/register', {
      email: 'target@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-b' });
    assert.equal(targetRegister.status, 201);

    const login = await post('http://127.0.0.1:4520/api/auth/login', {
      email: 'flagger@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-a' });
    const loginJson = await login.json();
    assert.equal(login.status, 200);
    assert.ok(loginJson.token);

    const targetLogin = await post('http://127.0.0.1:4520/api/auth/login', {
      email: 'target@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-b' });
    const targetLoginJson = await targetLogin.json();
    assert.equal(targetLogin.status, 200);

    const pred = await post('http://127.0.0.1:4520/api/predictions', {
      ticker: 'AAPL', direction: 'bull', targetPrice: 250, horizonDate: '2026-12-31', confidence: 0.7
    }, { authorization: `Bearer ${targetLoginJson.token}` });
    const predJson = await pred.json();
    assert.equal(pred.status, 201);
    assert.ok(predJson.prediction.id);

    const flag = await post('http://127.0.0.1:4520/api/moderation/flag', {
      predictionId: predJson.prediction.id,
      reason: 'possible spam'
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(flag.status, 201);

    const ban = await post('http://127.0.0.1:4520/api/moderation/ban', {
      targetUserId: targetLoginJson.user.id,
      reason: 'scam behavior',
      durationHours: 1
    }, { 'x-moderator-key': 'test-mod-key' });
    const banJson = await ban.json();
    assert.equal(ban.status, 201);
    assert.ok(banJson.ban.id);

    const bannedPred = await post('http://127.0.0.1:4520/api/predictions', {
      ticker: 'TSLA', direction: 'bear', targetPrice: 150, horizonDate: '2026-12-31'
    }, { authorization: `Bearer ${targetLoginJson.token}` });
    assert.equal(bannedPred.status, 403);

    const appeal = await post('http://127.0.0.1:4520/api/moderation/appeal', {
      banId: banJson.ban.id,
      message: 'Please review, I fixed this.'
    }, { authorization: `Bearer ${targetLoginJson.token}` });
    assert.equal(appeal.status, 201);

    for (let i = 0; i < 9; i += 1) {
      await post('http://127.0.0.1:4520/api/auth/register', {
        email: `burst${i}@test.com`, password: 'StrongPass123!'
      }, { 'x-forwarded-for': '9.9.9.9' });
    }
    const rateLimited = await post('http://127.0.0.1:4520/api/auth/register', {
      email: 'burst-final@test.com', password: 'StrongPass123!'
    }, { 'x-forwarded-for': '9.9.9.9' });
    assert.equal(rateLimited.status, 429);

    const leaderboard = await fetch('http://127.0.0.1:4520/api/leaderboard');
    const leaderboardJson = await leaderboard.json();
    assert.equal(leaderboard.status, 200);
    assert.ok(Array.isArray(leaderboardJson.leaderboard));

    console.log('market-rank smoke test passed');
  } finally {
    child.kill('SIGTERM');
    await wait(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
