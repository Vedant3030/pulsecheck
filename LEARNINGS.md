## Day 1 — [06/06/26]
- Set up backend with Express, npm, nvm-windows
- Fixed .gitignore issue (node_modules was almost committed) — learned why node_modules should never be tracked in git
- Fixed missing "dev" script and "type": "module" in package.json
- Built and verified first working endpoint: GET /health returns {status: "ok"}
- Next: PostgreSQL + Prisma setup for User model

## Day 2 — [07/06/26]
- Built /signup endpoint: bcrypt password hashing, Prisma create, duplicate email check
- Learned: Prisma 7 requires explicit driver adapters (@prisma/adapter-pg) — 
  `new PrismaClient()` no longer connects to Postgres automatically like older versions
- Learned: node --watch was restarting on node_modules changes — fixed with --watch-path=./src
- Learned: .env isn't auto-loaded by Node — needed `import "dotenv/config"` at top of main.js
- Verified: POST /signup creates a user, hashes password, returns id + email (no password in response)
- Next: build /login endpoint with JWT tokens.

## Day 3 — [10/06/26]
- Built /login endpoint: bcrypt.compare for password verification, jsonwebtoken for token issuing
- Learned: JWT tokens are signed (not encrypted) — they prove authenticity via signature, not secrecy
- Learned: same error message for "user not found" and "wrong password" prevents email enumeration
- Verified: POST /login returns a valid signed token for correct credentials
- Next: build a protected route + auth middleware to verify JWT tokens on future requests.

## Day 4 — [11/06/26]
- Built auth middleware (requireAuth) — verifies JWT from Authorization header
- Learned: middleware functions have signature (req, res, next) and run before route handlers
- Learned: middleware can attach data to `req` (e.g. req.userId) that flows to the actual route
- Built protected /me route to test the middleware
- Verified: /me fails without token, succeeds with valid token, returns correct user
- Next: build /monitors CRUD (the core feature) — protected by this same middleware

- Added Monitor model to Prisma schema (one-to-many relation with User)
- Built full /monitors CRUD: POST, GET, PUT, DELETE — all protected by requireAuth
- Learned: always check resource ownership (monitor.userId === req.userId) before update/delete,
  not just that the id exists — otherwise any user could edit/delete anyone's data
- Learned: req.params.id syntax for dynamic route segments (/monitors/:id)
- Debugged: stale Prisma Client after schema change — fixed with explicit `npx prisma generate`
- Verified: full CRUD cycle working via curl (create → read → update → delete → confirm empty)
- Next: Week 1 backend is essentially complete. Move to frontend (Next.js) or worker/ping logic

## Day 4 — [11/06/26]
- Added CheckResult model (linked to Monitor) to track ping history
- Built worker/ — separate Node process that pings all active monitors on an interval
- Used Node's built-in fetch() — no extra library needed for HTTP requests
- Learned (again): after any schema.prisma change, run BOTH migrate dev AND generate — 
  migrate dev doesn't always regenerate the client reliably in this Prisma version
- Verified: worker successfully checks a real URL (google.com) and saves status/response time
- Next: refine worker to respect each monitor's individual intervalMins, then start on frontend

## Day 5 — [12/06/26] — Frontend build (switched to Cursor)
- Scaffolded Next.js 15 (App Router, TypeScript, Tailwind 4) frontend
- Built /login and /signup pages wired to existing backend JWT auth
- Built private monitor wall (/) — polls /monitors every 10s, SVG waveform 
  visualization driven by real CheckResult history
- Built /manage page — full CRUD UI for monitors, matches backend routes
- Added public status page feature: user sets a slug (/me/public-slug),
  visitors view read-only status at /status/:slug — no auth needed
- Learned: JWT stored in localStorage for v1 — noted tradeoff (XSS risk) 
  vs httpOnly cookies as a "next iteration" decision, not an oversight
- Learned: switching to Cursor sped up frontend significantly vs building
  it turn-by-turn in chat — good fit for repetitive UI/CRUD work once
  backend fundamentals were already solid
- Next: enforce per-monitor intervalMins in worker (currently global 60s 
  regardless of each monitor's setting), then email alerts