# PulseCheck

An uptime monitoring tool — add a URL, watch it on an ICU-style dashboard, and share a public status page.

## Status

🟢 **Core product working locally** — backend, worker, and frontend (ICU monitor wall, manage page, public status page).

## Tech stack

| Layer | Stack |
|-------|--------|
| **Backend** | Node.js, Express 5, Prisma 7, PostgreSQL, JWT + bcrypt |
| **Frontend** | Next.js 15 (App Router), TypeScript, Tailwind CSS 4 |
| **Worker** | Node.js background process (`setInterval` ping loop) |
| **Planned** | BullMQ + Redis, email alerts, Docker/VPS deploy, CI/CD |

## Project structure

```
pulsecheck/
├── backend/          Express API + Prisma schema/migrations
├── worker/           Pings active monitors, writes CheckResult rows
├── frontend/         Next.js ICU-style UI
└── LEARNINGS.md      Dev log
```

Backend and worker share one Prisma schema: `backend/prisma/schema.prisma`.

## Architecture

```
Operator → Frontend (Next.js :3000) → Backend API (Express :8000, JWT) → PostgreSQL
Visitor  → /status/:slug (no auth)   → Backend public routes          → PostgreSQL

Worker (separate process) → GET monitored URLs every 60s → writes CheckResult rows
```

## Running locally

### Prerequisites

- Node.js (LTS)
- PostgreSQL running locally

### 1. Database

```bash
cd backend
npm install
cp .env.example .env        # set DATABASE_URL and JWT_SECRET
npx prisma migrate dev
npm run dev                 # http://localhost:8000
```

### 2. Worker

```bash
cd worker
npm install
cp .env.example .env        # same DATABASE_URL as backend
npm run dev                 # pings active monitors every 60s
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                 # http://localhost:3000
```

All three processes must be running for live status updates.

## Frontend routes

| Route | Auth | Description |
|-------|------|-------------|
| `/login` | — | Sign in |
| `/signup` | — | Create account (auto-login after signup) |
| `/` | JWT | Private ICU monitor wall (waveform strips, 10s poll) |
| `/manage` | JWT | Add/edit/delete monitors, set public slug |
| `/status/[slug]` | — | Public read-only status page |

JWT is stored in `localStorage` for v1 (httpOnly cookies planned later).

## API endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | API liveness |
| POST | `/signup` | Create account `{ email, password }` |
| POST | `/login` | Returns `{ token, email }` |
| GET | `/status/:slug` | Public monitor list with latest status |
| GET | `/status/:slug/monitors/:id/checks?limit=60` | Public check history for waveforms |

### Protected (Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/me` | Current user `{ id, email, publicSlug, createdAt }` |
| PUT | `/me/public-slug` | Set/clear public page slug `{ publicSlug }` |
| GET | `/monitors` | List monitors with latest check status |
| POST | `/monitors` | Create monitor `{ name, url, intervalMins? }` |
| PUT | `/monitors/:id` | Update monitor |
| DELETE | `/monitors/:id` | Delete monitor |
| GET | `/monitors/:id/checks?limit=60` | Check history (oldest → newest) |

### Monitor response shape (GET /monitors)

```json
{
  "id": "...",
  "name": "Production API",
  "url": "https://example.com",
  "intervalMins": 5,
  "isActive": true,
  "status": "up",
  "responseTimeMs": 142,
  "statusCode": 200,
  "checkedAt": "2026-08-12T06:00:00.000Z"
}
```

## Environment variables

**backend/.env**
```
DATABASE_URL=postgresql://postgres:password@localhost:5433/pulsecheck
JWT_SECRET=your-secret-here
FRONTEND_URL=http://localhost:3000   # optional, for CORS
```

**worker/.env**
```
DATABASE_URL=postgresql://postgres:password@localhost:5433/pulsecheck
```

**frontend/.env.local**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Features

- [x] Auth (signup, login, logout, JWT)
- [x] ICU-style monitor wall (SVG waveforms driven by real check history)
- [x] Add / edit / delete monitors (manage page)
- [x] Background ping worker (60s global interval)
- [x] Loading + empty states
- [x] Public status page (`/status/:slug`)
- [x] Public slug configuration on manage page
- [ ] Per-monitor custom check intervals (stored, not yet enforced by worker)
- [ ] Email alerts
- [ ] httpOnly cookie auth
- [ ] Dockerized deploy on VPS
- [ ] CI/CD via GitHub Actions

## Quick test (PowerShell)

```powershell
# Create account
Invoke-RestMethod -Uri http://localhost:8000/signup -Method POST -ContentType "application/json" -Body '{"email":"you@example.com","password":"yourpassword"}'

# Or sign in at http://localhost:3000/login
```

## Learnings

See [LEARNINGS.md](./LEARNINGS.md) for a running log of concepts learned, bugs debugged, and decisions made while building this project.
