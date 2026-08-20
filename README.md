# What If — Text-only Social Network

A production-ready, full-stack text-only social entertainment platform.

## Live App
- Production: Cloudflare Workers deployment configured (the public URL is recorded here after the first deploy)
- Local Node server: `http://localhost:3000`
- API base: `/api/*`


## Core Features Implemented (all working end-to-end)

1. **Auth** — register, login, logout, session persistence (httpOnly cookies + token fallback), bcrypt hashing (12 rounds), username uniqueness, protected routes.
2. **Home** — Today's Challenge (most recent), answer form, locked community answers until you answer, trending, recent discussions, XP/streak.
3. **Challenges** — 18 seeded original challenges across 9 categories, create, filter, search, sort (new/trending/popular), pagination, participant count, status.
4. **Answers** — real DB records, create/edit/delete own, vote (prevent duplicate, toggle), reply, report, masked until answered.
5. **Battle Mode** — two-option comparison, create battle, vote once per battle, win rate, history, XP.
6. **Story Chain** — start story, continue in chronological order, vote on continuations, finish (creator/admin).
7. **Random Mode** — true random challenge excluding last 20 answered by user, fallback if none.
8. **Confessions** — anonymous post (user_id private, never exposed), moderated, reportable, hidden/restore via admin.
9. **Profiles** — username, display name, bio, join date, XP, level, streak, answers/battles/stories counts, popular answers, editable own profile.
10. **Gamification** — XP for every action, levels via quadratic curve, streak bonus, anti-farming via unique constraints + rate limiting.
11. **Personality** — after 3 answers, entertainment profile (Strategist/Creative Thinker/Comedian etc.) with transparent disclaimer.
12. **Discovery / Explore** — trending, popular answers, active battles, popular stories, categories, search over challenges + answers.
13. **Notifications** — stored in DB, vote/reply/battle/story, read/unread, mark single/all.
14. **Moderation & Admin** — report any content, admin dashboard (users, active users, challenges, answers, battles, stories, pending reports), dismiss/remove/restore/suspend, role-based auth.

## Tech Stack
- **Backend:** Express 5, running either on Node 20+ or natively on Cloudflare Workers through the Workers Node.js HTTP compatibility layer.
- **Database:** Cloudflare D1 in production (durable, serverless SQLite) and local `sqlite3` for Node development, behind the same adapter interface.
- **Frontend:** Vanilla JS SPA (hash router), no build step, responsive (desktop sidebar + mobile bottom nav + topbar), system fonts + Fraunces/Inter via Google Fonts, inline SVG icons, no emojis.
- **DB Schema:** users, sessions, challenges, answers, votes, replies, battles, battle_votes, stories, story_entries, story_votes, confessions, notifications, reports, xp_events, moderation_actions — with FKs, indexes, unique constraints, cascading.

## Security
- PBKDF2-SHA256 password hashing via Web Crypto (with bcrypt verification for legacy local records), secure session tokens (30d expiry), httpOnly/Secure/SameSite Lax production cookies, authorization on every mutation, input sanitization, prepared statements, rate limiting (auth 30/15min, writes 20/min, votes 30/min), duplicate vote/report prevention, and role checks.

## Design
- Paper background #fdfbf7, ink #0f0f0f, accent #ff3b30, subtle borders, 16-22px radii, soft shadows, strong typography (Fraunces for display, Inter for body), clean cards, good spacing, restrained animations.

## Run Locally

### Node + local SQLite
```bash
npm ci
npm start
# open http://localhost:3000
```

Set `DATABASE_PATH=/path/to/data.db` to use a different SQLite file. Set `DISABLE_BOTS=true` to disable timed bot activity.

### Cloudflare Worker + local D1
```bash
npm ci
npm run db:migrate:local
npm run dev:worker
# open http://localhost:8787
```

## Deploy to Cloudflare

The deployment serves the SPA through Workers Static Assets and routes `/api/*` to Express. Production data is stored permanently in D1.

```bash
npx wrangler login --device
npx wrangler d1 create whatif-production --location weur
# Put the returned database ID in wrangler.jsonc
npm run db:migrate:remote
npm run deploy:cloudflare
```

The checked-in migrations create the schema and load curated public seed content. They intentionally exclude existing sessions, known demo passwords, reports, notifications, and non-demo accounts from `data.db`.

## Testing
All flows manually verified via API + UI:
register, login, logout, answer, toggle vote, reply, battle vote (duplicate blocked), story continue + vote, random, confession (anonymous), notifications, search, report, admin dismiss/remove/restore, edit profile, level progress, streak.

## Notes
- No emojis anywhere (enforced in code + seed data).
- Does not copy Reddit/Twitter/Quora patterns — instead single-challenge home, battle mode, story chain, confessions, personality.
- Fully usable on mobile (touch targets, responsive grid, bottom nav).
- Pagination never loads unlimited rows.
