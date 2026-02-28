# Execution Checklist

## Phase 1 — Foundation
- [x] Monorepo scaffold (web, api, worker, shared types)
- [ ] Auth (email + OAuth) + session security
- [ ] Postgres schema for users/posts/predictions/scores/mod events
- [ ] Redis for rate limits + queues

## Phase 2 — Product Core
- [ ] Feed + ticker channels + prediction composer
- [ ] Structured prediction model + edit rules
- [ ] Profile pages + score ring visuals

## Phase 3 — Ranking Engine
- [ ] EOD market data ingestion
- [ ] 8 PM EST daily score job
- [ ] Leaderboard API + caching

## Phase 4 — Anti-Spam + Mod
- [ ] Device/IP fingerprint and sybil risk scoring
- [ ] AI moderation pipeline + strike/ban system
- [ ] Admin moderator dashboard

## Phase 5 — Launch Ready
- [ ] Full test suite (unit/integration/e2e)
- [ ] Security hardening + abuse red-team checks
- [ ] CI/CD + observability + incident runbook
