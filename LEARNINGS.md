## Day 1 — [06/06/26]
- Set up backend with Express, npm, nvm-windows
- Fixed .gitignore issue (node_modules was almost committed) — learned why node_modules should never be tracked in git
- Fixed missing "dev" script and "type": "module" in package.json
- Built and verified first working endpoint: GET /health returns {status: "ok"}
- Next: PostgreSQL + Prisma setup for User model

## Day X — [07/06/26]
- Built /signup endpoint: bcrypt password hashing, Prisma create, duplicate email check
- Learned: Prisma 7 requires explicit driver adapters (@prisma/adapter-pg) — 
  `new PrismaClient()` no longer connects to Postgres automatically like older versions
- Learned: node --watch was restarting on node_modules changes — fixed with --watch-path=./src
- Learned: .env isn't auto-loaded by Node — needed `import "dotenv/config"` at top of main.js
- Verified: POST /signup creates a user, hashes password, returns id + email (no password in response)
- Next: build /login endpoint with JWT tokens.

## Day X — [10/06/26]
- Built /login endpoint: bcrypt.compare for password verification, jsonwebtoken for token issuing
- Learned: JWT tokens are signed (not encrypted) — they prove authenticity via signature, not secrecy
- Learned: same error message for "user not found" and "wrong password" prevents email enumeration
- Verified: POST /login returns a valid signed token for correct credentials
- Next: build a protected route + auth middleware to verify JWT tokens on future requests.

## Day X — [11/06/26]
- Built auth middleware (requireAuth) — verifies JWT from Authorization header
- Learned: middleware functions have signature (req, res, next) and run before route handlers
- Learned: middleware can attach data to `req` (e.g. req.userId) that flows to the actual route
- Built protected /me route to test the middleware
- Verified: /me fails without token, succeeds with valid token, returns correct user
- Next: build /monitors CRUD (the core feature) — protected by this same middleware