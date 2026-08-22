import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import jwt from "jsonwebtoken";
import { requireAuth } from "./middleware/auth.js";
import { monitorQueue } from "./queue.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 8000;

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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/login", async (req, res) => {
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
    select: { id: true, email: true, createdAt: true, publicSlug: true },
  });
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
        select: { id: true, email: true, createdAt: true, publicSlug: true },
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
      select: { id: true, email: true, createdAt: true, publicSlug: true },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
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
      },
    });

    // Reverse so oldest is first, newest is last
    res.json(recentDesc.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// UPDATE a monitor
app.put("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, name, intervalMins, isActive } = req.body;

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const updated = await prisma.monitor.update({
      where: { id },
      data: { url, name, intervalMins, isActive },
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

    // Remove its scheduled job too
    await monitorQueue.removeJobScheduler(`monitor-${id}`);

    res.json({ message: "Monitor deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`PulseCheck API running on http://localhost:${PORT}`);
});