# MarketRank Market-Ready TODO

## Completed in current pass

- [x] API error handling with top-level try/catch and consistent JSON errors
- [x] Input validation for auth, prediction payloads, moderation text fields
- [x] Payload-size guardrails and safer request parsing
- [x] Baseline security headers + CORS controls
- [x] Rate limiting for register/login/prediction routes
- [x] Responsive UI with loading and error states
- [x] Accessibility basics (`aria-live`, labels, semantic sections)
- [x] SEO essentials (title, description, robots)
- [x] README setup/env/api documentation refresh
- [x] Regression tests for API validation paths

## Completed in this milestone

- [x] Add logout endpoint (`POST /api/auth/logout`) and session invalidation
- [x] Persist auth sessions in store with TTL and explicit revoke list on logout
- [x] Harden token revocation with hashed deny-list checks and bounded per-user active sessions
- [x] Enforce future horizon date for predictions
- [x] Add CSP header to tighten browser security policy
- [x] Add tests for logout invalidation + past-date rejection

## Remaining before true production GA

- [x] Move session storage/revocation to Redis for horizontal scale (enabled via `REDIS_URL`, with file/postgres fallback for local dev)
- [ ] Replace JSON file store with Postgres and migrations
- [x] Add password reset + email verification flow (token-based MVP endpoints; provider-based email delivery still pending for production)
- [x] Add structured logging + metrics + alerting (JSONL request logs, `/api/metrics`, 5xx burst warning)
- [x] Add OpenAPI spec and contract tests
- [x] Add admin moderation dashboard UI
- [x] Add E2E tests with Playwright (register/login/post-prediction/leaderboard flow)
