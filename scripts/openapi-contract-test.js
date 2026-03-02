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

function responseDeclared(spec, route, method, status) {
  const op = spec.paths?.[route]?.[method];
  if (!op) return false;
  return Boolean(op.responses?.[String(status)] || op.responses?.default);
}

async function run() {
  const specPath = path.join(__dirname, '..', 'docs', 'openapi.json');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths);

  const requiredRoutes = [
    ['/api/health', 'get'],
    ['/api/metrics', 'get'],
    ['/api/auth/register', 'post'],
    ['/api/auth/login', 'post'],
    ['/api/auth/logout', 'post'],
    ['/api/predictions', 'post'],
    ['/api/moderation/flag', 'post'],
    ['/api/moderation/ban', 'post'],
    ['/api/moderation/appeal', 'post'],
    ['/api/moderation/dashboard', 'get'],
    ['/api/leaderboard', 'get']
  ];

  for (const [route, method] of requiredRoutes) {
    assert.ok(spec.paths[route], `missing route in spec: ${route}`);
    assert.ok(spec.paths[route][method], `missing operation in spec: ${method.toUpperCase()} ${route}`);
    assert.ok(spec.paths[route][method].responses, `missing responses in spec: ${method.toUpperCase()} ${route}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rank-openapi-'));
  const storeFile = path.join(tempDir, 'store.json');

  const child = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4521', STORE_FILE: storeFile, MODERATOR_KEY: 'test-mod-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await wait(500);

    const health = await fetch('http://127.0.0.1:4521/api/health');
    assert.ok(responseDeclared(spec, '/api/health', 'get', health.status));

    const metricsDenied = await fetch('http://127.0.0.1:4521/api/metrics');
    assert.ok(responseDeclared(spec, '/api/metrics', 'get', metricsDenied.status));

    const register = await post('http://127.0.0.1:4521/api/auth/register', {
      email: 'contract@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-contract' });
    assert.ok(responseDeclared(spec, '/api/auth/register', 'post', register.status));

    const login = await post('http://127.0.0.1:4521/api/auth/login', {
      email: 'contract@test.com', password: 'StrongPass123!'
    }, { 'x-device-fingerprint': 'device-contract' });
    const loginJson = await login.json();
    assert.ok(responseDeclared(spec, '/api/auth/login', 'post', login.status));

    const badPrediction = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'BAD1', direction: 'bull', targetPrice: 0, horizonDate: '2000-01-01', confidence: 5
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.ok(responseDeclared(spec, '/api/predictions', 'post', badPrediction.status));

    const goodPrediction = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'MSFT', direction: 'bull', targetPrice: 500, horizonDate: '2027-01-01', confidence: 0.8
    }, { authorization: `Bearer ${loginJson.token}` });
    const goodPredictionJson = await goodPrediction.json();
    assert.ok(responseDeclared(spec, '/api/predictions', 'post', goodPrediction.status));

    const flag = await post('http://127.0.0.1:4521/api/moderation/flag', {
      predictionId: goodPredictionJson.prediction.id,
      reason: 'test flag'
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.ok(responseDeclared(spec, '/api/moderation/flag', 'post', flag.status));

    const ban = await post('http://127.0.0.1:4521/api/moderation/ban', {
      targetUserId: loginJson.user.id,
      reason: 'test ban',
      durationHours: 1
    }, { 'x-moderator-key': 'test-mod-key' });
    const banJson = await ban.json();
    assert.ok(responseDeclared(spec, '/api/moderation/ban', 'post', ban.status));

    const appeal = await post('http://127.0.0.1:4521/api/moderation/appeal', {
      banId: banJson.ban.id,
      message: 'please review'
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.ok(responseDeclared(spec, '/api/moderation/appeal', 'post', appeal.status));

    const moderationDashboard = await fetch('http://127.0.0.1:4521/api/moderation/dashboard', {
      headers: { 'x-moderator-key': 'test-mod-key' }
    });
    assert.ok(responseDeclared(spec, '/api/moderation/dashboard', 'get', moderationDashboard.status));

    const logout = await post('http://127.0.0.1:4521/api/auth/logout', {}, {
      authorization: `Bearer ${loginJson.token}`
    });
    assert.ok(responseDeclared(spec, '/api/auth/logout', 'post', logout.status));

    const leaderboard = await fetch('http://127.0.0.1:4521/api/leaderboard');
    assert.ok(responseDeclared(spec, '/api/leaderboard', 'get', leaderboard.status));

    console.log('market-rank openapi contract test passed');
  } finally {
    child.kill('SIGTERM');
    await wait(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
