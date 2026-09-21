import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { heartbeatQueue } from "../queue.js";
import { generateHeartbeatSlug } from "../lib/heartbeatSlug.js";
import { prisma } from "../lib/prisma.js";

const router = express.Router();

function validateHeartbeatInput(body) {
  const { name, expectedIntervalSeconds, gracePeriodSeconds } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return "name is required";
  }
  if (
    expectedIntervalSeconds == null ||
    !Number.isInteger(expectedIntervalSeconds) ||
    expectedIntervalSeconds <= 0
  ) {
    return "expectedIntervalSeconds must be a positive integer (seconds)";
  }
  if (
    gracePeriodSeconds == null ||
    !Number.isInteger(gracePeriodSeconds) ||
    gracePeriodSeconds < 0
  ) {
    return "gracePeriodSeconds must be a non-negative integer (seconds)";
  }
  return null;
}

async function generateUniqueSlug() {
  for (let i = 0; i < 5; i++) {
    const slug = generateHeartbeatSlug();
    const existing = await prisma.heartbeatMonitor.findUnique({ where: { slug } });
    if (!existing) return slug;
  }
  // Extremely unlikely fallback — use cuid-style with timestamp
  return generateHeartbeatSlug() + Date.now().toString(36);
}

async function scheduleHeartbeat(monitor) {
  const intervalMs = (monitor.expectedIntervalSeconds + monitor.gracePeriodSeconds) * 1000;
  await heartbeatQueue.upsertJobScheduler(
    `heartbeat-${monitor.id}`,
    { every: intervalMs },
    { name: "check-heartbeat", data: { heartbeatMonitorId: monitor.id } }
  );
}

// POST /api/heartbeats — create
router.post("/", requireAuth, async (req, res) => {
  try {
    const error = validateHeartbeatInput(req.body);
    if (error) return res.status(400).json({ error });

    const { name, expectedIntervalSeconds, gracePeriodSeconds, isActive } = req.body;
    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }
    const slug = await generateUniqueSlug();

    const monitor = await prisma.heartbeatMonitor.create({
      data: {
        userId: req.userId,
        name: name.trim(),
        slug,
        expectedIntervalSeconds,
        gracePeriodSeconds,
        isActive: isActive ?? true,
      },
    });

    if (monitor.isActive) {
      await scheduleHeartbeat(monitor);
    }

    res.status(201).json(monitor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GET /api/heartbeats — list current user's monitors
router.get("/", requireAuth, async (req, res) => {
  try {
    const monitors = await prisma.heartbeatMonitor.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(monitors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GET /api/heartbeats/:id — single
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const monitor = await prisma.heartbeatMonitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Heartbeat monitor not found" });
    }
    res.json(monitor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// PATCH /api/heartbeats/:id — update name/interval/grace
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const monitor = await prisma.heartbeatMonitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Heartbeat monitor not found" });
    }

    const data = {};
    if (req.body.name !== undefined) {
      if (!req.body.name || typeof req.body.name !== "string" || !req.body.name.trim()) {
        return res.status(400).json({ error: "name must be a non-empty string" });
      }
      data.name = req.body.name.trim();
    }
    if (req.body.expectedIntervalSeconds !== undefined) {
      if (!Number.isInteger(req.body.expectedIntervalSeconds) || req.body.expectedIntervalSeconds <= 0) {
        return res.status(400).json({ error: "expectedIntervalSeconds must be a positive integer" });
      }
      data.expectedIntervalSeconds = req.body.expectedIntervalSeconds;
    }
    if (req.body.gracePeriodSeconds !== undefined) {
      if (!Number.isInteger(req.body.gracePeriodSeconds) || req.body.gracePeriodSeconds < 0) {
        return res.status(400).json({ error: "gracePeriodSeconds must be a non-negative integer" });
      }
      data.gracePeriodSeconds = req.body.gracePeriodSeconds;
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") {
        return res.status(400).json({ error: "isActive must be a boolean" });
      }
      data.isActive = req.body.isActive;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update (name, expectedIntervalSeconds, gracePeriodSeconds, isActive)" });
    }

    // Option A fix: resuming from paused resets clock so it doesn't immediately fire DOWN
    const isResuming = monitor.isActive === false && data.isActive === true;
    if (isResuming) {
      data.lastPingAt = new Date();
      data.status = "UP";
    }

    const updated = await prisma.heartbeatMonitor.update({ where: { id }, data });

    // Re-schedule only if active; if paused, remove scheduler so worker skips it
    if (updated.isActive === false) {
      await heartbeatQueue.removeJobScheduler(`heartbeat-${updated.id}`);
    } else {
      await scheduleHeartbeat(updated);
      // If resuming, also record a fresh UP check so history reflects the reset
      if (isResuming) {
        try {
          await prisma.heartbeatCheck.create({
            data: { heartbeatMonitorId: updated.id, status: "UP" },
          });
        } catch {}
      }
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE /api/heartbeats/:id — also remove scheduler
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const monitor = await prisma.heartbeatMonitor.findUnique({ where: { id } });
    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Heartbeat monitor not found" });
    }

    await prisma.heartbeatMonitor.delete({ where: { id } });

    // Clean up scheduled job so it doesn't run against deleted record
    await heartbeatQueue.removeJobScheduler(`heartbeat-${id}`);

    res.json({ message: "Heartbeat monitor deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
