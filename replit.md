# CashWatch / PaidAdz

A Telegram Mini App where users earn SWAG tokens by watching ads, completing tasks, and referring friends.

## Stack
- **Frontend**: React 18 + Vite + Wouter (client-side routing) + TanStack Query
- **Backend**: Express.js (TypeScript, ESM)
- **Database**: PostgreSQL via Neon (@neondatabase/serverless) + Drizzle ORM
- **Auth**: Telegram WebApp `initData` verification
- **Payments**: TON Connect (wallet linking + withdrawals)

## Running the app
```
npm run dev
```
Runs on port 5000. The workflow "Start application" is configured for this.

## Key environment variables required
- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `TELEGRAM_BOT_TOKEN` — from @BotFather (enables bot features + avatar proxy)
- `SESSION_SECRET` — already set as a Replit secret

## Project structure
```
client/src/          React frontend
server/              Express backend
  index.ts           Entry point
  routes.ts          All API routes (~14k lines)
  storage.ts         DB access layer
  migrate.ts         Schema migration runner
shared/schema.ts     Drizzle table definitions (shared client/server)
migrations/          Raw SQL migration files
```

## Ad providers
- **AdsGram** — requires user to minimize app during ad
- **Monetag** — overlay ad, session-duration validated server-side
- **Gigapub** — Telegram-native overlay, completion via `window.showGiga()` promise
- **USL Ads** — TowerAds SDK, reward via `onRewardEarned` callback

## User preferences
- Do not restructure the project layout or migrate the database without explicit instruction.
- Keep existing stack; do not swap libraries without asking first.
