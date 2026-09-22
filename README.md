# PulseCheck

An ICU-style uptime and infrastructure monitoring platform. Add a URL, watch it live on a command-center dashboard, get emailed the moment something changes, and share a public status page with your users.

Built as a full-stack, self-hosted DevOps project — not just an app, but the whole pipeline: containerized services, managed database, reverse proxy, free auto-renewing SSL, and automated CI/CD.

🔗 **Live:** https://pulsecheck.bhosalevedant.dev

## Status

🟢 **Live in production** — self-hosted on a DigitalOcean VPS, deployed via Docker Compose, with automated CI/CD on every push to `main`.

## Features

- **Uptime monitoring** — checks your URLs on a custom schedule (minimum 1-minute interval), instant email alerts the moment a site goes down or recovers
- **Content-change detection (Assertions)** — don't just watch if a page loads, watch what it says. Alert on a status code, response time threshold, a keyword appearing/disappearing in the body, or a specific JSON field's value changing
- **SSL & domain expiry warnings** — get warned 30, 14, and 7 days before a certificate or domain expires, before it becomes an outage
- **Heartbeat monitoring** — for cron jobs and background tasks: if a scheduled job stops checking in, you'll know
- **Public status pages** — share a live, read-only trust page for your services with your users, no login required
- **Command-center dashboard** — dark ICU-monitor-themed wall with light mode, per-monitor history, response times, and expiry badges
- **Account security** — email + password auth with JWT, password reset via email, email verification, Cloudflare Turnstile bot protection on signup, and self-service account deletion
- **Abuse protection** — per-IP rate limiting on auth endpoints, enforced minimum check intervals to avoid hammering third-party sites
- **Self-monitoring** — PulseCheck monitors its own uptime, and a deep health-check endpoint reports database and queue connectivity for external monitoring

## Tech stack

| Layer | Stack |
|-------|--------|
| **Backend** | Node.js, Express 5, Prisma 7 (driver adapters), JWT + bcrypt |
| **Database** | PostgreSQL (Supabase, managed) |
| **Queue / Jobs** | BullMQ + Redis (self-hosted container) |
| **Worker** | Node.js background process — scheduled checks via BullMQ job schedulers |
| **Email** | Resend, sent from a verified custom domain |
| **Frontend** | Next.js 15 (App Router), TypeScript, Tailwind CSS 4 |
| **Infrastructure** | Docker + Docker Compose, Nginx (reverse proxy), Let's Encrypt (SSL), DigitalOcean VPS |
| **CI/CD** | GitHub Actions — automated deploy on push to `main` |
| **Bot protection** | Cloudflare Turnstile |

## Architecture

```
Visitor ──HTTPS──▶ Nginx (SSL termination) ──▶ Next.js frontend (:3000)
                                          └──▶ Express API (:8000) ──▶ Supabase Postgres
                                                                  └──▶ Redis (BullMQ)

Worker (separate container) ── scheduled jobs via BullMQ ──▶ pings monitored URLs
                                                          └──▶ writes CheckResult rows
                                                          └──▶ sends alerts via Resend
```

All three services are independently containerized and orchestrated via `docker-compose.yml`. Backend and worker share one Prisma schema.

## Project structure

```
pulsecheck/
├── .github/workflows/   GitHub Actions CI/CD pipeline
├── backend/             Express API + Prisma schema/migrations
├── worker/              BullMQ job processors — monitor, heartbeat, SSL/domain checks
├── frontend/             Next.js ICU-style dashboard
├── docker-compose.yml    Service orchestration
└── LEARNINGS.md          Running dev log — bugs, fixes, and gotchas
```

## Running locally

### Prerequisites
- Node.js (LTS)
- Docker + Docker Compose
- A PostgreSQL database (local or managed) and a Redis instance (local or cloud)

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, REDIS_URL, RESEND_API_KEY, TURNSTILE_SECRET_KEY
npx prisma migrate dev
npm run dev                 # http://localhost:8000
```

### 2. Worker
```bash
cd worker
npm install
cp .env.example .env        # same DATABASE_URL and REDIS_URL as backend
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_TURNSTILE_SITE_KEY
npm run dev                 # http://localhost:3000
```

### Or, run everything with Docker Compose
```bash
docker compose up -d --build
```

## Frontend routes

| Route | Auth | Description |
|-------|------|-------------|
| `/login` | — | Sign in |
| `/signup` | — | Create account (Turnstile-protected) |
| `/forgot-password`, `/reset-password` | — | Password recovery |
| `/verify-email` | — | Email verification |
| `/` | JWT | ICU monitor wall |
| `/manage` | JWT | Add/edit/delete monitors, assertions, public slug |
| `/settings` | JWT | Account settings, account deletion |
| `/status/[slug]` | — | Public read-only status page |
| `/privacy`, `/terms` | — | Policy pages |

## Key API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Fast liveness check |
| GET | `/health/deep` | Database + Redis connectivity check (for external uptime monitoring) |
| POST | `/signup` / `/login` | Auth (rate-limited) |
| POST | `/forgot-password` / `/reset-password` | Password recovery |
| GET | `/verify-email` / POST `/resend-verification` | Email verification |
| DELETE | `/me` | Delete account (cascades all user data) |
| GET/POST/PUT/DELETE | `/monitors` | Manage monitors |
| GET | `/status/:slug` | Public status page data |

## Environment variables

See `.env.example` in each service directory for the full list. Notable ones:

```
DATABASE_URL              # Postgres connection string (pooled for runtime, direct for migrations)
JWT_SECRET
REDIS_URL                 # redis://redis:6379 in Docker Compose
RESEND_API_KEY
FRONTEND_URL              # for CORS
TURNSTILE_SECRET_KEY      # backend
NEXT_PUBLIC_TURNSTILE_SITE_KEY   # frontend
NEXT_PUBLIC_API_URL       # frontend
```

## Deployment

Self-hosted on a DigitalOcean droplet:
1. Docker + Docker Compose run all three services
2. Nginx reverse-proxies traffic and terminates SSL (Let's Encrypt, auto-renewing)
3. Postgres is managed via Supabase; Redis is self-hosted in its own container
4. GitHub Actions deploys automatically on every push to `main` — see `.github/workflows/deploy.yml`

## Roadmap

- [ ] Google OAuth
- [ ] SMS / webhook alerts
- [ ] Multi-region checks
- [ ] Infrastructure as code (Terraform)

## Learnings

See [LEARNINGS.md](./LEARNINGS.md) for a running log of concepts learned, bugs debugged, and decisions made while building this project — from Docker networking and Prisma driver adapters to Nginx reverse proxying, DNS, and CI/CD.
