import express from "express";
import { prisma } from "../lib/prisma.js";

const router = express.Router();

// POST /api/heartbeat/:slug — public, no JWT auth
// External cron jobs call this to signal liveness
router.post("/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const monitor = await prisma.heartbeatMonitor.findUnique({ where: { slug } });

    if (!monitor) {
      return res.status(404).json({ error: "Heartbeat monitor not found" });
    }

    const now = new Date();

    // Fast path: update lastPingAt and status to UP, create check record
    // Do both in parallel where possible, but ensure monitor update completes
    const [updated] = await Promise.all([
      prisma.heartbeatMonitor.update({
        where: { id: monitor.id },
        data: { lastPingAt: now, status: "UP" },
      }),
      prisma.heartbeatCheck.create({
        data: {
          heartbeatMonitorId: monitor.id,
          status: "UP",
          receivedAt: now,
        },
      }),
    ]);

    // Respond fast — no heavy logic in request path (no email, no scheduling)
    res.json({ ok: true, slug: updated.slug, lastPingAt: updated.lastPingAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
