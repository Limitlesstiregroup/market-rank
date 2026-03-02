# MarketRank

Ad-free stock discussion platform with prediction credibility scoring.

## Run locally

```bash
npm install
cp .env.example .env
npm run build
npm run lint
npm test
```

## Services

- API: `backend/server.js`
- Worker: `worker/daily-score.js`
- Web: `web/index.html`
- DB schema: `db/schema.sql`

## Current scope

This repo currently contains MVP scaffolding for auth, predictions, scoring, moderation signals, and daily score worker simulation.
