# What If — Text-only Social Network

A production-ready, full-stack text-only social entertainment platform.

## Live App
- Frontend + Backend: `http://localhost:3000` (served via single Express server)
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
- **Backend:** Node 20 + Express 4, SQLite (better-sqlite3 style wrapper around sqlite3), bcryptjs, helmet, express-rate-limit, sanitize-html, uuid, cookie-parser.
- **Frontend:** Vanilla JS SPA (hash router), no build step, responsive (desktop sidebar + mobile bottom nav + topbar), system fonts + Fraunces/Inter via Google Fonts, inline SVG icons, no emojis.
- **DB Schema:** users, sessions, challenges, answers, votes, replies, battles, battle_votes, stories, story_entries, story_votes, confessions, notifications, reports, xp_events, moderation_actions — with FKs, indexes, unique constraints, cascading.

## Security
- Password hashing, secure session tokens (30d expiry), httpOnly SameSite Lax cookies, authorization on every mutation, input sanitization (sanitize-html strip all tags), XSS protection via textContent, SQL injection protection via prepared statements, rate limiting (auth 30/15min, writes 20/min, votes 30/min), duplicate vote/report prevention, role checks.

## Design
- Paper background #fdfbf7, ink #0f0f0f, accent #ff3b30, subtle borders, 16-22px radii, soft shadows, strong typography (Fraunces for display, Inter for body), clean cards, good spacing, restrained animations.

## Run Locally
```bash
npm install
node server.js
# open http://localhost:3000
```

## Testing
All flows manually verified via API + UI:
register, login, logout, answer, toggle vote, reply, battle vote (duplicate blocked), story continue + vote, random, confession (anonymous), notifications, search, report, admin dismiss/remove/restore, edit profile, level progress, streak.

## Notes
- No emojis anywhere (enforced in code + seed data).
- Does not copy Reddit/Twitter/Quora patterns — instead single-challenge home, battle mode, story chain, confessions, personality.
- Fully usable on mobile (touch targets, responsive grid, bottom nav).
- Pagination never loads unlimited rows.
