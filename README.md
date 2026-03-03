# MarketRank

MarketRank is an ad-free stock prediction platform with user credibility scoring, anti-abuse signals, and moderation workflows.

## What this repo includes

- **Backend API** (`backend/server.js`)
  - Auth: register/login
  - Prediction posting
  - Leaderboard with trust score + sybil risk
  - Moderation: flag, ban, appeal
  - Basic security hardening headers and request-size limits
  - Rate limiting by IP and user
- **Web UI** (`web/index.html`)
  - Responsive single-page app
  - Form validation + loading/error states
  - Accessible status messages (`aria-live`) and semantic markup
- **Scoring logic** (`backend/scoring.js`)
  - Trust score composition
  - Sybil risk signal checks
- **Worker simulation** (`worker/daily-score.js`)
- **Schema draft** (`db/schema.sql`)

## Quick start

```bash
npm install
cp .env.example .env
npm run build
npm run lint
npm test
node backend/server.js
```

Open: `http://localhost:4510`

## Environment variables

See `.env.example`.

Key values:

- `PORT` - API/web port
- `STORE_FILE` - local JSON datastore path (MVP mode)
- `MODERATOR_KEY` - required for `/api/moderation/ban`
- `ALLOWED_ORIGIN` - CORS allowlist origin
- `MAX_BODY_BYTES` - max request body size in bytes
- `NODE_ENV` - `development` / `test` / `production`
- `SESSION_TTL_HOURS` - auth token lifetime before expiry (default 168 hours)

## API endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout` (Bearer token)
- `POST /api/auth/email/verify/request`
- `POST /api/auth/email/verify/confirm`
- `POST /api/auth/password/reset/request`
- `POST /api/auth/password/reset/confirm`
- `POST /api/predictions` (Bearer token, future horizon date required)
- `POST /api/moderation/flag` (Bearer token)
- `POST /api/moderation/ban` (`x-moderator-key` header)
- `POST /api/moderation/appeal` (Bearer token)
- `GET /api/leaderboard`

## Auth recovery notes

Current MVP returns verification/reset tokens directly in API responses so local automation and QA can run without an email provider. In production, replace this with an actual mail delivery provider and remove raw token returns.

## Test coverage

- `scripts/scoring-test.js` - score/sybil unit checks
- `scripts/smoke-test.js` - e2e core flow checks
- `scripts/api-validation-test.js` - input validation + payload limits
- `scripts/auth-recovery-test.js` - email verify + password reset flow and session invalidation checks
- `scripts/openapi-contract-test.js` - OpenAPI route/response contract validation against live server

## Production-readiness TODO (next step)

1. Replace JSON store with Postgres + migrations
2. Harden session persistence to Redis/JWT with rotation (file-backed TTL + revoke-list sessions are now implemented)
3. Add observability (structured logs, metrics, tracing)
4. ✅ Add CI security checks (dependency audit + lightweight SAST)
5. Add typed API client generated from OpenAPI contract
6. Add full moderation dashboard

## Security notes

Current implementation is still lightweight and intentionally simple for MVP iteration. It includes baseline controls (rate limit, validation, body-size limits, noframe/nosniff/referrer headers), but should not be treated as enterprise-hardened yet.
