# MarketRank

Ad-free stock discussion platform with prediction credibility scoring.

## What this service does

- User registration/login
- Prediction posting with trust-score updates
- Moderation workflows (flag, temp/permanent ban, appeal)
- Leaderboard with trust score and sybil-risk signals
- Basic anti-abuse rate limits

## Production-readiness TODO (tracked)

- [x] API input validation and payload size limits
- [x] Security headers + configurable CORS
- [x] Better frontend UX: loading states + error feedback
- [x] Responsive layout and accessibility improvements
- [x] SEO metadata for landing page
- [x] Tests green (build/lint/test)
- [ ] Persistent DB (replace JSON file store)
- [ ] Auth hardening (password hashing upgrade + token expiry/revocation)
- [ ] Background jobs + queue for score recalculation
- [ ] Observability (structured logs, metrics, alerting)
- [ ] E2E/browser tests in CI

## Run locally

```bash
npm install
cp .env.example .env
npm run build
npm run lint
npm test
node backend/server.js
```

Open: `http://127.0.0.1:4510`

## Environment configuration

Copy `.env.example` to `.env` and adjust:

- `PORT`: API/web port
- `STORE_FILE`: path to JSON store (for local/dev)
- `MODERATOR_KEY`: shared secret for moderator ban endpoint
- `ALLOWED_ORIGIN`: CORS origin (set exact domain in prod)
- `MAX_BODY_BYTES`: max JSON request size (default 16KB)
- `NODE_ENV`: set `production` in prod

## Scripts

- `npm run build` — static build sanity check
- `npm run lint` — lint/safety checks
- `npm test` — scoring + API smoke tests

## Services

- API: `backend/server.js`
- Worker: `worker/daily-score.js`
- Web: `web/index.html`
- DB schema reference: `db/schema.sql`
