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

  const child = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '4521',
      STORE_FILE: storeFile,
      MODERATOR_KEY: 'test-mod-key',
      NODE_ENV: 'test'
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

    const badPrediction = await post('http://127.0.0.1:4521/api/predictions', {
      ticker: 'AAPL123', direction: 'up', targetPrice: -1, horizonDate: 'not-date', confidence: 2
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(badPrediction.status, 400);

    const bigPayload = await fetch('http://127.0.0.1:4521/api/moderation/appeal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${loginJson.token}` },
      body: JSON.stringify({ banId: 'ban_x', message: 'x'.repeat(50_000) })
    });
    assert.ok([400, 413].includes(bigPayload.status));

    console.log('market-rank api validation test passed');
  } finally {
    child.kill('SIGTERM');
    await wait(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
