import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import jwt from "jsonwebtoken";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { requireAuth } from "./middleware/auth.js";
import { connection as redisConnection, heartbeatQueue, monitorQueue, sslDomainQueue } from "./queue.js";
import heartbeatsRouter from "./routes/heartbeats.js";
import heartbeatPingRouter from "./routes/heartbeatPing.js";
import { generateRawToken, hashToken } from "./lib/tokens.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./lib/email.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 8000;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again in 15 minutes." },
});

const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  message: { error: "Too many verification requests, please try again later." },
});

// Support multiple allowed origins (local dev + production), comma-separated
// via FRONTEND_URL env var, e.g. "http://localhost:3000,https://pulsecheck-frontend.onrender.com"
const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:3000"
)
  .split(",")
  .map((url) => url.trim());

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

function validatePublicSlug(slug) {
  if (!SLUG_REGEX.test(slug)) {
    return "Slug must be 3–32 characters: lowercase letters, numbers, hyphens";
  }
  return null;
}

function toMonitorStatus(latest) {
  return latest?.status === "up" ? "up" : "down";
}

function toPublicMonitor(monitor) {
  const latest = monitor.checks[0];
  return {
    id: monitor.id,
    name: monitor.name,
    status: toMonitorStatus(latest),
    responseTimeMs: latest?.responseTimeMs ?? null,
    statusCode: latest?.statusCode ?? null,
    checkedAt: latest?.checkedAt ?? null,
  };
}

// Allow the Next.js frontend to call this API from the browser
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json()); // lets Express read JSON request bodies

// Heartbeat routes (ADDITIVE — do not touch existing Monitor/Check routes)
app.use("/api/heartbeats", heartbeatsRouter);
app.use("/api/heartbeat", heartbeatPingRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Deep health — for external monitoring of PulseCheck itself.
// Verifies DB + Redis; 200 only when every dependency responds.
// Timeouts keep a down dependency from hanging the endpoint (ioredis
// queues commands while reconnecting, so a bare ping may never settle).
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

app.get("/health/deep", async (req, res) => {
  const checks = { database: "ok", redis: "ok" };
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 5000, "database");
  } catch (err) {
    console.error("Deep health: database check failed:", err.message);
    checks.database = "fail";
  }
  try {
    await withTimeout(redisConnection.ping(), 5000, "redis");
  } catch (err) {
    console.error("Deep health: redis check failed:", err.message);
    checks.redis = "fail";
  }
  const healthy = checks.database === "ok" && checks.redis === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
  });
});

async function verifyTurnstileToken(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY missing — rejecting signup");
    return false;
  }
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp) params.append("remoteip", remoteIp);
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await resp.json();
    if (!data.success) {
      console.error("Turnstile verification failed:", data["error-codes"]);
    }
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err.message);
    return false;
  }
}

app.post("/signup", authLimiter, async (req, res) => {
  try {
    const { email, password, turnstileToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (!turnstileToken || typeof turnstileToken !== "string") {
      return res.status(400).json({ error: "Human verification required. Please complete the check." });
    }

    const human = await verifyTurnstileToken(turnstileToken, req.ip);
    if (!human) {
      return res.status(400).json({ error: "Human verification failed. Please try again." });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    // Send verification email (soft-fail — don't block signup)
    try {
      const raw = generateRawToken();
      const tokenHash = hashToken(raw);
      await prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await sendVerificationEmail(user.email, raw);
    } catch (e) {
      console.error("Failed to send verification email:", e.message);
    }

    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, createdAt: true, publicSlug: true, emailVerified: true },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(user);
});

// Set or clear the public status page slug for the logged-in user
app.put("/me/public-slug", requireAuth, async (req, res) => {
  try {
    const { publicSlug } = req.body;

    if (publicSlug === null || publicSlug === "") {
      const user = await prisma.user.update({
        where: { id: req.userId },
        data: { publicSlug: null },
        select: { id: true, email: true, createdAt: true, publicSlug: true, emailVerified: true },
      });
      return res.json(user);
    }

    const slug = String(publicSlug).trim().toLowerCase();
    const slugError = validatePublicSlug(slug);
    if (slugError) {
      return res.status(400).json({ error: slugError });
    }

    const taken = await prisma.user.findFirst({
      where: { publicSlug: slug, id: { not: req.userId } },
    });
    if (taken) {
      return res.status(409).json({ error: "Slug already taken" });
    }

    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { publicSlug: slug },
        select: { id: true, email: true, createdAt: true, publicSlug: true, emailVerified: true },
      });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE own account — password confirmation required.
// Removes BullMQ schedulers first (best-effort), then deletes the user row;
// Monitors, CheckResults, Assertions, Heartbeats, tokens cascade via FK.
app.delete("/me", requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "Please enter your password to confirm deletion." });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const monitors = await prisma.monitor.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });
    const heartbeats = await prisma.heartbeatMonitor.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });

    for (const monitor of monitors) {
      try {
        await withTimeout(monitorQueue.removeJobScheduler(`monitor-${monitor.id}`), 5000, "scheduler");
      } catch (err) {
        console.error(`Account delete: failed to remove monitor scheduler ${monitor.id}:`, err.message);
      }
      try {
        await withTimeout(sslDomainQueue.removeJobScheduler(`ssl-domain-check-${monitor.id}`), 5000, "scheduler");
      } catch (err) {
        console.error(`Account delete: failed to remove ssl-domain scheduler ${monitor.id}:`, err.message);
      }
    }
    for (const heartbeat of heartbeats) {
      try {
        await withTimeout(heartbeatQueue.removeJobScheduler(`heartbeat-${heartbeat.id}`), 5000, "scheduler");
      } catch (err) {
        console.error(`Account delete: failed to remove heartbeat scheduler ${heartbeat.id}:`, err.message);
      }
    }

    await prisma.user.delete({ where: { id: req.userId } });
    return res.json({ message: "Account deleted." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

// ---- Auth: password reset + email verification ----
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const generic = { message: "If an account with that email exists, a reset link has been sent." };
    if (!email || typeof email !== "string") return res.json(generic);
    const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
    if (!user) return res.json(generic);
    // Invalidate prior tokens
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    try {
      await sendPasswordResetEmail(user.email, raw);
    } catch (e) {
      console.error("Failed to send reset email:", e.message);
    }
    return res.json(generic);
  } catch (err) {
    console.error(err);
    return res.json({ message: "If an account with that email exists, a reset link has been sent." });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: "Token and new password are required." });
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    const tokenHash = hashToken(String(token).trim());
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record) return res.status(400).json({ error: "Invalid or expired reset token." });
    if (record.usedAt) return res.status(400).json({ error: "This reset link has already been used." });
    if (record.expiresAt < new Date()) {
      await prisma.passwordResetToken.delete({ where: { id: record.id } });
      return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: record.userId }, data: { password: hashedPassword } });
    await prisma.passwordResetToken.delete({ where: { id: record.id } });
    return res.json({ message: "Password has been reset. You can now sign in." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ error: "Verification token is required." });
    const tokenHash = hashToken(token);
    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record) return res.status(400).json({ error: "Invalid or expired verification link." });
    if (record.expiresAt < new Date()) {
      await prisma.emailVerificationToken.delete({ where: { id: record.id } });
      return res.status(400).json({ error: "Verification link has expired. Please request a new one." });
    }
    await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } });
    await prisma.emailVerificationToken.delete({ where: { id: record.id } });
    return res.json({ message: "Email verified successfully." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/resend-verification", requireAuth, resendVerificationLimiter, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.emailVerified) return res.status(400).json({ error: "Email is already verified." });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    await sendVerificationEmail(user.email, raw);
    return res.json({ message: "Verification email sent." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

// PUBLIC — read-only status page (no auth)
app.get("/status/:slug", async (req, res) => {
  try {
    const slug = req.params.slug.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { publicSlug: slug },
      select: { id: true, publicSlug: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Status page not found" });
    }

    const monitors = await prisma.monitor.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
      include: {
        checks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
        },
      },
    });

    res.json({
      slug: user.publicSlug,
      monitors: monitors.map(toPublicMonitor),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// PUBLIC — check history for one monitor on a status page
app.get("/status/:slug/monitors/:monitorId/checks", async (req, res) => {
  try {
    const slug = req.params.slug.trim().toLowerCase();
    const { monitorId } = req.params;
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(raw) ? raw : 60, 120);

    const user = await prisma.user.findUnique({
      where: { publicSlug: slug },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: "Status page not found" });
    }

    const monitor = await prisma.monitor.findFirst({
      where: { id: monitorId, userId: user.id, isActive: true },
    });

    if (!monitor) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const recentDesc = await prisma.checkResult.findMany({
      where: { monitorId },
      orderBy: { checkedAt: "desc" },
      take: limit,
      select: {
        status: true,
        responseTimeMs: true,
        statusCode: true,
        checkedAt: true,
      },
    });

    res.json(recentDesc.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// CREATE a monitor
app.post("/monitors", requireAuth, async (req, res) => {
  try {
    const { url, name, intervalMins } = req.body;

    if (!url || !name) {
      return res.status(400).json({ error: "url and name are required" });
    }
    if (intervalMins != null && Number(intervalMins) < 1) {
      return res.status(400).json({ error: "Check interval must be at least 1 minute." });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url,
        name,
        intervalMins: intervalMins || 5,
        userId: req.userId,
      },
    });

    // Schedule this monitor in BullMQ immediately
    await monitorQueue.upsertJobScheduler(
      `monitor-${monitor.id}`,
      { every: monitor.intervalMins * 60 * 1000 },
      { name: "check-monitor", data: { monitorId: monitor.id } }
    );

    res.status(201).json(monitor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// READ all monitors for the logged-in user (includes latest check status)
app.get("/monitors", requireAuth, async (req, res) => {
  try {
    const monitors = await prisma.monitor.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: {
        checks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
        },
      },
    });

    const result = monitors.map((monitor) => {
      const latest = monitor.checks[0];
      return {
        id: monitor.id,
        name: monitor.name,
        url: monitor.url,
        intervalMins: monitor.intervalMins,
        isActive: monitor.isActive,
        createdAt: monitor.createdAt,
        status: latest?.status === "up" ? "up" : "down",
        responseTimeMs: latest?.responseTimeMs ?? null,
        statusCode: latest?.statusCode ?? null,
        checkedAt: latest?.checkedAt ?? null,
        sslMonitoringEnabled: monitor.sslMonitoringEnabled,
        certExpiresAt: monitor.certExpiresAt,
        lastSslCheckAt: monitor.lastSslCheckAt,
        sslAlertStage: monitor.sslAlertStage,
        domainMonitoringEnabled: monitor.domainMonitoringEnabled,
        domainExpiresAt: monitor.domainExpiresAt,
        lastDomainCheckAt: monitor.lastDomainCheckAt,
        domainAlertStage: monitor.domainAlertStage,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// READ check history for a monitor (most recent last)
app.get("/monitors/:id/checks", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(raw) ? raw : 60, 120);

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const recentDesc = await prisma.checkResult.findMany({
      where: { monitorId: id },
      orderBy: { checkedAt: "desc" },
      take: limit,
      select: {
        status: true,
        responseTimeMs: true,
        statusCode: true,
        checkedAt: true,
        assertionResults: true,
      },
    });

    // Reverse so oldest is first, newest is last
    res.json(recentDesc.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ---- Monitor Assertions (ADDITIVE — JSON/body checks layered on existing status-code check) ----
const VALID_TYPES = ["STATUS_CODE", "RESPONSE_TIME", "BODY_CONTAINS", "JSON_FIELD_EQUALS"];
const VALID_OPERATORS = ["EQUALS", "CONTAINS", "LESS_THAN", "GREATER_THAN"];

function validateAssertionInput(body) {
  const { type, field, operator, expectedValue } = body;

  if (!VALID_TYPES.includes(type)) {
    return `type must be one of ${VALID_TYPES.join(", ")}`;
  }
  if (!VALID_OPERATORS.includes(operator)) {
    return `operator must be one of ${VALID_OPERATORS.join(", ")}`;
  }
  if (expectedValue == null || String(expectedValue).trim() === "") {
    return "expectedValue is required";
  }

  // JSON_FIELD_EQUALS requires field; others must have field null
  if (type === "JSON_FIELD_EQUALS") {
    if (!field || typeof field !== "string" || !field.trim()) {
      return "field is required for JSON_FIELD_EQUALS (e.g. \"data.status\")";
    }
  } else {
    if (field != null && String(field).trim() !== "") {
      return `field must be null for ${type} (only JSON_FIELD_EQUALS uses field)`;
    }
  }

  // Strict operator/type matching
  if (type === "STATUS_CODE" && operator !== "EQUALS") {
    return "STATUS_CODE only supports EQUALS (e.g. expectedValue \"200\")";
  }
  if (type === "BODY_CONTAINS" && !["CONTAINS", "EQUALS"].includes(operator)) {
    return "BODY_CONTAINS only supports CONTAINS or EQUALS";
  }
  if ((operator === "LESS_THAN" || operator === "GREATER_THAN") && !["RESPONSE_TIME", "JSON_FIELD_EQUALS"].includes(type)) {
    return "LESS_THAN/GREATER_THAN only for RESPONSE_TIME or numeric JSON_FIELD_EQUALS";
  }
  if ((operator === "LESS_THAN" || operator === "GREATER_THAN") && type === "JSON_FIELD_EQUALS" && isNaN(Number(expectedValue))) {
    return "LESS_THAN/GREATER_THAN on JSON_FIELD_EQUALS requires numeric expectedValue";
  }
  if (type === "RESPONSE_TIME" && isNaN(Number(expectedValue))) {
    return "RESPONSE_TIME expectedValue must be numeric (milliseconds)";
  }
  if (type === "STATUS_CODE" && isNaN(Number(expectedValue))) {
    return "STATUS_CODE expectedValue must be numeric (e.g. \"200\")";
  }

  return null;
}

// POST /monitors/:id/assertions — create
app.post("/monitors/:id/assertions", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const monitor = await prisma.monitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const error = validateAssertionInput(req.body);
    if (error) return res.status(400).json({ error });

    const { type, field, operator, expectedValue } = req.body;

    const assertion = await prisma.monitorAssertion.create({
      data: {
        monitorId: id,
        type,
        field: type === "JSON_FIELD_EQUALS" ? String(field).trim() : null,
        operator,
        expectedValue: String(expectedValue),
      },
    });

    res.status(201).json(assertion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GET /monitors/:id/assertions — list
app.get("/monitors/:id/assertions", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const monitor = await prisma.monitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const assertions = await prisma.monitorAssertion.findMany({
      where: { monitorId: id },
      orderBy: { createdAt: "desc" },
    });

    res.json(assertions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE /monitors/:id/assertions/:assertionId
app.delete("/monitors/:id/assertions/:assertionId", requireAuth, async (req, res) => {
  try {
    const { id, assertionId } = req.params;
    const monitor = await prisma.monitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const assertion = await prisma.monitorAssertion.findUnique({ where: { id: assertionId } });
    if (!assertion || assertion.monitorId !== id) {
      return res.status(404).json({ error: "Assertion not found" });
    }

    await prisma.monitorAssertion.delete({ where: { id: assertionId } });
    res.json({ message: "Assertion deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// UPDATE a monitor — also handles SSL/domain expiry flags (additive, not touching uptime logic)
app.put("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, name, intervalMins, isActive, sslMonitoringEnabled, domainMonitoringEnabled } = req.body;

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    if (intervalMins != null && Number(intervalMins) < 1) {
      return res.status(400).json({ error: "Check interval must be at least 1 minute." });
    }
    if (sslMonitoringEnabled !== undefined && typeof sslMonitoringEnabled !== "boolean") {
      return res.status(400).json({ error: "sslMonitoringEnabled must be a boolean" });
    }
    if (domainMonitoringEnabled !== undefined && typeof domainMonitoringEnabled !== "boolean") {
      return res.status(400).json({ error: "domainMonitoringEnabled must be a boolean" });
    }

    const data = { url, name, intervalMins, isActive };
    if (sslMonitoringEnabled !== undefined) data.sslMonitoringEnabled = sslMonitoringEnabled;
    if (domainMonitoringEnabled !== undefined) data.domainMonitoringEnabled = domainMonitoringEnabled;

    const updated = await prisma.monitor.update({
      where: { id },
      data,
    });

    // Re-add it only if still active
    if (updated.isActive) {
      await monitorQueue.upsertJobScheduler(
        `monitor-${updated.id}`,
        { every: updated.intervalMins * 60 * 1000 },
        { name: "check-monitor", data: { monitorId: updated.id } }
      );
    } else {
      // If deactivated, remove the schedule entirely
      await monitorQueue.removeJobScheduler(`monitor-${updated.id}`);
    }

    // SSL/domain expiry scheduling — orthogonal to isActive per spec
    // Fix A: per-flag immediate trigger (was global !hadBefore && hasNow, missed second flag enable on YT)
    const sslWasJustEnabled = !monitor.sslMonitoringEnabled && updated.sslMonitoringEnabled;
    const domainWasJustEnabled = !monitor.domainMonitoringEnabled && updated.domainMonitoringEnabled;

    if (updated.sslMonitoringEnabled || updated.domainMonitoringEnabled) {
      await sslDomainQueue.upsertJobScheduler(
        `ssl-domain-check-${updated.id}`,
        { every: 24 * 60 * 60 * 1000 },
        { name: "check-ssl-domain", data: { monitorId: updated.id } }
      );
      // Immediate first data point per-flag (don't make user wait 24h for YT domain after SSL already enabled)
      if (sslWasJustEnabled || domainWasJustEnabled) {
        await sslDomainQueue.add(
          "check-ssl-domain",
          { monitorId: updated.id },
          { jobId: `immediate-${updated.id}-${Date.now()}` }
        );
      }
    } else {
      // Both flags disabled → clean up scheduler
      await sslDomainQueue.removeJobScheduler(`ssl-domain-check-${updated.id}`);
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE a monitor
app.delete("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    await prisma.monitor.delete({ where: { id } });

    // Remove its scheduled jobs too
    await monitorQueue.removeJobScheduler(`monitor-${id}`);
    await sslDomainQueue.removeJobScheduler(`ssl-domain-check-${id}`);

    res.json({ message: "Monitor deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`PulseCheck API running on http://localhost:${PORT}`);
});