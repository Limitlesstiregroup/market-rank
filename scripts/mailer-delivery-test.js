const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

function clearMailerModule() {
  const p = require.resolve('../backend/mailer');
  delete require.cache[p];
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-rank-mailer-'));
  const deadletter = path.join(tempDir, 'deadletter.jsonl');

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  try {
    process.env.EMAIL_DELIVERY_MODE = 'webhook';
    process.env.EMAIL_WEBHOOK_URL = 'https://example.test/webhook';
    process.env.EMAIL_WEBHOOK_TIMEOUT_MS = '2000';
    process.env.EMAIL_WEBHOOK_RETRIES = '2';
    process.env.EMAIL_WEBHOOK_RETRY_BASE_MS = '1';
    delete process.env.EMAIL_DEADLETTER_FILE;

    let attempts = 0;
    global.fetch = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary webhook outage');
      return { ok: true, status: 200, statusText: 'ok', text: async () => '' };
    };

    clearMailerModule();
    let mailer = require('../backend/mailer');
    const retryResult = await mailer.deliverAuthTokenEmail({
      type: 'verify-email',
      to: 'retry@test.com',
      token: 'abc123',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      appBaseUrl: 'https://app.example.test'
    });
    assert.equal(retryResult.mode, 'webhook');
    assert.equal(attempts, 3);

    process.env.EMAIL_DEADLETTER_FILE = deadletter;
    attempts = 0;
    global.fetch = async () => {
      attempts += 1;
      throw new Error('permanent webhook outage');
    };

    clearMailerModule();
    mailer = require('../backend/mailer');
    const deadletterResult = await mailer.deliverAuthTokenEmail({
      type: 'reset-password',
      to: 'deadletter@test.com',
      token: 'xyz789',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      appBaseUrl: 'https://app.example.test'
    });

    assert.equal(deadletterResult.mode, 'webhook-deadletter');
    assert.equal(attempts, 3);
    const lines = fs.readFileSync(deadletter, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 1);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.to, 'deadletter@test.com');
    assert.equal(last.type, 'reset-password');
    assert.ok(last.error.includes('permanent webhook outage'));

    console.log('market-rank mailer delivery test passed');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
    clearMailerModule();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
