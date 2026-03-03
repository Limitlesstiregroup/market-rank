const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

let server;

async function waitForHealthy(baseURL, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseURL}/api/health`);
      if (res.ok) return;
    } catch (_) {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for API health endpoint');
}

test.beforeAll(async ({ baseURL }) => {
  const repoRoot = path.join(__dirname, '..');
  server = spawn(process.execPath, ['backend/server.js'], {
    cwd: repoRoot,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: '4510',
      ALLOWED_ORIGIN: '*'
    }
  });
  await waitForHealthy(baseURL);
});

test.afterAll(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
});

test('user can register, login, and post a prediction', async ({ request }) => {
  const uid = Date.now();
  const email = `e2e+${uid}@example.com`;
  const password = 'Password123!';

  const register = await request.post('/api/auth/register', {
    data: { email, password }
  });
  expect(register.status()).toBe(201);

  const login = await request.post('/api/auth/login', {
    data: { email, password }
  });
  expect(login.status()).toBe(200);
  const loginBody = await login.json();
  expect(loginBody.token).toBeTruthy();

  const horizonDate = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();
  const post = await request.post('/api/predictions', {
    headers: { authorization: `Bearer ${loginBody.token}` },
    data: {
      ticker: 'AAPL',
      direction: 'bull',
      targetPrice: 250,
      confidence: 0.75,
      horizonDate
    }
  });
  expect(post.status()).toBe(201);

  const leaderboard = await request.get('/api/leaderboard');
  expect(leaderboard.status()).toBe(200);
  const boardBody = await leaderboard.json();
  expect(Array.isArray(boardBody.leaderboard)).toBeTruthy();
  expect(boardBody.leaderboard.some((entry) => entry.email === email)).toBeTruthy();
});
