const fs = require('fs');
const path = require('path');

const DELIVERY_MODE = String(process.env.EMAIL_DELIVERY_MODE || 'stdout').trim().toLowerCase();
const WEBHOOK_URL = String(process.env.EMAIL_WEBHOOK_URL || '').trim();
const OUTBOX_FILE = String(process.env.EMAIL_OUTBOX_FILE || '').trim();
const TOKEN_ECHO = String(process.env.EMAIL_TOKEN_ECHO || (String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'false' : 'true')).trim().toLowerCase() === 'true';

function subjectFor(type) {
  if (type === 'verify-email') return 'Verify your MarketRank email';
  if (type === 'reset-password') return 'Reset your MarketRank password';
  return 'MarketRank notification';
}

function bodyFor({ type, token, expiresAt, appBaseUrl }) {
  const tokenLabel = type === 'verify-email' ? 'verification token' : 'password reset token';
  return {
    text: `Your ${tokenLabel}: ${token}\nExpires at: ${expiresAt}\nApp: ${appBaseUrl}`
  };
}

async function sendViaWebhook(payload) {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`email webhook failed (${response.status}): ${text || response.statusText}`);
  }
}

function sendToOutbox(payload) {
  if (!OUTBOX_FILE) return;
  const resolved = path.resolve(OUTBOX_FILE);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(payload)}\n`);
}

async function deliverAuthTokenEmail({ type, to, token, expiresAt, appBaseUrl }) {
  const payload = {
    kind: 'auth-token',
    type,
    to,
    subject: subjectFor(type),
    ...bodyFor({ type, token, expiresAt, appBaseUrl }),
    token,
    expiresAt,
    createdAt: new Date().toISOString()
  };

  if (DELIVERY_MODE === 'webhook' && WEBHOOK_URL) {
    await sendViaWebhook(payload);
    return { delivered: true, mode: 'webhook' };
  }

  if (DELIVERY_MODE === 'outbox' || OUTBOX_FILE) {
    sendToOutbox(payload);
    return { delivered: true, mode: 'outbox' };
  }

  // default dev-safe behavior: log only
  console.log(JSON.stringify({
    event: 'auth_email_generated',
    mode: 'stdout',
    type,
    to,
    expiresAt
  }));
  return { delivered: true, mode: 'stdout' };
}

module.exports = {
  deliverAuthTokenEmail,
  TOKEN_ECHO
};
