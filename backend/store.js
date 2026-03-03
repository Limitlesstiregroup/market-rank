const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.STORE_FILE
  ? path.resolve(process.env.STORE_FILE)
  : path.join(__dirname, 'data', 'store.json');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const STORE_BACKEND = String(process.env.STORE_BACKEND || (DATABASE_URL ? 'postgres' : 'file')).trim().toLowerCase();

let pgPool = null;
let pgReady = false;

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

function ensureFileStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore({}), null, 2));
  }
}

function loadFileStore() {
  ensureFileStore();
  return normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

function saveFileStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore(store), null, 2));
}

function getPgPool() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required when STORE_BACKEND=postgres');
  }

  if (!pgPool) {
    // Lazy load so file-mode dev/test does not require pg package unless postgres is enabled.
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const sslMode = String(process.env.PGSSL || '').trim().toLowerCase();
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined
    });
  }
  return pgPool;
}

async function ensurePgSchema(pool) {
  if (pgReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO app_state (id, payload)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify(normalizeStore({}))]);
  pgReady = true;
}

async function loadPgStore() {
  const pool = getPgPool();
  await ensurePgSchema(pool);
  const result = await pool.query('SELECT payload FROM app_state WHERE id = 1 LIMIT 1');
  const payload = result.rows[0]?.payload || {};
  return normalizeStore(payload);
}

async function savePgStore(store) {
  const pool = getPgPool();
  await ensurePgSchema(pool);
  await pool.query(
    `
      INSERT INTO app_state (id, payload, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [JSON.stringify(normalizeStore(store))]
  );
}

async function loadStore() {
  if (STORE_BACKEND === 'postgres') return loadPgStore();
  return loadFileStore();
}

async function saveStore(store) {
  if (STORE_BACKEND === 'postgres') {
    await savePgStore(store);
    return;
  }
  saveFileStore(store);
}

module.exports = {
  loadStore,
  saveStore,
  DATA_FILE,
  normalizeStore,
  STORE_BACKEND
};
