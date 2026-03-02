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
- [x] Enforce future horizon date for predictions
- [x] Add CSP header to tighten browser security policy
- [x] Add tests for logout invalidation + past-date rejection

## Remaining before true production GA

- [ ] Persistent session store (Redis/JWT with rotation + revoke list)
- [ ] Replace JSON file store with Postgres and migrations
- [ ] Add password reset + email verification flow
- [x] Add structured logging + metrics + alerting (JSONL request logs, `/api/metrics`, 5xx burst warning)
- [ ] Add OpenAPI spec and contract tests
- [ ] Add admin moderation dashboard UI
- [ ] Add E2E browser tests (Playwright/Cypress)
