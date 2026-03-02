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

## API endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout` (Bearer token)
- `POST /api/predictions` (Bearer token, future horizon date required)
- `POST /api/moderation/flag` (Bearer token)
- `POST /api/moderation/ban` (`x-moderator-key` header)
- `POST /api/moderation/appeal` (Bearer token)
- `GET /api/leaderboard`

## Test coverage

- `scripts/scoring-test.js` - score/sybil unit checks
- `scripts/smoke-test.js` - e2e core flow checks
- `scripts/api-validation-test.js` - input validation + payload limits

## Production-readiness TODO (next step)

1. Replace JSON store with Postgres + migrations
2. Add proper session persistence (Redis/JWT + rotation)
3. Add observability (structured logs, metrics, tracing)
4. Add CI security checks (dependency + SAST)
5. Add API docs (OpenAPI) and typed client
6. Add full moderation dashboard

## Security notes

Current implementation is still lightweight and intentionally simple for MVP iteration. It includes baseline controls (rate limit, validation, body-size limits, noframe/nosniff/referrer headers), but should not be treated as enterprise-hardened yet.
