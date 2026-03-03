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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rank-auth-recovery-'));
  const storeFile = path.join(tempDir, 'store.json');

  const child = spawn('node', ['backend/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4522', STORE_FILE: storeFile, MODERATOR_KEY: 'test-mod-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await wait(500);

    const register = await post('http://127.0.0.1:4522/api/auth/register', {
      email: 'recover@test.com', password: 'StrongPass123!'
    });
    assert.equal(register.status, 201);

    const verifyReq = await post('http://127.0.0.1:4522/api/auth/email/verify/request', {
      email: 'recover@test.com'
    });
    assert.equal(verifyReq.status, 200);
    const verifyReqJson = await verifyReq.json();
    assert.ok(verifyReqJson.verificationToken);

    const verifyConfirm = await post('http://127.0.0.1:4522/api/auth/email/verify/confirm', {
      token: verifyReqJson.verificationToken
    });
    assert.equal(verifyConfirm.status, 200);

    const login = await post('http://127.0.0.1:4522/api/auth/login', {
      email: 'recover@test.com', password: 'StrongPass123!'
    });
    assert.equal(login.status, 200);
    const loginJson = await login.json();
    assert.equal(loginJson.user.emailVerified, true);

    const resetReq = await post('http://127.0.0.1:4522/api/auth/password/reset/request', {
      email: 'recover@test.com'
    });
    assert.equal(resetReq.status, 200);
    const resetReqJson = await resetReq.json();
    assert.ok(resetReqJson.resetToken);

    const resetConfirm = await post('http://127.0.0.1:4522/api/auth/password/reset/confirm', {
      token: resetReqJson.resetToken,
      newPassword: 'BrandNewPass999!'
    });
    assert.equal(resetConfirm.status, 200);

    const oldSessionUse = await post('http://127.0.0.1:4522/api/predictions', {
      ticker: 'AAPL', direction: 'bull', targetPrice: 300, horizonDate: '2030-01-01', confidence: 0.7
    }, { authorization: `Bearer ${loginJson.token}` });
    assert.equal(oldSessionUse.status, 401);

    const relogin = await post('http://127.0.0.1:4522/api/auth/login', {
      email: 'recover@test.com', password: 'BrandNewPass999!'
    });
    assert.equal(relogin.status, 200);

    console.log('market-rank auth recovery test passed');
  } finally {
    child.kill('SIGTERM');
    await wait(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
