const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.STORE_FILE
  ? path.resolve(process.env.STORE_FILE)
  : path.join(__dirname, 'data', 'store.json');

function normalizeStore(store) {
  const normalized = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(normalized.users)) normalized.users = [];
  if (!Array.isArray(normalized.predictions)) normalized.predictions = [];
  if (!Array.isArray(normalized.moderation)) normalized.moderation = [];
  if (!Array.isArray(normalized.rateLimits)) normalized.rateLimits = [];
  if (!Array.isArray(normalized.appeals)) normalized.appeals = [];
  if (!Array.isArray(normalized.sessions)) normalized.sessions = [];
  if (!Array.isArray(normalized.revokedTokens)) normalized.revokedTokens = [];
  if (!Array.isArray(normalized.emailVerificationTokens)) normalized.emailVerificationTokens = [];
  if (!Array.isArray(normalized.passwordResetTokens)) normalized.passwordResetTokens = [];
  return normalized;
}

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore({}), null, 2));
  }
}

function loadStore() {
  ensureStore();
  return normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore(store), null, 2));
}

module.exports = { loadStore, saveStore, DATA_FILE, normalizeStore };
