const fs = require('fs');
const path = require('path');

const DELIVERY_MODE = String(process.env.EMAIL_DELIVERY_MODE || 'stdout').trim().toLowerCase();
const WEBHOOK_URL = String(process.env.EMAIL_WEBHOOK_URL || '').trim();
const OUTBOX_FILE = String(process.env.EMAIL_OUTBOX_FILE || '').trim();
const DEADLETTER_FILE = String(process.env.EMAIL_DEADLETTER_FILE || '').trim();
const WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.EMAIL_WEBHOOK_TIMEOUT_MS || 5000));
const WEBHOOK_RETRIES = Math.max(0, Number(process.env.EMAIL_WEBHOOK_RETRIES || 2));
const WEBHOOK_RETRY_BASE_MS = Math.max(100, Number(process.env.EMAIL_WEBHOOK_RETRY_BASE_MS || 500));
const TOKEN_ECHO = String(process.env.EMAIL_TOKEN_ECHO || (String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'false' : 'true')).trim().toLowerCase() === 'true';

function subjectFor(type) {
  if (type === 'verify-email') return 'Verify your MarketRank email';
  if (type === 'reset-password') return 'Reset your MarketRank password';
  return 'MarketRank notification';
}

function bodyFor({ type, token, expiresAt, appBaseUrl }) {
  const tokenLabel = type === 'verify-email' ? 'verification token' : 'password reset token';
  const route = type === 'verify-email' ? '/verify-email' : '/reset-password';
  const actionUrl = `${String(appBaseUrl || '').replace(/\/$/, '')}${route}?token=${encodeURIComponent(token)}`;
  return {
    text: `Your ${tokenLabel}: ${token}\nAction URL: ${actionUrl}\nExpires at: ${expiresAt}\nApp: ${appBaseUrl}`
  };
}

function appendJsonLine(filePath, payload) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(payload)}\n`);
}

async function sendViaWebhook(payload) {
  let lastError = null;
  for (let attempt = 0; attempt <= WEBHOOK_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`email webhook failed (${response.status}): ${text || response.statusText}`);
      }
      clearTimeout(timeout);
      return;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= WEBHOOK_RETRIES) break;
      const delayMs = WEBHOOK_RETRY_BASE_MS * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error('email webhook failed: unknown error');
}

function sendToOutbox(payload) {
  appendJsonLine(OUTBOX_FILE, payload);
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
    try {
      await sendViaWebhook(payload);
      return { delivered: true, mode: 'webhook' };
    } catch (error) {
      const err = {
        ...payload,
        failedAt: new Date().toISOString(),
        error: String(error?.message || error)
      };
      if (DEADLETTER_FILE) {
        appendJsonLine(DEADLETTER_FILE, err);
        console.warn(JSON.stringify({ event: 'auth_email_deadlettered', to, type, error: err.error }));
        return { delivered: false, mode: 'webhook-deadletter' };
      }
      throw error;
    }
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
