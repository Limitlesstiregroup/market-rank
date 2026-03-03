const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { loadStore, saveStore } = require('./store');
const { computeUserScore, computeSybilSignals } = require('./scoring');

const port = Number(process.env.PORT || 4510);
const WEB_FILE = path.join(__dirname, '..', 'web', 'index.html');
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 24 * 7));
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me';
const JWT_ISSUER = process.env.JWT_ISSUER || 'market-rank';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'market-rank-api';
const MODERATOR_KEY = process.env.MODERATOR_KEY || 'dev-moderator-key';
const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 16 * 1024);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, 'data', 'events.log');
const ALERT_5XX_THRESHOLD = Math.max(1, Number(process.env.ALERT_5XX_THRESHOLD || 5));
const MAX_SESSIONS_PER_USER = Math.max(1, Number(process.env.MAX_SESSIONS_PER_USER || 5));
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const REDIS_SESSION_PREFIX = String(process.env.REDIS_SESSION_PREFIX || 'market-rank').trim() || 'market-rank';
const REDIS_ENABLED = Boolean(REDIS_URL);

let redisClient = null;
let redisConnectPromise = null;

if (NODE_ENV === 'production' && JWT_SECRET === 'dev-insecure-jwt-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production');
}

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

function tokenHash(value) {
  return hash(`token:${String(value || '')}`);
}

function isRevoked(store, tokenOrJti) {
  if (!tokenOrJti) return false;
  const h = tokenHash(tokenOrJti);
  return store.revokedTokenHashes.includes(h) || store.revokedTokens.includes(tokenOrJti);
}

async function getRedisClient() {
  if (!REDIS_ENABLED) return null;
  if (!redisClient) {
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('[redis] error', err?.message || err));
  }
  if (!redisClient.isOpen) {
    if (!redisConnectPromise) {
      redisConnectPromise = redisClient.connect().finally(() => {
        redisConnectPromise = null;
      });
    }
    await redisConnectPromise;
  }
  return redisClient;
}

function redisKey(suffix) {
  return `${REDIS_SESSION_PREFIX}:${suffix}`;
}

async function redisIsRevoked(tokenOrJti) {
  if (!tokenOrJti || !REDIS_ENABLED) return false;
  const client = await getRedisClient();
  return Boolean(await client.exists(redisKey(`revoked:${tokenHash(tokenOrJti)}`)));
}

async function redisRevokeTokenValue(tokenOrJti, ttlSec = SESSION_TTL_HOURS * 60 * 60) {
  if (!tokenOrJti || !REDIS_ENABLED) return;
  const client = await getRedisClient();
  await client.set(redisKey(`revoked:${tokenHash(tokenOrJti)}`), '1', { EX: Math.max(60, ttlSec) });
}

async function redisStoreSessionRecord(sessionRecord) {
  if (!REDIS_ENABLED) return;
  const client = await getRedisClient();
  const now = Date.now();
  const expiresAtMs = Date.parse(String(sessionRecord.expiresAt || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return;
  const ttlSec = Math.max(1, Math.ceil((expiresAtMs - now) / 1000));
  const sessionKey = redisKey(`session:${sessionRecord.sid}:${sessionRecord.jti}`);
  const userSetKey = redisKey(`user-sessions:${sessionRecord.userId}`);
  await client.set(sessionKey, JSON.stringify(sessionRecord), { EX: ttlSec });
  await client.zAdd(userSetKey, { score: Date.parse(sessionRecord.createdAt || new Date().toISOString()), value: `${sessionRecord.sid}:${sessionRecord.jti}` });
  await client.expire(userSetKey, Math.max(ttlSec, SESSION_TTL_HOURS * 60 * 60));

  const count = await client.zCard(userSetKey);
  const overflow = Math.max(0, count - MAX_SESSIONS_PER_USER);
  if (overflow > 0) {
    const stale = await client.zRange(userSetKey, 0, overflow - 1);
    if (stale.length) {
      await client.zRem(userSetKey, stale);
      for (const member of stale) {
        await client.del(redisKey(`session:${member}`));
      }
    }
  }
}

async function redisRemoveSessionRecord({ sid, jti }) {
  if (!REDIS_ENABLED || !sid || !jti) return;
  const client = await getRedisClient();
  await client.del(redisKey(`session:${sid}:${jti}`));
}

async function redisGetSessionRecord({ sid, jti }) {
  if (!REDIS_ENABLED || !sid || !jti) return null;
  const client = await getRedisClient();
  const raw = await client.get(redisKey(`session:${sid}:${jti}`));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisListUserSessions(userId) {
  if (!REDIS_ENABLED || !userId) return [];
  const client = await getRedisClient();
  const members = await client.zRange(redisKey(`user-sessions:${userId}`), 0, -1);
  if (!members.length) return [];
  const sessions = [];
  for (const member of members) {
    const [sid, jti] = String(member).split(':');
    if (!sid || !jti) continue;
    const entry = await redisGetSessionRecord({ sid, jti });
    if (entry) sessions.push(entry);
  }
  return sessions;
}

function revokeTokenValue(store, tokenOrJti) {
  if (!tokenOrJti) return;
  const h = tokenHash(tokenOrJti);
  if (!store.revokedTokenHashes.includes(h)) store.revokedTokenHashes.push(h);
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  const safeExpected = Buffer.from(expected);
  const safeActual = Buffer.from(signature || '');
  if (safeExpected.length !== safeActual.length || !crypto.timingSafeEqual(safeExpected, safeActual)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (!payload || payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) * 1000 <= Date.now()) return null;
    if (!payload.sub || !payload.jti || !payload.sid) return null;
    return payload;
  } catch {
    return null;
  }
}

const metrics = {
  startedAt: new Date().toISOString(),
  requestsTotal: 0,
  requestsByStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  requestsByRoute: {},
  recent5xx: []
};

function ensureLogDir() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function logEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

function statusClass(statusCode) {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  return '2xx';
}

function noteRequestMetric(routeKey, statusCode, durationMs) {
  metrics.requestsTotal += 1;
  const cls = statusClass(statusCode);
  metrics.requestsByStatusClass[cls] += 1;
  if (!metrics.requestsByRoute[routeKey]) {
    metrics.requestsByRoute[routeKey] = { count: 0, errors5xx: 0, avgDurationMs: 0 };
  }

  const routeMetric = metrics.requestsByRoute[routeKey];
  routeMetric.count += 1;
  routeMetric.avgDurationMs = Number((((routeMetric.avgDurationMs * (routeMetric.count - 1)) + durationMs) / routeMetric.count).toFixed(2));
  if (statusCode >= 500) {
    routeMetric.errors5xx += 1;
    metrics.recent5xx.push(Date.now());
    metrics.recent5xx = metrics.recent5xx.filter((t) => Date.now() - t <= 60 * 1000);
    if (metrics.recent5xx.length >= ALERT_5XX_THRESHOLD) {
      console.warn(`[alert] high 5xx rate: ${metrics.recent5xx.length} in last 60s`);
    }
  }
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;");
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization,x-moderator-key,x-device-fingerprint');
}

function json(res, status, data) {
  setSecurityHeaders(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

function isTicker(v) {
  return /^[A-Z]{1,8}$/.test(String(v || '').trim().toUpperCase());
}

function isIsoDate(v) {
  const ms = Date.parse(String(v || ''));
  return Number.isFinite(ms);
}

function isFutureDate(v) {
  const ms = Date.parse(String(v || ''));
  return Number.isFinite(ms) && ms > Date.now();
}

function sanitizeText(v, max = 500) {
  return String(v || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      d += c;
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('payload_too_large'));
      if (!d) return resolve({});
      try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function getDeviceFingerprint(req) {
  const raw = String(req.headers['x-device-fingerprint'] || '').trim();
  return raw ? hash(raw) : null;
}

function purgeExpiredSessions(store, now = Date.now()) {
  store.sessions = store.sessions.filter((session) => {
    const expiresAtMs = Date.parse(String(session.expiresAt || ''));
    return Number.isFinite(expiresAtMs) && expiresAtMs > now;
  });
}

function issueSession(store, userId, now = Date.now()) {
  const sid = id('sid');
  const jti = id('jti');
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const payload = {
    sub: userId,
    sid,
    jti,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + SESSION_TTL_MS) / 1000),
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE
  };
  const token = signToken(payload);
  const createdAt = new Date(now).toISOString();
  const userSessions = store.sessions
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  const overflow = Math.max(0, (userSessions.length + 1) - MAX_SESSIONS_PER_USER);
  if (overflow > 0) {
    const pruneKeys = new Set(userSessions.slice(0, overflow).map((entry) => `${entry.sid}:${entry.jti}`));
    store.sessions = store.sessions.filter((entry) => !pruneKeys.has(`${entry.sid}:${entry.jti}`));
  }
  store.sessions.push({ sid, jti, userId, createdAt, expiresAt });
  return { token, expiresAt, sid, jti, createdAt };
}

function createOneTimeToken(store, collectionKey, userId, type, ttlMs) {
  const token = id(type);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  store[collectionKey] = store[collectionKey].filter((entry) => entry.userId !== userId);
  store[collectionKey].push({ token, userId, createdAt: new Date().toISOString(), expiresAt });
  return { token, expiresAt };
}

function consumeOneTimeToken(store, collectionKey, token) {
  const now = Date.now();
  store[collectionKey] = store[collectionKey].filter((entry) => {
    const expiresAt = Date.parse(String(entry.expiresAt || ''));
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  const idx = store[collectionKey].findIndex((entry) => entry.token === token);
  if (idx < 0) return null;
  const [entry] = store[collectionKey].splice(idx, 1);
  return entry;
}

async function resolveSessionFromReq(req, store, now = Date.now()) {
  purgeExpiredSessions(store, now);
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const payload = verifyToken(token);
  if (payload) {
    if (isRevoked(store, payload.jti) || isRevoked(store, token)) return null;
    if (await redisIsRevoked(payload.jti) || await redisIsRevoked(token)) return null;

    let session = null;
    if (REDIS_ENABLED) {
      session = await redisGetSessionRecord({ sid: payload.sid, jti: payload.jti });
    }
    if (!session) {
      session = store.sessions.find((entry) => entry.sid === payload.sid && entry.jti === payload.jti && entry.userId === payload.sub);
    }
    if (!session) return null;

    const expiresAtMs = Date.parse(String(session.expiresAt || ''));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      store.sessions = store.sessions.filter((entry) => !(entry.sid === payload.sid && entry.jti === payload.jti));
      await redisRemoveSessionRecord({ sid: payload.sid, jti: payload.jti });
      return null;
    }

    return { token, session, jti: payload.jti, sid: payload.sid };
  }

  // Backward compatibility for legacy random-token sessions.
  if (isRevoked(store, token) || await redisIsRevoked(token)) return null;
  const session = store.sessions.find((entry) => entry.token === token);
  if (!session) return null;
  const expiresAtMs = Date.parse(String(session.expiresAt || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    store.sessions = store.sessions.filter((entry) => entry.token !== token);
    return null;
  }
  return { token, session, jti: session.jti || null, sid: session.sid || null };
}

async function userFromReq(req, store) {
  const resolved = await resolveSessionFromReq(req, store);
  if (!resolved) return null;
  return store.users.find((u) => u.id === resolved.session.userId) || null;
}

function requireModerator(req) {
  return String(req.headers['x-moderator-key'] || '') === MODERATOR_KEY;
}

function isUserBanned(user, store, now = Date.now()) {
  const activeBan = store.moderation.find((m) => (
    m.targetUserId === user.id
    && (m.action === 'perm_ban' || m.action === 'temp_ban')
    && m.status === 'active'
    && (!m.expiresAt || new Date(m.expiresAt).getTime() > now)
  ));
  return activeBan || null;
}

function takeRateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  const existing = store.rateLimits.find((r) => r.key === key);
  if (!existing) {
    store.rateLimits.push({ key, count: 1, resetAt: new Date(now + windowMs).toISOString() });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  const resetAtMs = new Date(existing.resetAt).getTime();
  if (Number.isNaN(resetAtMs) || now >= resetAtMs) {
    existing.count = 1;
    existing.resetAt = new Date(now + windowMs).toISOString();
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((resetAtMs - now) / 1000))
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - existing.count), retryAfterSec: 0 };
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = id('req');
  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(...args) {
    const durationMs = Date.now() - startedAt;
    const routeKey = `${req.method} ${new URL(req.url, `http://${req.headers.host}`).pathname}`;
    noteRequestMetric(routeKey, Number(res.statusCode || 200), durationMs);
    logEvent({
      type: 'http_request',
      requestId,
      method: req.method,
      path: new URL(req.url, `http://${req.headers.host}`).pathname,
      statusCode: Number(res.statusCode || 200),
      durationMs
    });
    return originalEnd(...args);
  };

  try {
    setSecurityHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const u = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(WEB_FILE, 'utf8'));
    }

    const store = await loadStore();

  if (req.method === 'GET' && u.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'market-rank-api', users: store.users.length, predictions: store.predictions.length });
  }

  if (req.method === 'GET' && u.pathname === '/api/metrics') {
    if (!requireModerator(req)) return json(res, 403, { error: 'moderator key required' });
    const recent5xxPerMinute = metrics.recent5xx.filter((t) => Date.now() - t <= 60 * 1000).length;
    return json(res, 200, {
      startedAt: metrics.startedAt,
      requestsTotal: metrics.requestsTotal,
      requestsByStatusClass: metrics.requestsByStatusClass,
      recent5xxPerMinute,
      routes: metrics.requestsByRoute
    });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/register') {
    const ipHash = hash(getClientIp(req));
    const registerRl = takeRateLimit(store, `register:${ipHash}`, 8, 60 * 60 * 1000);
    if (!registerRl.allowed) {
      await saveStore(store);
      return json(res, 429, { error: 'rate limit exceeded', retryAfterSec: registerRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    if (!b?.email || !b?.password || String(b.password).length < 8 || !isEmail(b.email)) return json(res, 400, { error: 'invalid input' });
    const email = String(b.email).toLowerCase().trim();
    if (store.users.some((uUser) => uUser.email === email)) return json(res, 409, { error: 'email exists' });

    const user = {
      id: id('usr'),
      email,
      passwordHash: hash(b.password),
      createdAt: new Date().toISOString(),
      trustScore: 50,
      emailVerified: false,
      phoneVerified: false,
      ipHash,
      deviceHash: getDeviceFingerprint(req),
      sybilRisk: 0,
      sybilSignals: []
    };

    store.users.push(user);
    const sybil = computeSybilSignals(user.id, store);
    user.sybilRisk = sybil.score;
    user.sybilSignals = sybil.reasons;
    await saveStore(store);
    return json(res, 201, {
      user: {
        id: user.id,
        email: user.email,
        trustScore: user.trustScore,
        sybilRisk: user.sybilRisk,
        sybilSignals: user.sybilSignals
      }
    });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/login') {
    const ipHash = hash(getClientIp(req));
    const loginRl = takeRateLimit(store, `login:${ipHash}`, 20, 15 * 60 * 1000);
    if (!loginRl.allowed) {
      await saveStore(store);
      return json(res, 429, { error: 'rate limit exceeded', retryAfterSec: loginRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    const email = String(b?.email || '').toLowerCase().trim();
    if (!isEmail(email) || String(b?.password || '').length < 8) return json(res, 400, { error: 'invalid credentials format' });
    const user = store.users.find((x) => x.email === email && x.passwordHash === hash(b?.password || ''));
    if (!user) return json(res, 401, { error: 'invalid credentials' });

    const activeBan = isUserBanned(user, store);
    if (activeBan) return json(res, 403, { error: 'account banned', ban: activeBan });

    user.lastSeenAt = new Date().toISOString();
    if (!user.deviceHash) user.deviceHash = getDeviceFingerprint(req);
    const sybil = computeSybilSignals(user.id, store);
    user.sybilRisk = sybil.score;
    user.sybilSignals = sybil.reasons;

    const activeSession = issueSession(store, user.id);
    await redisStoreSessionRecord({ ...activeSession, userId: user.id });
    await saveStore(store);
    return json(res, 200, {
      token: activeSession.token,
      session: { expiresAt: activeSession.expiresAt },
      user: {
        id: user.id,
        email: user.email,
        emailVerified: Boolean(user.emailVerified),
        trustScore: user.trustScore,
        sybilRisk: user.sybilRisk,
        sybilSignals: user.sybilSignals
      }
    });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/email/verify/request') {
    const b = await body(req).catch(() => null);
    const email = String(b?.email || '').toLowerCase().trim();
    if (!isEmail(email)) return json(res, 400, { error: 'invalid email' });
    const user = store.users.find((entry) => entry.email === email);
    if (!user) return json(res, 200, { ok: true });

    const verify = createOneTimeToken(store, 'emailVerificationTokens', user.id, 'emv', 60 * 60 * 1000);
    await saveStore(store);
    return json(res, 200, { ok: true, verificationToken: verify.token, expiresAt: verify.expiresAt });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/email/verify/confirm') {
    const b = await body(req).catch(() => null);
    const token = String(b?.token || '').trim();
    if (!token) return json(res, 400, { error: 'token required' });

    const verify = consumeOneTimeToken(store, 'emailVerificationTokens', token);
    if (!verify) return json(res, 400, { error: 'invalid or expired token' });

    const user = store.users.find((entry) => entry.id === verify.userId);
    if (!user) return json(res, 404, { error: 'user not found' });

    user.emailVerified = true;
    await saveStore(store);
    return json(res, 200, { ok: true, user: { id: user.id, email: user.email, emailVerified: true } });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/password/reset/request') {
    const b = await body(req).catch(() => null);
    const email = String(b?.email || '').toLowerCase().trim();
    if (!isEmail(email)) return json(res, 400, { error: 'invalid email' });
    const user = store.users.find((entry) => entry.email === email);
    if (!user) return json(res, 200, { ok: true });

    const reset = createOneTimeToken(store, 'passwordResetTokens', user.id, 'pwd', 30 * 60 * 1000);
    await saveStore(store);
    return json(res, 200, { ok: true, resetToken: reset.token, expiresAt: reset.expiresAt });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/password/reset/confirm') {
    const b = await body(req).catch(() => null);
    const token = String(b?.token || '').trim();
    const newPassword = String(b?.newPassword || '');
    if (!token || newPassword.length < 8) return json(res, 400, { error: 'invalid reset payload' });

    const reset = consumeOneTimeToken(store, 'passwordResetTokens', token);
    if (!reset) return json(res, 400, { error: 'invalid or expired token' });

    const user = store.users.find((entry) => entry.id === reset.userId);
    if (!user) return json(res, 404, { error: 'user not found' });

    user.passwordHash = hash(newPassword);
    const revoked = store.sessions.filter((entry) => entry.userId === user.id);
    const redisRevoked = await redisListUserSessions(user.id);
    store.sessions = store.sessions.filter((entry) => entry.userId !== user.id);
    for (const sessionEntry of [...revoked, ...redisRevoked]) {
      revokeTokenValue(store, sessionEntry.jti);
      revokeTokenValue(store, sessionEntry.token);
      await redisRevokeTokenValue(sessionEntry.jti);
      await redisRevokeTokenValue(sessionEntry.token);
      await redisRemoveSessionRecord({ sid: sessionEntry.sid, jti: sessionEntry.jti });
    }
    if (store.revokedTokenHashes.length > 5000) store.revokedTokenHashes = store.revokedTokenHashes.slice(-5000);
    if (store.revokedTokens.length > 1000) store.revokedTokens = store.revokedTokens.slice(-1000);

    await saveStore(store);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/logout') {
    const resolved = await resolveSessionFromReq(req, store);
    if (!resolved) return json(res, 401, { error: 'auth required' });

    store.sessions = store.sessions.filter((entry) => {
      if (resolved.sid && resolved.jti) return !(entry.sid === resolved.sid && entry.jti === resolved.jti);
      return entry.token !== resolved.token;
    });
    revokeTokenValue(store, resolved.token);
    revokeTokenValue(store, resolved.jti);
    await redisRevokeTokenValue(resolved.token);
    await redisRevokeTokenValue(resolved.jti);
    await redisRemoveSessionRecord({ sid: resolved.sid, jti: resolved.jti });
    if (store.revokedTokenHashes.length > 5000) store.revokedTokenHashes = store.revokedTokenHashes.slice(-5000);
    if (store.revokedTokens.length > 1000) store.revokedTokens = store.revokedTokens.slice(-1000);

    await saveStore(store);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && u.pathname === '/api/predictions') {
    const user = await userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });

    const activeBan = isUserBanned(user, store);
    if (activeBan) return json(res, 403, { error: 'account banned', ban: activeBan });

    const ipHash = hash(getClientIp(req));
    const baseLimit = user.phoneVerified ? 40 : 15;
    const effectiveLimit = user.sybilRisk >= 40 ? Math.max(5, Math.floor(baseLimit / 3)) : baseLimit;
    const predictionRl = takeRateLimit(store, `pred:user:${user.id}`, effectiveLimit, 60 * 60 * 1000);
    if (!predictionRl.allowed) {
      await saveStore(store);
      return json(res, 429, { error: 'prediction rate limit exceeded', retryAfterSec: predictionRl.retryAfterSec });
    }

    const ipRl = takeRateLimit(store, `pred:ip:${ipHash}`, 100, 60 * 60 * 1000);
    if (!ipRl.allowed) {
      await saveStore(store);
      return json(res, 429, { error: 'ip rate limit exceeded', retryAfterSec: ipRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    const dir = String(b?.direction || '');
    const ticker = String(b?.ticker || '').toUpperCase().trim();
    const targetPrice = Number(b?.targetPrice);
    const confidence = Number(b?.confidence ?? 0.5);
    const horizonDate = String(b?.horizonDate || '');
    if (!isTicker(ticker) || !['bull', 'bear'].includes(dir) || !Number.isFinite(targetPrice) || targetPrice <= 0 || !isIsoDate(horizonDate) || !isFutureDate(horizonDate) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return json(res, 400, { error: 'invalid prediction' });
    }

    const pred = {
      id: id('pred'),
      userId: user.id,
      ticker,
      direction: dir,
      targetPrice,
      horizonDate,
      confidence,
      createdAt: new Date().toISOString(),
      status: 'open',
      flagged: false,
      flagCount: 0
    };
    store.predictions.push(pred);

    const sybil = computeSybilSignals(user.id, store);
    user.sybilRisk = sybil.score;
    user.sybilSignals = sybil.reasons;
    user.trustScore = computeUserScore(user.id, store);
    await saveStore(store);
    return json(res, 201, { prediction: pred, trustScore: user.trustScore, sybilRisk: user.sybilRisk });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/flag') {
    const user = await userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });
    const b = await body(req).catch(() => null);
    if (!b?.predictionId || !b?.reason) return json(res, 400, { error: 'invalid flag request' });
    const reason = sanitizeText(b.reason, 500);
    if (!reason) return json(res, 400, { error: 'invalid flag reason' });

    const prediction = store.predictions.find((p) => p.id === b.predictionId);
    if (!prediction) return json(res, 404, { error: 'prediction not found' });

    const duplicate = store.moderation.find((m) => m.action === 'flag' && m.predictionId === prediction.id && m.actorUserId === user.id);
    if (duplicate) return json(res, 409, { error: 'already flagged' });

    const event = {
      id: id('mod'),
      action: 'flag',
      actorUserId: user.id,
      targetUserId: prediction.userId,
      predictionId: prediction.id,
      reason,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    store.moderation.push(event);
    prediction.flagCount = Number(prediction.flagCount || 0) + 1;
    if (prediction.flagCount >= 2) prediction.flagged = true;

    const targetUser = store.users.find((uUser) => uUser.id === prediction.userId);
    if (targetUser) targetUser.trustScore = computeUserScore(targetUser.id, store);

    await saveStore(store);
    return json(res, 201, { flag: event, prediction: { id: prediction.id, flagged: prediction.flagged, flagCount: prediction.flagCount } });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/ban') {
    if (!requireModerator(req)) return json(res, 403, { error: 'moderator key required' });
    const b = await body(req).catch(() => null);
    if (!b?.targetUserId || !b?.reason) return json(res, 400, { error: 'invalid ban request' });
    const reason = sanitizeText(b.reason, 500);
    if (!reason) return json(res, 400, { error: 'invalid ban reason' });

    const targetUser = store.users.find((uUser) => uUser.id === b.targetUserId);
    if (!targetUser) return json(res, 404, { error: 'target user not found' });

    const isPermanent = Boolean(b.permanent);
    const durationHours = Math.max(1, Math.min(24 * 30, Number(b.durationHours || 24)));
    const now = Date.now();
    const event = {
      id: id('mod'),
      action: isPermanent ? 'perm_ban' : 'temp_ban',
      actorUserId: 'moderator',
      targetUserId: targetUser.id,
      reason,
      status: 'active',
      createdAt: new Date(now).toISOString(),
      expiresAt: isPermanent ? null : new Date(now + (durationHours * 60 * 60 * 1000)).toISOString()
    };

    store.moderation.push(event);
    targetUser.trustScore = computeUserScore(targetUser.id, store);
    await saveStore(store);
    return json(res, 201, { ban: event });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/appeal') {
    const user = await userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });
    const b = await body(req).catch(() => null);
    if (!b?.banId || !b?.message) return json(res, 400, { error: 'invalid appeal request' });
    const message = sanitizeText(b.message, 2000);
    if (!message) return json(res, 400, { error: 'invalid appeal message' });

    const ban = store.moderation.find((m) => m.id === b.banId && m.targetUserId === user.id && ['temp_ban', 'perm_ban'].includes(m.action));
    if (!ban) return json(res, 404, { error: 'ban not found' });

    const existing = store.appeals.find((a) => a.banId === ban.id && a.userId === user.id && a.status === 'open');
    if (existing) return json(res, 409, { error: 'appeal already open', appeal: existing });

    const appeal = {
      id: id('apl'),
      banId: ban.id,
      userId: user.id,
      message,
      status: 'open',
      createdAt: new Date().toISOString()
    };
    store.appeals.push(appeal);
    await saveStore(store);
    return json(res, 201, { appeal });
  }

  if (req.method === 'GET' && u.pathname === '/api/moderation/dashboard') {
    if (!requireModerator(req)) return json(res, 403, { error: 'moderator key required' });

    const activeBans = store.moderation
      .filter((m) => ['temp_ban', 'perm_ban'].includes(m.action) && m.status === 'active')
      .map((ban) => ({
        ...ban,
        targetEmail: store.users.find((uUser) => uUser.id === ban.targetUserId)?.email || null
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const flaggedPredictions = store.predictions
      .filter((p) => Number(p.flagCount || 0) > 0)
      .map((prediction) => ({
        ...prediction,
        ownerEmail: store.users.find((uUser) => uUser.id === prediction.userId)?.email || null
      }))
      .sort((a, b) => Number(b.flagCount || 0) - Number(a.flagCount || 0));

    const openAppeals = store.appeals
      .filter((a) => a.status === 'open')
      .map((appeal) => ({
        ...appeal,
        userEmail: store.users.find((uUser) => uUser.id === appeal.userId)?.email || null
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return json(res, 200, {
      summary: {
        users: store.users.length,
        predictions: store.predictions.length,
        flaggedPredictions: flaggedPredictions.length,
        activeBans: activeBans.length,
        openAppeals: openAppeals.length
      },
      flaggedPredictions: flaggedPredictions.slice(0, 50),
      activeBans: activeBans.slice(0, 50),
      openAppeals: openAppeals.slice(0, 50)
    });
  }

  if (req.method === 'GET' && u.pathname === '/api/leaderboard') {
    for (const user of store.users) {
      const sybil = computeSybilSignals(user.id, store);
      user.sybilRisk = sybil.score;
      user.sybilSignals = sybil.reasons;
      user.trustScore = computeUserScore(user.id, store);
    }

    const leaderboard = store.users
      .map((uUser) => ({
        id: uUser.id,
        email: uUser.email,
        trustScore: uUser.trustScore,
        sybilRisk: uUser.sybilRisk || 0,
        predictionCount: store.predictions.filter((p) => p.userId === uUser.id).length
      }))
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, 100);

    await saveStore(store);
    return json(res, 200, { leaderboard, updatedAt: new Date().toISOString(), schedule: 'daily at 8:00 PM EST' });
  }

    json(res, 404, { error: 'not found' });
  } catch (error) {
    if (!res.headersSent) {
      if (String(error.message).includes('payload_too_large')) {
        return json(res, 413, { error: 'payload too large' });
      }
      const details = NODE_ENV === 'development' ? { details: String(error.message || error) } : {};
      return json(res, 500, { error: 'internal server error', ...details });
    }
  }
});

server.listen(port, () => console.log(`market-rank api running on http://localhost:${port}`));
