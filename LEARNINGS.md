## Day 1 — [06/06/26]
- Set up backend with Express, npm, nvm-windows
- Fixed .gitignore issue (node_modules was almost committed) — learned why node_modules should never be tracked in git
- Fixed missing "dev" script and "type": "module" in package.json
- Built and verified first working endpoint: GET /health returns {status: "ok"}
- Next: PostgreSQL + Prisma setup for User model