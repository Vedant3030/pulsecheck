# Learnings log

## Day 1 — Backend setup
- Set up repo structure, root .gitignore, connected to GitHub
- Decided on Node.js/Express (not Python) — wanted full-stack JS consistency 
  and it fits the I/O-heavy nature of an uptime monitor
- Installed nvm-windows to manage Node versions instead of a fixed installer
- Fixed .gitignore issue (node_modules was almost committed) — learned why 
  node_modules should never be tracked in git
- Fixed missing "dev" script and "type": "module" in package.json
- Built and verified first working endpoint: GET /health returns {status: "ok"}

## Day 2 — Auth: signup, login, middleware
- Set up PostgreSQL locally + Prisma ORM, migrated first User model
- Built /signup: bcrypt.hash for password storage, Prisma create, duplicate 
  email check
- Learned: Prisma 7 requires explicit driver adapters (@prisma/adapter-pg) — 
  new PrismaClient() no longer connects to Postgres automatically
- Learned: Prisma 7's custom `output` path in schema.prisma can silently 
  redirect generated client location — remove it to use the default 
  node_modules/@prisma/client location
- Learned: after ANY schema.prisma change, always run BOTH 
  `npx prisma migrate dev` AND `npx prisma generate` — migrate doesn't 
  reliably auto-regenerate the client in this Prisma version
- Learned: node --watch restarts on node_modules changes — fixed with 
  --watch-path=./src
- Learned: .env isn't auto-loaded by Node — needed `import "dotenv/config"` 
  at the top of main.js
- Built /login: bcrypt.compare for verification, jsonwebtoken (jwt.sign) 
  to issue tokens
- Learned: JWT tokens are signed (not encrypted) — prove authenticity via 
  signature, not secrecy
- Learned: same error message for "user not found" and "wrong password" 
  prevents email enumeration
- Built requireAuth middleware — verifies JWT from Authorization header
- Learned: middleware = function (req, res, next); can attach data to req 
  (e.g. req.userId) that flows to the actual route handler
- Verified full auth flow end-to-end: signup → login → protected /me route

## Day 3 — Monitors CRUD
- Added Monitor model (one-to-many relation with User)
- Built full /monitors CRUD: POST, GET, PUT, DELETE — all protected by 
  requireAuth
- Learned: always check resource ownership (monitor.userId === req.userId) 
  before update/delete, not just that the id exists — otherwise any user 
  could edit/delete anyone's data
- Learned: req.params.id syntax for dynamic route segments (/monitors/:id)
- Verified full CRUD cycle via curl (create → read → update → delete → 
  confirm empty)

## Day 4 — Worker: background ping loop (v1)
- Added CheckResult model (linked to Monitor) to track ping history
- Built worker/ — separate Node process that pings all active monitors 
  on an interval
- Used Node's built-in fetch() — no extra library needed for HTTP requests
- Verified: worker successfully checks a real URL and saves status/response 
  time to the database

## Day 5 — Frontend build (switched to Cursor)
- Scaffolded Next.js 15 (App Router, TypeScript, Tailwind 4)
- Built /login and /signup pages wired to existing backend JWT auth
- Built private monitor wall (/) — polls /monitors every 10s, SVG waveform 
  visualization driven by real CheckResult history
- Built /manage page — full CRUD UI for monitors
- Added public status page: user sets a slug (/me/public-slug), visitors 
  view read-only status at /status/:slug — no auth needed
- Learned: JWT stored in localStorage for v1 — noted tradeoff (XSS risk) 
  vs httpOnly cookies as a "next iteration" decision, not an oversight
- Learned: switching to Cursor sped up frontend significantly vs building 
  it turn-by-turn in chat — good fit for repetitive UI/CRUD work once 
  backend fundamentals were already solid

## Day 6 — BullMQ + Redis (per-monitor intervals)
- Set up Upstash (managed Redis, free tier) — avoided native Windows Redis 
  install pain entirely
- Learned: BullMQ repeatable jobs — each monitor scheduled at ITS OWN 
  intervalMins, not one global loop checking everything at the same rate
- Learned: Queue (adds jobs) and Worker (processes jobs) are separate 
  concerns in BullMQ
- Verified real per-interval scheduling, including correct handling of a 
  genuine failed check (logged as "down" correctly)
- Fixed cascade delete bug: deleting a Monitor failed because Postgres's 
  RESTRICT constraint blocked it while CheckResult rows still referenced it
- Learned: RESTRICT (default) blocks parent deletion if children exist; 
  CASCADE auto-deletes children when parent is deleted
- Fixed: added onDelete: Cascade to CheckResult's relation in schema.prisma

## Day 7 — Wired BullMQ scheduling into backend routes
- Moved scheduling logic from a one-time script (worker/src/schedule.js) 
  into the backend API itself — POST/PUT/DELETE /monitors now sync BullMQ 
  automatically, no manual scheduling step needed
- Learned: BullMQ v6 replaced the older repeatable-jobs API 
  (getRepeatableJobs/removeRepeatableByKey) with Job Schedulers 
  (upsertJobScheduler/removeJobScheduler/getJobSchedulers) — always check 
  installed version (`npm list bullmq`) when following older examples/docs
- upsertJobScheduler() handles both "create" and "update interval" in one 
  call — simpler than the old remove-then-add pattern
- Verified end-to-end: created a monitor via curl, worker started checking 
  it automatically within its interval, with zero manual intervention

## Day 8 — Email alerts on status change
- Set up Resend (free tier email API) for sending alert emails
- Worker now compares each new check against the previous one 
  (prisma.checkResult.findFirst with orderBy checkedAt desc) — only sends 
  an alert if status actually changed (up→down or down→up), not on every check
- Learned: Prisma's `include` lets you fetch related data in one query 
  (include: { user: true } to get the monitor owner's email for alerting)
- Learned: first-ever check for a monitor never alerts (no previous check 
  to compare against) — correct behavior, not a bug
- Debugged "email not received": Resend dashboard confirmed "Delivered" — 
  turned out to be sitting in Gmail spam folder (common for new/shared 
  sender domains like onboarding@resend.dev on a fresh account)
- Verified full alert pipeline working end-to-end: status change detected 
  → email sent via Resend → confirmed delivered → found in spam → marked 
  not spam

## General patterns learned
- Terminal basics: pwd (where am I), cd .. (up one level), cd foldername 
  (into a subfolder) — run pwd whenever confused before cd-ing
- Git hygiene: always check/create .gitignore BEFORE first npm install or 
  git add .; run git status before every git add .; verify secrets never 
  tracked with `git ls-files | grep .env`
- git check-ignore -v <file> — debug why something isn't being ignored
- "Failed to connect... could not connect to server" on curl almost always 
  means the relevant server process isn't running
- Multi-process workflow: run backend, worker (and later frontend) each in 
  their own labeled terminal tab; keep one separate tab free for one-off 
  commands (curl, git) — never type test commands into a tab running a 
  long-lived process
- When copying example commands with placeholders (YOUR_TOKEN, THE_ID), 
  always double check every placeholder was replaced with a real value 
  before running