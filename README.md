```markdown
# PulseCheck

An uptime monitoring tool — add a URL, get alerted when it goes down,
share a public status page.

## Status
🚧 In development — Backend + worker complete, starting frontend (Next.js)

## Tech stack
- Backend: Node.js + Express
- Frontend: Next.js, Tailwind (in progress)
- Worker: Node.js background process (setInterval-based ping loop; will move to BullMQ + Redis)
- DB: PostgreSQL + Prisma ORM
- Auth: JWT + bcrypt
- Deployment (planned): Docker, Nginx, VPS

## Project structure
- `backend/` — Express API: auth, monitor CRUD, all protected routes
- `worker/` — background process that pings active monitors and logs results
- `frontend/` — Next.js UI (not yet built)
- Backend and worker share one Prisma schema (`backend/prisma/schema.prisma`)

## Architecture
User → Frontend (Next.js) → Backend API (Express, JWT-protected) → PostgreSQL
Worker (separate process) → pings monitored URLs → logs results to PostgreSQL
(diagram/screenshot to be added)

## Running locally

### Prerequisites
- Node.js (LTS), PostgreSQL running locally

### Backend
```
cd backend
npm install
npx prisma migrate dev
npm run dev   # http://localhost:8000
```

### Worker
```
cd worker
npm install
npm run dev   # pings active monitors every 60s
```

### Environment variables
Copy `.env.example` to `.env` in both `backend/` and `worker/`, and fill in your own `DATABASE_URL` and `JWT_SECRET`.

## API endpoints (backend)
- `POST /signup` — create account
- `POST /login` — returns JWT
- `GET /me` — current user (protected)
- `GET /monitors` — list your monitors (protected)
- `POST /monitors` — create a monitor (protected)
- `PUT /monitors/:id` — update a monitor (protected)
- `DELETE /monitors/:id` — delete a monitor (protected)

## Features
- [x] Auth (signup/login, JWT)
- [x] Add/edit/delete monitors
- [x] Background ping worker (basic interval-based)
- [ ] Per-monitor custom check intervals
- [ ] Frontend dashboard
- [ ] Email alerts
- [ ] Public status page
- [ ] Dockerized, deployed on VPS
- [ ] CI/CD via GitHub Actions

## Learnings
See `LEARNINGS.md` for a running log of concepts learned, bugs debugged, and decisions made while building this project.
```