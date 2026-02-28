# MarketRank (ad-free StockTwits alternative)

## Core promise
- Clean, fast social app for stock discussion (no ads).
- Every prediction is scored objectively.
- Every user gets a credibility score out of 100, updated daily at **8:00 PM EST**.

## Must-have features
1. Accounts required (email/OAuth + verification).
2. Post feed by ticker + global feed.
3. Prediction posts with structured fields:
   - ticker, direction (bull/bear), target price, horizon date, confidence.
4. Credibility algorithm:
   - score range 0–100
   - weighted by prediction accuracy, horizon discipline, consistency, and sample size.
5. Leaderboard:
   - daily recalculated at 8 PM EST
   - global + per-ticker top predictors.
6. Visual trust cues:
   - high score => brighter green ring/name
   - low score => red/orange cues.
7. Anti-spam + anti-sybil:
   - rate limits, device fingerprinting, phone/email verification, IP reputation, behavior model.
   - one-person-many-accounts detection.
8. AI moderation:
   - toxicity/spam/scam detection
   - auto-hide, strike system, temp/permanent bans.

## Ranking algorithm (v1)
- Accuracy component (0–60): closeness to target and correct direction at horizon.
- Calibration component (0–15): confidence vs realized correctness.
- Consistency component (0–15): rolling 30-day Sharpe-like normalized hit quality.
- Reliability component (0–10): sample size and account trust age.
- Penalties: spam flags, deleted calls, brigading, coordinated manipulation.

## Anti-abuse controls
- Required verified email + optional phone verification for higher posting limits.
- Progressive trust tiers unlock reach and frequency.
- Device/IP cluster analysis to detect sockpuppets.
- Honeypot + content similarity dedupe for repeated spam.
- AI mod + human override panel.

## Launch milestones
1. MVP social + predictions + scoring engine.
2. Moderator tools + anti-spam enforcement.
3. Leaderboard + profile credibility visuals.
4. Scale/perf/security hardening + public beta.
