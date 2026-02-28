const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { loadStore, saveStore } = require('./store');
const { computeUserScore, computeSybilSignals } = require('./scoring');

const port = Number(process.env.PORT || 4510);
const sessions = new Map();
const WEB_FILE = path.join(__dirname, '..', 'web', 'index.html');
const MODERATOR_KEY = process.env.MODERATOR_KEY || 'dev-moderator-key';

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
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

function userFromReq(req, store) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !sessions.has(token)) return null;
  const userId = sessions.get(token);
  return store.users.find((u) => u.id === userId) || null;
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
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(WEB_FILE, 'utf8'));
  }

  const store = loadStore();

  if (req.method === 'GET' && u.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'market-rank-api', users: store.users.length, predictions: store.predictions.length });
  }

  if (req.method === 'POST' && u.pathname === '/api/auth/register') {
    const ipHash = hash(getClientIp(req));
    const registerRl = takeRateLimit(store, `register:${ipHash}`, 8, 60 * 60 * 1000);
    if (!registerRl.allowed) {
      saveStore(store);
      return json(res, 429, { error: 'rate limit exceeded', retryAfterSec: registerRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    if (!b?.email || !b?.password || String(b.password).length < 8) return json(res, 400, { error: 'invalid input' });
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
    saveStore(store);
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
      saveStore(store);
      return json(res, 429, { error: 'rate limit exceeded', retryAfterSec: loginRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    const email = String(b?.email || '').toLowerCase().trim();
    const user = store.users.find((x) => x.email === email && x.passwordHash === hash(b?.password || ''));
    if (!user) return json(res, 401, { error: 'invalid credentials' });

    const activeBan = isUserBanned(user, store);
    if (activeBan) return json(res, 403, { error: 'account banned', ban: activeBan });

    user.lastSeenAt = new Date().toISOString();
    if (!user.deviceHash) user.deviceHash = getDeviceFingerprint(req);
    const sybil = computeSybilSignals(user.id, store);
    user.sybilRisk = sybil.score;
    user.sybilSignals = sybil.reasons;

    const token = id('tok');
    sessions.set(token, user.id);
    saveStore(store);
    return json(res, 200, {
      token,
      user: {
        id: user.id,
        email: user.email,
        trustScore: user.trustScore,
        sybilRisk: user.sybilRisk,
        sybilSignals: user.sybilSignals
      }
    });
  }

  if (req.method === 'POST' && u.pathname === '/api/predictions') {
    const user = userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });

    const activeBan = isUserBanned(user, store);
    if (activeBan) return json(res, 403, { error: 'account banned', ban: activeBan });

    const ipHash = hash(getClientIp(req));
    const baseLimit = user.phoneVerified ? 40 : 15;
    const effectiveLimit = user.sybilRisk >= 40 ? Math.max(5, Math.floor(baseLimit / 3)) : baseLimit;
    const predictionRl = takeRateLimit(store, `pred:user:${user.id}`, effectiveLimit, 60 * 60 * 1000);
    if (!predictionRl.allowed) {
      saveStore(store);
      return json(res, 429, { error: 'prediction rate limit exceeded', retryAfterSec: predictionRl.retryAfterSec });
    }

    const ipRl = takeRateLimit(store, `pred:ip:${ipHash}`, 100, 60 * 60 * 1000);
    if (!ipRl.allowed) {
      saveStore(store);
      return json(res, 429, { error: 'ip rate limit exceeded', retryAfterSec: ipRl.retryAfterSec });
    }

    const b = await body(req).catch(() => null);
    const dir = String(b?.direction || '');
    if (!b?.ticker || !['bull', 'bear'].includes(dir) || !b?.targetPrice || !b?.horizonDate) return json(res, 400, { error: 'invalid prediction' });

    const pred = {
      id: id('pred'),
      userId: user.id,
      ticker: String(b.ticker).toUpperCase().trim(),
      direction: dir,
      targetPrice: Number(b.targetPrice),
      horizonDate: String(b.horizonDate),
      confidence: Number(b.confidence || 0.5),
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
    saveStore(store);
    return json(res, 201, { prediction: pred, trustScore: user.trustScore, sybilRisk: user.sybilRisk });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/flag') {
    const user = userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });
    const b = await body(req).catch(() => null);
    if (!b?.predictionId || !b?.reason) return json(res, 400, { error: 'invalid flag request' });

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
      reason: String(b.reason).slice(0, 500),
      status: 'active',
      createdAt: new Date().toISOString()
    };

    store.moderation.push(event);
    prediction.flagCount = Number(prediction.flagCount || 0) + 1;
    if (prediction.flagCount >= 2) prediction.flagged = true;

    const targetUser = store.users.find((uUser) => uUser.id === prediction.userId);
    if (targetUser) targetUser.trustScore = computeUserScore(targetUser.id, store);

    saveStore(store);
    return json(res, 201, { flag: event, prediction: { id: prediction.id, flagged: prediction.flagged, flagCount: prediction.flagCount } });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/ban') {
    if (!requireModerator(req)) return json(res, 403, { error: 'moderator key required' });
    const b = await body(req).catch(() => null);
    if (!b?.targetUserId || !b?.reason) return json(res, 400, { error: 'invalid ban request' });

    const targetUser = store.users.find((uUser) => uUser.id === b.targetUserId);
    if (!targetUser) return json(res, 404, { error: 'target user not found' });

    const isPermanent = Boolean(b.permanent);
    const durationHours = Number(b.durationHours || 24);
    const now = Date.now();
    const event = {
      id: id('mod'),
      action: isPermanent ? 'perm_ban' : 'temp_ban',
      actorUserId: 'moderator',
      targetUserId: targetUser.id,
      reason: String(b.reason).slice(0, 500),
      status: 'active',
      createdAt: new Date(now).toISOString(),
      expiresAt: isPermanent ? null : new Date(now + (durationHours * 60 * 60 * 1000)).toISOString()
    };

    store.moderation.push(event);
    targetUser.trustScore = computeUserScore(targetUser.id, store);
    saveStore(store);
    return json(res, 201, { ban: event });
  }

  if (req.method === 'POST' && u.pathname === '/api/moderation/appeal') {
    const user = userFromReq(req, store);
    if (!user) return json(res, 401, { error: 'auth required' });
    const b = await body(req).catch(() => null);
    if (!b?.banId || !b?.message) return json(res, 400, { error: 'invalid appeal request' });

    const ban = store.moderation.find((m) => m.id === b.banId && m.targetUserId === user.id && ['temp_ban', 'perm_ban'].includes(m.action));
    if (!ban) return json(res, 404, { error: 'ban not found' });

    const existing = store.appeals.find((a) => a.banId === ban.id && a.userId === user.id && a.status === 'open');
    if (existing) return json(res, 409, { error: 'appeal already open', appeal: existing });

    const appeal = {
      id: id('apl'),
      banId: ban.id,
      userId: user.id,
      message: String(b.message).slice(0, 2000),
      status: 'open',
      createdAt: new Date().toISOString()
    };
    store.appeals.push(appeal);
    saveStore(store);
    return json(res, 201, { appeal });
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

    saveStore(store);
    return json(res, 200, { leaderboard, updatedAt: new Date().toISOString(), schedule: 'daily at 8:00 PM EST' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(port, () => console.log(`market-rank api running on http://localhost:${port}`));
