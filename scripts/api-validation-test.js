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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rank-validation-'));
  const storeFile = path.join(tempDir, 'store.json');
  const logFile = path.join(tempDir, 'events.log');

  const child = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '4521',
      STORE_FILE: storeFile,
      MODERATOR_KEY: 'test-mod-key',
      NODE_ENV: 'test',
      LOG_FILE: logFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await wait(500);

    const badRegister = await post('http://127.0.0.1:4521/api/auth/register', {
      email: 'invalid', password: 'short'
    });
    assert.equal(badRegister.status, 400);

    const register = await post('http://127.0.0.1:4521/api/auth/register', {
      email: 'valid@test.com', password: 'StrongPass123!'
    });
    assert.equal(register.status, 201);

    const login = await post('http://127.0.0.1:4521/api/auth/login', {
      email: 'valid@test.com', password: 'StrongPass123!'
    });
    assert.equal(login.status, 200);
    const loginJson = await login.json();
    assert.ok(loginJson.session?.expiresAt);

    const badPrediction = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'AAPL123', direction: 'up', targetPrice: -1, horizonDate: 'not-date', confidence: 2
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(badPrediction.status, 400);

    const pastDatePrediction = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'AAPL', direction: 'bull', targetPrice: 150, horizonDate: '2020-01-01', confidence: 0.6
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(pastDatePrediction.status, 400);

    const bigPayload = await fetch('http://127.0.0.1:4521/api/moderation/appeal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${loginJson.token}` },
      body: JSON.stringify({ banId: 'ban_x', message: 'x'.repeat(50_000) })
    });
    assert.ok([400, 413].includes(bigPayload.status));

    const logout = await post('http://127.0.0.1:4521/api/auth/logout', {}, {
      authorization: `Bearer ${loginJson.token}`
    });
    assert.equal(logout.status, 200);

    const afterLogout = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'AAPL', direction: 'bull', targetPrice: 220, horizonDate: '2030-01-01', confidence: 0.7
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(afterLogout.status, 401);

    const metricsDenied = await fetch('http://127.0.0.1:4521/api/metrics');
    assert.equal(metricsDenied.status, 403);

    const metrics = await fetch('http://127.0.0.1:4521/api/metrics', {
      headers: { 'x-moderator-key': 'test-mod-key' }
    });
    assert.equal(metrics.status, 200);
    const metricsJson = await metrics.json();
    assert.ok(metricsJson.requestsTotal >= 1);
    assert.ok(metricsJson.routes['GET /api/metrics']);

    const moderationDashboardDenied = await fetch('http://127.0.0.1:4521/api/moderation/dashboard');
    assert.equal(moderationDashboardDenied.status, 403);

    const moderationDashboard = await fetch('http://127.0.0.1:4521/api/moderation/dashboard', {
      headers: { 'x-moderator-key': 'test-mod-key' }
    });
    assert.equal(moderationDashboard.status, 200);
    const moderationJson = await moderationDashboard.json();
    assert.ok(moderationJson.summary);

    const logContents = fs.readFileSync(logFile, 'utf8');
    assert.ok(logContents.includes('"type":"http_request"'));

    console.log('market-rank api validation test passed');
  } finally {
    child.kill('SIGTERM');
    await wait(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
