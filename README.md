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
# Optional for Postgres mode:
#   set STORE_BACKEND=postgres in .env
#   run npm run db:migrate
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
- `STORE_BACKEND` - `file` (default) or `postgres`
- `STORE_FILE` - local JSON datastore path (when `STORE_BACKEND=file`)
- `MODERATOR_KEY` - required for `/api/moderation/ban`
- `ALLOWED_ORIGIN` - CORS allowlist origin
- `MAX_BODY_BYTES` - max request body size in bytes
- `NODE_ENV` - `development` / `test` / `production`
- `SESSION_TTL_HOURS` - auth token lifetime before expiry (default 168 hours)
- `DATABASE_URL` - Postgres connection string (required when `STORE_BACKEND=postgres`)
- `PGSSL` - set `require` when your Postgres endpoint enforces TLS
- `JWT_SECRET` - HMAC secret for signed auth tokens (required in production)
- `JWT_ISSUER` - JWT issuer claim (default `market-rank`)
- `JWT_AUDIENCE` - JWT audience claim (default `market-rank-api`)
- `REDIS_URL` - optional Redis connection string for shared session + revocation cache
- `REDIS_SESSION_PREFIX` - Redis key namespace prefix (default `market-rank`)
- `APP_BASE_URL` - absolute app URL included in auth emails
- `EMAIL_DELIVERY_MODE` - `stdout` (default), `outbox`, or `webhook`
- `EMAIL_OUTBOX_FILE` - JSONL output path when using `outbox` mode
- `EMAIL_WEBHOOK_URL` - provider bridge endpoint when using `webhook` mode
- `EMAIL_WEBHOOK_TIMEOUT_MS` - webhook request timeout per attempt (default `5000`)
- `EMAIL_WEBHOOK_RETRIES` - retry attempts after first failure (default `2`)
- `EMAIL_WEBHOOK_RETRY_BASE_MS` - exponential backoff base delay in ms (default `500`)
- `EMAIL_DEADLETTER_FILE` - JSONL fallback file for failed webhook deliveries
- `EMAIL_TOKEN_ECHO` - if `true`, auth token endpoints include raw tokens in API responses (defaults to `true` outside production)

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

Verification/reset requests now route through the delivery adapter (`EMAIL_DELIVERY_MODE`).

- For local QA, keep `EMAIL_TOKEN_ECHO=true` (default outside production).
- For production, set `EMAIL_TOKEN_ECHO=false` and use `EMAIL_DELIVERY_MODE=webhook` with `EMAIL_WEBHOOK_URL`.

## Test coverage

- `scripts/scoring-test.js` - score/sybil unit checks
- `scripts/smoke-test.js` - e2e core flow checks
- `scripts/api-validation-test.js` - input validation + payload limits
- `scripts/auth-recovery-test.js` - email verify + password reset flow and session invalidation checks
- `scripts/openapi-contract-test.js` - OpenAPI route/response contract validation against live server
- `e2e/app.e2e.spec.js` - Playwright end-to-end flow (register/login/post prediction/leaderboard)

## Production-readiness TODO (next step)

1. Add CI secrets/docs for managed Redis + Postgres failover drills
2. Integrate webhook delivery with a live provider (SES/SendGrid/Postmark) and production templates

## Security notes

Current implementation is still lightweight and intentionally simple for MVP iteration. It includes baseline controls (rate limit, validation, body-size limits, noframe/nosniff/referrer headers), but should not be treated as enterprise-hardened yet.
