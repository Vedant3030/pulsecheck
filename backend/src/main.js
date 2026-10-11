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
import { decrypt, encrypt, requireEncryptionKey } from "./lib/crypto.js";
import { validateMonitorRequestFields, validateChainDefinition, validateMonitorType, MIN_CHAIN_INTERVAL_MINS } from "./lib/monitorValidation.js";
import { GuardError, guardedRequest, readCappedBody, requestWithRedirects, safeDestroy, silenceStreamErrors } from "./lib/ssrfGuard.js";
import { evaluateAssertions } from "./lib/assertions.js";
import { runChain, STEP_TIMEOUT_MS } from "./lib/chainRunner.js";

// Fail fast if ENCRYPTION_KEY is missing/malformed (names exactly what's wrong).
try {
  requireEncryptionKey();
} catch (err) {
  console.error(`Startup error: ${err.message}`);
  process.exit(1);
}

function toMonitorResponse(monitor) {
  const { encryptedAuthValue, steps, ...rest } = monitor;
  return {
    ...rest,
    hasAuth: !!encryptedAuthValue,
    ...(Array.isArray(steps) ? { steps: steps.map(toStepResponse) } : {}),
  };
}

function toStepResponse(step) {
  const { encryptedAuthValue, ...rest } = step || {};
  return { ...rest, hasAuth: !!(step && step.encryptedAuthValue) };
}

/**
 * Resolve a chain step's secret for create/update.
 * Explicit authValue always wins (encrypted). Otherwise, on update, an
 * id-matched stored secret is kept when authType is unchanged; authType
 * None (or absent auth) clears. Never logs or returns secrets.
 */
function resolveStepSecret(s, existingById) {
  const existing = s.id && existingById ? existingById.get(s.id) : null;
  if (s.authType) {
    if (typeof s.authValue === "string" && s.authValue.length > 0) {
      if (Buffer.byteLength(s.authValue, "utf8") > 2000) {
        return { error: `Step "${s.name}": authValue exceeds 2000 chars` };
      }
      return { clean: { encryptedAuthValue: encrypt(s.authValue) } };
    }
    if (existing && existing.authType === s.authType && existing.encryptedAuthValue) {
      return { clean: { encryptedAuthValue: existing.encryptedAuthValue } };
    }
    return { error: `Step "${s.name}": authValue is required when authType is set` };
  }
  if (typeof s.authValue === "string" && s.authValue.length > 0) {
    return { error: `Step "${s.name}": authType is required when authValue is set` };
  }
  return { clean: { encryptedAuthValue: null } };
}

/**
 * Validate nested per-step assertions and build Prisma payloads.
 * existingById matches update steps to stored secrets by step id.
 * Returns { steps: [step creates], assertionsByIndex: [[assertion creates]] }.
 * Assertion creates still need monitorId + stepId, attached by the caller
 * after rows exist (nested-nested creates can't fill both relations).
 */
function buildStepCreates(cleanSteps, existingById) {
  const steps = [];
  const assertionsByIndex = [];
  for (const s of cleanSteps) {
    const sec = resolveStepSecret(s, existingById);
    if (sec.error) return { error: sec.error };
    const assertionCreates = [];
    for (const a of s.assertions || []) {
      const ae = validateAssertionInput(a);
      if (ae) return { error: `Step "${s.name}" assertion: ${ae}` };
      assertionCreates.push({
        type: a.type,
        field: a.type === "JSON_FIELD_EQUALS" ? String(a.field).trim() : null,
        operator: a.operator,
        expectedValue: String(a.expectedValue),
      });
    }
    steps.push({
      order: s.order,
      name: s.name,
      method: s.method,
      url: s.url,
      requestBody: s.requestBody,
      requestHeaders: s.requestHeaders,
      authType: s.authType,
      authHeaderName: s.authType === "apiKey" ? s.authHeaderName : null,
      encryptedAuthValue: sec.clean.encryptedAuthValue,
      extracts: s.extracts,
    });
    assertionsByIndex.push(assertionCreates);
  }
  return { clean: { steps, assertionsByIndex } };
}

/** Persist steps + per-step assertions for a monitor inside a transaction. */
async function replaceMonitorSteps(tx, monitorId, stepPayload) {
  await tx.monitorAssertion.deleteMany({ where: { monitorId } });
  await tx.monitorStep.deleteMany({ where: { monitorId } });
  await tx.monitorStep.createMany({ data: stepPayload.steps.map((s) => ({ ...s, monitorId })) });
  const saved = await tx.monitorStep.findMany({ where: { monitorId } });
  const orderToId = new Map(saved.map((s) => [s.order, s.id]));
  for (let i = 0; i < stepPayload.steps.length; i++) {
    for (const a of stepPayload.assertionsByIndex[i]) {
      await tx.monitorAssertion.create({
        data: { ...a, monitorId, stepId: orderToId.get(i) },
      });
    }
  }
}

async function fetchFullMonitor(id) {
  return prisma.monitor.findUnique({
    where: { id },
    include: {
      steps: { include: { assertions: true }, orderBy: { order: "asc" } },
    },
  });
}

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

// One-off trial requests from the monitor form — bounded so it can't be
// used as an oracle/proxy at scale. Keyed by userId (requireAuth runs first).
const testRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  message: { ok: false, code: "rate_limited", message: "Too many test requests — please wait a minute and try again." },
});

// Stricter limiter for whole-chain dry-runs (up to 5 upstream requests each).
const chainTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
  message: { ok: false, code: "rate_limited", message: "Too many chain test requests — please wait a minute and try again." },
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
    const { url, name, intervalMins, authValue } = req.body;

    if (!url || !name) {
      return res.status(400).json({ error: "url and name are required" });
    }
    if (intervalMins != null && Number(intervalMins) < 1) {
      return res.status(400).json({ error: "Check interval must be at least 1 minute." });
    }

    const { error: typeError, clean: typeClean } = validateMonitorType(req.body.type);
    if (typeError) {
      return res.status(400).json({ error: typeError });
    }
    if (typeClean !== "chain" && req.body.steps !== undefined) {
      return res.status(400).json({ error: "steps require type \"chain\"" });
    }

    // ---- Chain monitors: ordered steps with per-step assertions ----
    if (typeClean === "chain") {
      const parsedMins = intervalMins != null ? Number(intervalMins) : 5;
      const mins = Number.isFinite(parsedMins) ? parsedMins : 5;
      if (mins < MIN_CHAIN_INTERVAL_MINS) {
        return res.status(400).json({ error: `Chain monitors must be checked at most every ${MIN_CHAIN_INTERVAL_MINS} minutes.` });
      }
      const vc = validateChainDefinition(req.body.steps);
      if (vc.error) {
        return res.status(400).json({ error: vc.error });
      }
      const built = buildStepCreates(vc.clean.steps, new Map());
      if (built.error) {
        return res.status(400).json({ error: built.error });
      }
      const first = vc.clean.steps[0];
      const created = await prisma.$transaction(async (tx) => {
        const m = await tx.monitor.create({
          data: {
            url: first.url,
            name,
            method: first.method,
            intervalMins: mins,
            userId: req.userId,
            type: "chain",
          },
        });
        await replaceMonitorSteps(tx, m.id, built.clean);
        return m;
      });

      await monitorQueue.upsertJobScheduler(
        `monitor-${created.id}`,
        { every: created.intervalMins * 60 * 1000 },
        { name: "check-monitor", data: { monitorId: created.id } }
      );

      res.status(201).json(toMonitorResponse(await fetchFullMonitor(created.id)));
      return;
    }

    const { error, clean } = validateMonitorRequestFields(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    // Auth secret handling: encrypt before storing, never log or echo.
    let encryptedAuthValue = null;
    if (clean.authType) {
      if (typeof authValue !== "string" || authValue.length === 0) {
        return res.status(400).json({ error: "authValue is required when authType is set" });
      }
      if (Buffer.byteLength(authValue, "utf8") > 2000) {
        return res.status(400).json({ error: "authValue exceeds 2000 chars" });
      }
      encryptedAuthValue = encrypt(authValue);
    } else if (typeof authValue === "string" && authValue.length > 0) {
      return res.status(400).json({ error: "authType is required when authValue is set" });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url,
        name,
        intervalMins: intervalMins || 5,
        userId: req.userId,
        type: "single",
        method: clean.method || "GET",
        requestBody: clean.requestBody ?? null,
        requestHeaders: clean.requestHeaders ?? null,
        authType: clean.authType,
        authHeaderName: clean.authType === "apiKey" ? clean.authHeaderName : null,
        encryptedAuthValue,
      },
    });

    // Schedule this monitor in BullMQ immediately
    await monitorQueue.upsertJobScheduler(
      `monitor-${monitor.id}`,
      { every: monitor.intervalMins * 60 * 1000 },
      { name: "check-monitor", data: { monitorId: monitor.id } }
    );

    res.status(201).json(toMonitorResponse(monitor));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Common HTTP reason phrases (undici doesn't expose the wire reason phrase).
function httpStatusText(code) {
  const map = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
    307: "Temporary Redirect", 308: "Permanent Redirect",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict",
    422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
  };
  return map[code] || "";
}

// Map probe failures to stable codes. Fixed strings only — never forward
// internal error text (it can contain resolver/socket internals).
function mapTestError(err) {
  if (err instanceof GuardError) {
    return { code: err.code, message: err.message };
  }
  if (err && err.code === "EBLOCKED") {
    return { code: "blocked_target", message: "This address isn't allowed: private and internal addresses can't be tested." };
  }
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { code: "timeout", message: "The request timed out after 10 seconds." };
  }
  const code = err && err.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { code: "dns_failure", message: "That hostname could not be resolved. Check the spelling and try again." };
  }
  if (code === "ECONNREFUSED") {
    return { code: "connection_refused", message: "The server refused the connection. Check the host and port." };
  }
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return { code: "connection_failed", message: "The connection failed before a response was received." };
  }
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || (err && /certificate/i.test(String(err.message || "")))) {
    return { code: "tls_error", message: "The server's TLS certificate could not be verified." };
  }
  return { code: "upstream_error", message: "The request failed before a response was received." };
}

// POST /monitors/test — one-off trial request from the create/edit form.
// Well-formed probes always answer 200 with { ok:true } (any HTTP status)
// or { ok:false, code, message }; only bad input / not-found / auth and
// rate limiting use non-200 statuses.
app.post("/monitors/test", requireAuth, testRequestLimiter, async (req, res) => {
  try {
    const { url, monitorId, authValue } = req.body;

    if (typeof url !== "string" || url.trim() === "") {
      return res.status(400).json({ ok: false, code: "invalid_input", message: "A URL is required." });
    }

    // Log-safe target: host + pathname only. Query strings and fragments
    // often carry tokens/secrets, so they must never reach the logs.
    let safeTarget = "(invalid url)";
    try {
      const parsed = new URL(url.trim());
      safeTarget = `${parsed.host}${parsed.pathname}`;
    } catch {}

    const { error, clean } = validateMonitorRequestFields(req.body);
    if (error) {
      return res.status(400).json({ ok: false, code: "invalid_input", message: error });
    }

    // Resolve the secret: an explicit value always wins; otherwise fall back
    // to the stored secret of monitorId (ownership-checked, decrypted here).
    // Neither the plaintext nor the ciphertext ever leaves the server.
    let secret = null;
    if (typeof authValue === "string" && authValue.length > 0) {
      if (!clean.authType) {
        return res.status(400).json({ ok: false, code: "invalid_input", message: "authType is required when authValue is set" });
      }
      if (Buffer.byteLength(authValue, "utf8") > 2000) {
        return res.status(400).json({ ok: false, code: "invalid_input", message: "authValue exceeds 2000 chars" });
      }
      secret = authValue;
    } else if (clean.authType) {
      if (!monitorId) {
        return res.status(400).json({ ok: false, code: "invalid_input", message: "authValue is required when authType is set" });
      }
      const monitor = await prisma.monitor.findUnique({ where: { id: String(monitorId) } });
      if (!monitor || monitor.userId !== req.userId || !monitor.encryptedAuthValue) {
        return res.status(404).json({ ok: false, code: "not_found", message: "Monitor not found." });
      }
      try {
        secret = decrypt(monitor.encryptedAuthValue);
      } catch {
        return res.status(400).json({ ok: false, code: "invalid_input", message: "The stored credential could not be read. Re-enter the secret and try again." });
      }
    }

    const method = clean.method || "GET";
    const headers = { ...(clean.requestHeaders || {}) };
    let body;
    if (clean.requestBody && method !== "GET") {
      body = clean.requestBody;
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }
    // Raw undici sends no User-Agent (unlike global fetch) and some hosts
    // 4xx requests without one — identify test probes unless overridden.
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
      headers["User-Agent"] = "PulseCheck/test-request";
    }
    if (clean.authType && secret) {
      if (clean.authType === "bearer") headers["Authorization"] = `Bearer ${secret}`;
      else headers[clean.authHeaderName || "X-API-Key"] = secret;
    }

    const start = Date.now();
    let upstream;
    try {
      upstream = await guardedRequest(url.trim(), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      const mapped = mapTestError(err);
      // Metadata only — host + path, never query/fragment, bodies, headers, or secrets.
      console.log(`[test-request] user=${req.userId} ${method} ${safeTarget} -> ${mapped.code} (${Date.now() - start}ms)`);
      return res.json({ ok: false, code: mapped.code, message: mapped.message });
    }

    // Read at most 64KB; preview is the first 4KB as text.
    // Listener attached before reading so break/destroy errors can't escape
    // as unhandled 'error' events.
    silenceStreamErrors(upstream.body);
    const MAX_READ = 64 * 1024;
    const chunks = [];
    let bytes = 0;
    let capped = false;
    try {
      for await (const chunk of upstream.body) {
        bytes += chunk.length;
        if (bytes > MAX_READ) {
          capped = true;
          break;
        }
        chunks.push(chunk);
      }
    } catch {
      capped = true;
    } finally {
      safeDestroy(upstream.body);
    }
    const full = Buffer.concat(chunks).slice(0, MAX_READ);
    const bodyTruncated = capped || bytes > 4096;
    const rawCt = upstream.headers["content-type"];
    const contentType = Array.isArray(rawCt) ? rawCt[0] : rawCt || null;
    const statusCode = upstream.statusCode;
    const redirectLocation =
      statusCode >= 300 && statusCode < 400 && typeof upstream.headers.location === "string"
        ? upstream.headers.location
        : undefined;
    const durationMs = Date.now() - start;

    console.log(`[test-request] user=${req.userId} ${method} ${safeTarget} -> ${statusCode} (${durationMs}ms)`);

    res.json({
      ok: true,
      statusCode,
      statusText: httpStatusText(statusCode),
      durationMs,
      contentType,
      bodyPreview: full.slice(0, 4096).toString("utf8"),
      bodyTruncated,
      ...(redirectLocation !== undefined ? { redirectLocation } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, code: "upstream_error", message: "Something went wrong" });
  }
});

// POST /monitors/test-chain — dry-run a whole chain from the form.
// Body: { steps: [...same shape as monitor steps, each with optional
// authValue and assertions...], monitorId? }. Per-step results carry a 2KB
// body preview and extract NAMES only (values masked). Extracted values,
// secrets, and response bodies are never returned, stored, or logged.
app.post("/monitors/test-chain", requireAuth, chainTestLimiter, async (req, res) => {
  try {
    const { steps, monitorId } = req.body;
    const vc = validateChainDefinition(steps);
    if (vc.error) {
      return res.status(400).json({ ok: false, code: "invalid_input", message: vc.error });
    }

    // Stored-secret fallback, matched by step index: explicit authValue wins;
    // otherwise the stored secret of the same-index step is used (ownership
    // checked). Neither plaintext nor ciphertext ever leaves the server.
    let storedSecrets = [];
    if (monitorId) {
      const monitor = await prisma.monitor.findUnique({
        where: { id: String(monitorId) },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      if (!monitor || monitor.userId !== req.userId) {
        return res.status(404).json({ ok: false, code: "not_found", message: "Monitor not found." });
      }
      storedSecrets = (monitor.steps || []).map((s) => ({
        authType: s.authType, encryptedAuthValue: s.encryptedAuthValue,
      }));
    }

    const runSteps = [];
    for (let i = 0; i < vc.clean.steps.length; i++) {
      const s = vc.clean.steps[i];
      const assayed = [];
      for (const a of s.assertions || []) {
        const ae = validateAssertionInput(a);
        if (ae) {
          return res.status(400).json({ ok: false, code: "invalid_input", message: `Step "${s.name}" assertion: ${ae}` });
        }
        assayed.push(a);
      }
      let secret = null;
      if (s.authType) {
        if (typeof s.authValue === "string" && s.authValue.length > 0) {
          if (Buffer.byteLength(s.authValue, "utf8") > 2000) {
            return res.status(400).json({ ok: false, code: "invalid_input", message: `Step "${s.name}": authValue exceeds 2000 chars` });
          }
          secret = s.authValue;
        } else {
          const stored = storedSecrets[i];
          if (!stored || stored.authType !== s.authType || !stored.encryptedAuthValue) {
            return res.status(400).json({ ok: false, code: "invalid_input", message: `Step "${s.name}": authValue is required when authType is set` });
          }
          try {
            secret = decrypt(stored.encryptedAuthValue);
          } catch {
            return res.status(400).json({ ok: false, code: "invalid_input", message: `Step "${s.name}": the stored credential could not be read. Re-enter the secret and try again.` });
          }
        }
      } else if (typeof s.authValue === "string" && s.authValue.length > 0) {
        return res.status(400).json({ ok: false, code: "invalid_input", message: `Step "${s.name}": authType is required when authValue is set` });
      }
      runSteps.push({ ...s, secret, assertions: assayed });
    }

    const startedAt = Date.now();
    // Per-step 2KB previews, collected in call order (runChain is strictly
    // sequential). Values themselves stay masked — names + flags only.
    const previews = [];
    const deps = {
      evaluate: (assertions, ctx) => evaluateAssertions(assertions, ctx),
      request: async (stepReq, timeoutMs) => {
        const headers = { ...(stepReq.headers || {}) };
        if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
          headers["User-Agent"] = "PulseCheck/test-request";
        }
        const t0 = Date.now();
        const upstream = await requestWithRedirects(
          stepReq.url,
          {
            method: stepReq.method, headers,
            keepHeaders: { "User-Agent": headers["User-Agent"] },
            body: stepReq.body, signal: AbortSignal.timeout(timeoutMs || STEP_TIMEOUT_MS),
          },
          5
        );
        // 512KB capture for assertions/extracts; 2KB preview for the panel.
        silenceStreamErrors(upstream.body);
        const capped = await readCappedBody(upstream, 512 * 1024);
        previews.push({ bodyPreview: capped.text.slice(0, 2048), bodyTruncated: capped.truncated || capped.text.length > 2048 });
        return {
          statusCode: upstream.statusCode, headers: upstream.headers || {},
          bodyText: capped.text, wasTruncated: capped.truncated,
          responseTimeMs: Date.now() - t0,
        };
      },
    };

    let result;
    try {
      result = await runChain(runSteps, deps);
    } catch (err) {
      const mapped = mapTestError(err);
      console.log(`[chain-test] user=${req.userId} chain(${runSteps.length} steps) -> ${mapped.code} (${Date.now() - startedAt}ms)`);
      return res.json({ ok: false, code: mapped.code, message: mapped.message });
    }

    // Previews align by call order: runChain runs steps strictly in order
    // and stops at the first failure, so previews[i] belongs to step i.
    // A step that never ran (stopped chain) gets a null preview.
    const panelSteps = result.stepResults.map((sr) => ({
      stepIndex: sr.stepIndex,
      name: sr.name,
      status: sr.status,
      statusCode: sr.statusCode,
      responseTimeMs: sr.responseTimeMs,
      error: sr.error,
      assertions: sr.assertions || [],
      extracts: (sr.extracts || []).map((e) => ({ variable: e.variable, extracted: !!e.extracted })),
      bodyPreview: previews[sr.stepIndex] ? previews[sr.stepIndex].bodyPreview : null,
      bodyTruncated: previews[sr.stepIndex] ? !!previews[sr.stepIndex].bodyTruncated : false,
    }));

    const failedName = result.status === "up" ? null : (result.stepResults[result.failedStepIndex]?.name ?? null);
    console.log(`[chain-test] user=${req.userId} chain(${runSteps.length} steps) -> ${result.status}${failedName ? ` step "${failedName}"` : ""} (${Date.now() - startedAt}ms)`);

    res.json({
      ok: true,
      status: result.status,
      failedStepIndex: result.failedStepIndex,
      steps: panelSteps,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, code: "upstream_error", message: "Something went wrong" });
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
        steps: {
          include: { assertions: true },
          orderBy: { order: "asc" },
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
        type: monitor.type ?? "single",
        steps: (monitor.steps || []).map(toStepResponse),
        status: latest?.status === "up" ? "up" : "down",
        responseTimeMs: latest?.responseTimeMs ?? null,
        statusCode: latest?.statusCode ?? null,
        checkedAt: latest?.checkedAt ?? null,
        stepResults: latest?.stepResults ?? null,
        sslMonitoringEnabled: monitor.sslMonitoringEnabled,
        certExpiresAt: monitor.certExpiresAt,
        lastSslCheckAt: monitor.lastSslCheckAt,
        sslAlertStage: monitor.sslAlertStage,
        domainMonitoringEnabled: monitor.domainMonitoringEnabled,
        domainExpiresAt: monitor.domainExpiresAt,
        lastDomainCheckAt: monitor.lastDomainCheckAt,
        domainAlertStage: monitor.domainAlertStage,
        method: monitor.method ?? "GET",
        requestBody: monitor.requestBody ?? null,
        requestHeaders: monitor.requestHeaders ?? null,
        authType: monitor.authType ?? null,
        authHeaderName: monitor.authHeaderName ?? null,
        hasAuth: !!monitor.encryptedAuthValue,
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

    const { type, field, operator, expectedValue, stepId } = req.body;

    // stepId links an assertion to one chain step. Single monitors must not
    // send it; chain monitors must send a stepId belonging to this monitor.
    let step = null;
    if (stepId !== undefined && stepId !== null && String(stepId).trim() !== "") {
      if ((monitor.type || "single") !== "chain") {
        return res.status(400).json({ error: "stepId is only allowed on chain monitors" });
      }
      step = await prisma.monitorStep.findUnique({ where: { id: String(stepId) } });
      if (!step || step.monitorId !== id) {
        return res.status(404).json({ error: "Step not found" });
      }
    } else if ((monitor.type || "single") === "chain") {
      return res.status(400).json({ error: "stepId is required on chain monitors" });
    }

    const assertion = await prisma.monitorAssertion.create({
      data: {
        monitorId: id,
        stepId: step ? step.id : null,
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
    const { url, name, intervalMins, isActive, sslMonitoringEnabled, domainMonitoringEnabled, authValue } = req.body;

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

    const { error: typeError, clean: typeClean } = validateMonitorType(req.body.type);
    if (typeError) {
      return res.status(400).json({ error: typeError });
    }
    const effectiveType = "type" in req.body ? typeClean : (monitor.type || "single");
    if ("type" in req.body) data.type = effectiveType;
    if ("steps" in req.body && effectiveType !== "chain") {
      return res.status(400).json({ error: "steps require type \"chain\"" });
    }
    const effectiveInterval = "intervalMins" in req.body && req.body.intervalMins != null
      ? Number(req.body.intervalMins)
      : monitor.intervalMins;
    if (effectiveType === "chain" && effectiveInterval < MIN_CHAIN_INTERVAL_MINS) {
      return res.status(400).json({ error: `Chain monitors must be checked at most every ${MIN_CHAIN_INTERVAL_MINS} minutes.` });
    }

    // ---- Chain steps replacement (transactional with the monitor update) ----
    let chainStepPayload = null;
    let switchingToSingle = false;
    if (effectiveType === "chain" && "steps" in req.body) {      const vc = validateChainDefinition(req.body.steps);
      if (vc.error) {
        return res.status(400).json({ error: vc.error });
      }
      const existingSteps = await prisma.monitorStep.findMany({ where: { monitorId: id } });
      const existingById = new Map(existingSteps.map((s) => [s.id, s]));
      for (const s of vc.clean.steps) {
        if (s.id && !existingById.has(s.id)) {
          return res.status(400).json({ error: `Step "${s.name}": unknown step id` });
        }
      }
      const built = buildStepCreates(vc.clean.steps, existingById);
      if (built.error) {
        return res.status(400).json({ error: built.error });
      }
      chainStepPayload = built.clean;
      // Keep the Monitor row mirrored to step 1 for lists/status pages.
      data.url = vc.clean.steps[0].url;
      data.method = vc.clean.steps[0].method;
    } else if (effectiveType === "chain") {
      // No step replacement — but a chain with zero stored steps is invalid
      // (e.g. switching single→chain without providing steps).
      const existingCount = await prisma.monitorStep.count({ where: { monitorId: id } });
      if (existingCount === 0) {
        return res.status(400).json({ error: "steps are required for chain monitors" });
      }
    } else if (effectiveType === "single" && monitor.type === "chain") {
      switchingToSingle = true;
      if (!("url" in req.body) || !req.body.url) {
        return res.status(400).json({ error: "url is required when switching to a single request monitor" });
      }
    }

    // --- HTTP request fields (shared strict validation) ---
    const REQUEST_KEYS = ["method", "requestBody", "requestHeaders", "authType", "authHeaderName", "authValue"];
    const touchesRequest = REQUEST_KEYS.some((k) => k in req.body);
    if (touchesRequest) {
      // Validate the effective final state (explicit values fall back to stored ones)
      // so the Authorization-collision rule sees the real combination.
      const effective = {
        method: "method" in req.body ? req.body.method : monitor.method,
        requestBody: "requestBody" in req.body ? req.body.requestBody : monitor.requestBody,
        requestHeaders: "requestHeaders" in req.body ? req.body.requestHeaders : monitor.requestHeaders,
        authType: "authType" in req.body ? req.body.authType : monitor.authType,
        authHeaderName: "authHeaderName" in req.body ? req.body.authHeaderName : monitor.authHeaderName,
      };
      const { error, clean } = validateMonitorRequestFields(effective);
      if (error) {
        return res.status(400).json({ error });
      }

      if ("method" in req.body) data.method = clean.method || "GET";
      if ("requestBody" in req.body) {
        data.requestBody = clean.requestBody ?? null;
      }
      if ("requestHeaders" in req.body) {
        data.requestHeaders = clean.requestHeaders ?? null;
      }

      const authTypeTouched = "authType" in req.body;
      const wantsClear = authTypeTouched && clean.authType === null;
      if (wantsClear) {
        data.authType = null;
        data.authHeaderName = null;
        data.encryptedAuthValue = null;
      } else {
        // Effective auth after this update (new value or stored).
        const effectiveAuth = authTypeTouched ? clean.authType : monitor.authType;
        if (typeof authValue === "string" && authValue.length > 0 && !effectiveAuth) {
          return res.status(400).json({ error: "authType is required when authValue is set" });
        }
        if (effectiveAuth) {
          data.authType = effectiveAuth;
          data.authHeaderName = effectiveAuth === "apiKey" ? clean.authHeaderName : null;
          if (typeof authValue === "string" && authValue.length > 0) {
            if (Buffer.byteLength(authValue, "utf8") > 2000) {
              return res.status(400).json({ error: "authValue exceeds 2000 chars" });
            }
            data.encryptedAuthValue = encrypt(authValue);
          } else if (!monitor.encryptedAuthValue || (authTypeTouched && monitor.authType !== effectiveAuth)) {
            // Setting auth fresh (or switching type) requires a secret.
            return res.status(400).json({ error: "authValue is required when authType is set" });
          }
          // else: empty secret + unchanged type → keep stored ciphertext untouched.
        } else if ("authHeaderName" in req.body) {
          data.authHeaderName = null;
        }
      }
    }

    let updated;
    if (chainStepPayload) {
      updated = await prisma.$transaction(async (tx) => {
        const m = await tx.monitor.update({ where: { id }, data });
        await replaceMonitorSteps(tx, id, chainStepPayload);
        return m;
      });
    } else if (switchingToSingle) {
      updated = await prisma.$transaction(async (tx) => {
        await tx.monitorAssertion.deleteMany({ where: { monitorId: id } });
        await tx.monitorStep.deleteMany({ where: { monitorId: id } });
        return tx.monitor.update({ where: { id }, data });
      });
    } else {
      updated = await prisma.monitor.update({
        where: { id },
        data,
      });
    }

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

    res.json(toMonitorResponse(await fetchFullMonitor(updated.id)));
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