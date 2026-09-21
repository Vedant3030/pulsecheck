import "dotenv/config";
import { Worker } from "bullmq";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { connection, heartbeatQueue, sslDomainQueue } from "./queue.js";
import express from "express";
import { sendAlertEmail as sendAlertEmailLib } from "./lib/alert.js";
import { fetchCertExpiry } from "./lib/ssl.js";
import { fetchDomainExpiry } from "./lib/domain.js";
import { getExpiryStage, shouldAlert } from "./lib/expiryStage.js";
import { evaluateAssertions } from "./lib/assertions.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function checkMonitor(monitorId) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: { user: true, assertions: true },
  });

  if (!monitor || !monitor.isActive) {
    console.log(`Skipping ${monitorId} — not found or inactive`);
    return;
  }

  // Get the most recent previous check, to detect a status change
  const previousCheck = await prisma.checkResult.findFirst({
    where: { monitorId: monitor.id },
    orderBy: { checkedAt: "desc" },
  });

  const start = Date.now();
  let newStatus;
  let assertionResults = null;

  try {
    const response = await fetch(monitor.url, { method: "GET" });
    const responseTimeMs = Date.now() - start;
    const baselineIsUp = response.ok;

    // Capture body once for BODY_CONTAINS / JSON_FIELD_EQUALS (512k cap per spec)
    let bodyText = "";
    let wasTruncated = false;
    try {
      const raw = await response.text();
      if (raw.length > 512 * 1024) {
        bodyText = raw.slice(0, 512 * 1024);
        wasTruncated = true;
      } else {
        bodyText = raw;
      }
    } catch {
      bodyText = "";
    }

    let allAssertionsPass = true;
    if (monitor.assertions.length > 0) {
      const evals = evaluateAssertions(monitor.assertions, {
        statusCode: response.status,
        responseTimeMs,
        bodyText,
        wasTruncated,
      });
      assertionResults = evals;
      allAssertionsPass = evals.every((r) => r.pass);
    }

    newStatus = baselineIsUp && allAssertionsPass ? "up" : "down";

    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: newStatus,
        statusCode: response.status,
        responseTimeMs,
        assertionResults,
      },
    });

    const failCount = assertionResults ? assertionResults.filter((r) => !r.pass).length : 0;
    console.log(
      `[${monitor.name}] ${response.status} - ${responseTimeMs}ms${failCount ? ` assertions:${failCount} failed` : ""}`
    );
    if (failCount) {
      for (const r of assertionResults.filter((x) => !x.pass)) {
        console.log(`  → Assertion failed: ${r.message}`);
      }
    }
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    newStatus = "down";
    if (monitor.assertions.length > 0) {
      assertionResults = monitor.assertions.map((a) => ({
        type: a.type,
        field: a.field,
        operator: a.operator,
        expectedValue: a.expectedValue,
        actual: "<no response>",
        pass: false,
        message: `No response — ${a.type} failed (${err.message})`,
      }));
    }

    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: newStatus,
        statusCode: null,
        responseTimeMs,
        assertionResults,
      },
    });

    console.log(`[${monitor.name}] FAILED - ${err.message}`);
  }

  // Alert if status changed from the last check, OR if this is the very
  // first check and the site is already down (user should know immediately)
  const isFirstCheck = !previousCheck;
  const statusChanged = previousCheck && previousCheck.status !== newStatus;
  const shouldAlert = statusChanged || (isFirstCheck && newStatus === "down");

  if (shouldAlert) {
    await sendAlertEmail(monitor, newStatus);
  }
}

async function sendAlertEmail(monitor, newStatus) {
  // Reuse shared Resend logic — do not duplicate alert implementation
  return sendAlertEmailLib(monitor, newStatus, "monitor");
}

// ---- Heartbeat monitoring (ADDITIVE — does not touch URL monitor logic above) ----

async function checkHeartbeat(heartbeatMonitorId) {
  const monitor = await prisma.heartbeatMonitor.findUnique({
    where: { id: heartbeatMonitorId },
    include: { user: true },
  });

  if (!monitor) {
    console.log(`[heartbeat] Skipping ${heartbeatMonitorId} — not found (likely deleted)`);
    // Defensive: remove stale scheduler if any remains
    try {
      await heartbeatQueue.removeJobScheduler(`heartbeat-${heartbeatMonitorId}`);
    } catch {}
    return;
  }

  // isActive=false means paused — skip entirely (no DOWN, no alert), mirrors Monitor.isActive
  if (monitor.isActive === false) {
    console.log(`[heartbeat] ${monitor.name} (${monitor.slug}) paused (isActive=false) — skipping`);
    return;
  }

  const now = Date.now();
  const thresholdMs = (monitor.expectedIntervalSeconds + monitor.gracePeriodSeconds) * 1000;

  // Reference time is lastPingAt if present, otherwise createdAt (covers PENDING never-pinged case)
  const referenceTime = monitor.lastPingAt ? new Date(monitor.lastPingAt).getTime() : new Date(monitor.createdAt).getTime();
  const elapsedMs = now - referenceTime;
  const isOverdue = elapsedMs > thresholdMs;

  if (!isOverdue) {
    console.log(`[heartbeat] ${monitor.name} (${monitor.slug}) OK — ${Math.round(elapsedMs / 1000)}s since last ping (threshold ${thresholdMs / 1000}s)`);
    return;
  }

  // Overdue: only act if not already DOWN (prevents spamming alerts/checks)
  if (monitor.status === "DOWN") {
    console.log(`[heartbeat] ${monitor.name} already DOWN — skipping (overdue ${Math.round(elapsedMs / 1000)}s)`);
    return;
  }

  // Mark DOWN, create HeartbeatCheck, trigger alert
  await prisma.heartbeatMonitor.update({
    where: { id: monitor.id },
    data: { status: "DOWN" },
  });

  await prisma.heartbeatCheck.create({
    data: {
      heartbeatMonitorId: monitor.id,
      status: "DOWN",
    },
  });

  console.log(`[heartbeat] 🔴 ${monitor.name} is DOWN — overdue ${Math.round(elapsedMs / 1000)}s (threshold ${thresholdMs / 1000}s)`);

  await sendAlertEmailLib(monitor, "down", "heartbeat");
}

const worker = new Worker(
  "monitor-checks",
  async (job) => {
    await checkMonitor(job.data.monitorId);
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

const heartbeatWorker = new Worker(
  "heartbeat-checks",
  async (job) => {
    await checkHeartbeat(job.data.heartbeatMonitorId);
  },
  { connection }
);

heartbeatWorker.on("failed", (job, err) => {
  console.error(`Heartbeat job ${job?.id} failed:`, err.message);
});

// ---- SSL / Domain expiry monitoring (ADDITIVE — 24h cycle, separate from 5-min uptime) ----

async function checkSslDomain(monitorId) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: { user: true },
  });

  if (!monitor) {
    console.log(`[ssl-domain] Skipping ${monitorId} — not found (likely deleted)`);
    try { await sslDomainQueue.removeJobScheduler(`ssl-domain-check-${monitorId}`); } catch {}
    return;
  }

  // Both flags disabled → clean up scheduler and exit (orthogonal to isActive)
  if (!monitor.sslMonitoringEnabled && !monitor.domainMonitoringEnabled) {
    console.log(`[ssl-domain] ${monitor.name} both flags disabled — skipping and removing scheduler`);
    try { await sslDomainQueue.removeJobScheduler(`ssl-domain-check-${monitorId}`); } catch {}
    return;
  }

  let hostname;
  try {
    hostname = new URL(monitor.url).hostname;
  } catch {
    console.log(`[ssl-domain] ${monitor.name} invalid URL ${monitor.url} — skipping`);
    return;
  }

  const now = new Date();

  // 1) SSL check
  if (monitor.sslMonitoringEnabled) {
    const certExpiry = await fetchCertExpiry(hostname);
    if (certExpiry) {
      const nextStage = getExpiryStage(certExpiry);
      const prevStage = monitor.sslAlertStage;
      const daysRemaining = Math.ceil((certExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { certExpiresAt: certExpiry, lastSslCheckAt: now },
      });

      if (nextStage === "NONE" && prevStage !== "NONE") {
        // Renewed — silently reset (no alert)
        await prisma.monitor.update({ where: { id: monitor.id }, data: { sslAlertStage: "NONE" } });
        console.log(`[ssl] ${monitor.name} cert renewed — stage reset to NONE`);
      } else if (shouldAlert(prevStage, nextStage)) {
        await prisma.monitor.update({ where: { id: monitor.id }, data: { sslAlertStage: nextStage } });
        console.log(`[ssl] ${monitor.name} stage ${prevStage} -> ${nextStage} (${daysRemaining}d) — alerting`);
        await sendAlertEmailLib({ ...monitor, certExpiresAt: certExpiry, _daysRemaining: daysRemaining }, nextStage, "ssl");
      } else {
        // Keep existing stage if not increasing and not renewal
        console.log(`[ssl] ${monitor.name} ${daysRemaining}d remaining — stage ${prevStage} (next ${nextStage}) — no alert`);
      }
    } else {
      // Failed check — only update lastSslCheckAt, don't wipe certExpiresAt/stage
      try {
        await prisma.monitor.update({ where: { id: monitor.id }, data: { lastSslCheckAt: now } });
      } catch {}
      console.log(`[ssl] ${monitor.name} check failed — kept existing cert data`);
    }
  }

  // Reload monitor after SSL updates to avoid stale stage for domain branch (re-fetch or use updated)
  const freshMonitor = await prisma.monitor.findUnique({ where: { id: monitorId }, include: { user: true } });
  if (!freshMonitor) return;

  // 2) Domain check (psl extraction inside fetchDomainExpiry) — UNSUPPORTED vs transient
  if (freshMonitor.domainMonitoringEnabled) {
    try {
      const domainExpiry = await fetchDomainExpiry(hostname);
      if (domainExpiry) {
        const nextStage = getExpiryStage(domainExpiry);
        const prevStage = freshMonitor.domainAlertStage;
        const daysRemaining = Math.ceil((domainExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        await prisma.monitor.update({
          where: { id: freshMonitor.id },
          data: { domainExpiresAt: domainExpiry, lastDomainCheckAt: now },
        });

        // Self-heal: if previously UNSUPPORTED but now succeeds, overwrite stage via normal threshold logic
        const effectivePrev = prevStage === "UNSUPPORTED" ? "NONE" : prevStage;

        if (nextStage === "NONE" && effectivePrev !== "NONE") {
          await prisma.monitor.update({ where: { id: freshMonitor.id }, data: { domainAlertStage: "NONE" } });
          console.log(`[domain] ${freshMonitor.name} domain renewed/now supported — stage reset to NONE`);
        } else if (shouldAlert(effectivePrev, nextStage)) {
          await prisma.monitor.update({ where: { id: freshMonitor.id }, data: { domainAlertStage: nextStage } });
          console.log(`[domain] ${freshMonitor.name} stage ${effectivePrev} -> ${nextStage} (${daysRemaining}d) — alerting`);
          await sendAlertEmailLib({ ...freshMonitor, domainExpiresAt: domainExpiry, _daysRemaining: daysRemaining }, nextStage, "domain");
        } else {
          // Ensure UNSUPPORTED → NONE/WARNED transition is persisted even when no alert
          if (prevStage === "UNSUPPORTED" && nextStage !== "UNSUPPORTED") {
            await prisma.monitor.update({ where: { id: freshMonitor.id }, data: { domainAlertStage: nextStage } });
          }
          console.log(`[domain] ${freshMonitor.name} ${daysRemaining}d remaining — stage ${prevStage} (next ${nextStage}) — no alert`);
        }
      } else {
        // Transient failure (timeout, etc.) — keep stage NONE, just bump lastDomainCheckAt
        try {
          await prisma.monitor.update({ where: { id: freshMonitor.id }, data: { lastDomainCheckAt: now } });
        } catch {}
        console.log(`[domain] ${freshMonitor.name} WHOIS transient failure — kept existing domain data`);
      }
    } catch (err) {
      if (err.message && err.message.startsWith("UNSUPPORTED:")) {
        // Single confirmed structural failure → mark UNSUPPORTED (no alert, stops infinite checking...)
        try {
          await prisma.monitor.update({
            where: { id: freshMonitor.id },
            data: { domainAlertStage: "UNSUPPORTED", lastDomainCheckAt: now },
          });
        } catch {}
        console.log(`[domain] ${freshMonitor.name} WHOIS unsupported (${err.message}) — stage set to UNSUPPORTED`);
      } else {
        // Unexpected throw — treat as transient
        try {
          await prisma.monitor.update({ where: { id: freshMonitor.id }, data: { lastDomainCheckAt: now } });
        } catch {}
        console.log(`[domain] ${freshMonitor.name} WHOIS error: ${err.message} — kept existing`);
      }
    }
  }
}

// Idempotent boot re-hydration — survives Redis FLUSHDB / redeploy.
// Runs once on worker boot; upsertJobScheduler is safe to call repeatedly.
export async function scheduleAllHeartbeats() {
  try {
    const monitors = await prisma.heartbeatMonitor.findMany();
    console.log(`[heartbeat] Re-hydrating ${monitors.length} heartbeat schedule(s) on boot...`);
    for (const m of monitors) {
      if (m.isActive === false) {
        // Ensure paused monitors have no scheduler (idempotent)
        try {
          await heartbeatQueue.removeJobScheduler(`heartbeat-${m.id}`);
        } catch {}
        continue;
      }
      const everyMs = (m.expectedIntervalSeconds + m.gracePeriodSeconds) * 1000;
      await heartbeatQueue.upsertJobScheduler(
        `heartbeat-${m.id}`,
        { every: everyMs },
        { name: "check-heartbeat", data: { heartbeatMonitorId: m.id } }
      );
    }
    console.log(`[heartbeat] Boot re-hydration complete`);
  } catch (err) {
    console.error(`[heartbeat] scheduleAllHeartbeats failed:`, err.message);
  }
}

const sslDomainWorker = new Worker(
  "ssl-domain-checks",
  async (job) => {
    await checkSslDomain(job.data.monitorId);
  },
  { connection }
);

sslDomainWorker.on("failed", (job, err) => {
  console.error(`SSL/domain job ${job?.id} failed:`, err.message);
});

export async function scheduleAllSslDomainChecks() {
  try {
    const monitors = await prisma.monitor.findMany({
      where: { OR: [{ sslMonitoringEnabled: true }, { domainMonitoringEnabled: true }] },
    });
    console.log(`[ssl-domain] Re-hydrating ${monitors.length} ssl/domain schedule(s) on boot...`);
    for (const m of monitors) {
      await sslDomainQueue.upsertJobScheduler(
        `ssl-domain-check-${m.id}`,
        { every: 24 * 60 * 60 * 1000 },
        { name: "check-ssl-domain", data: { monitorId: m.id } }
      );
    }
    const schedulers = await sslDomainQueue.getJobSchedulers();
    for (const s of schedulers) {
      const mid = s.template?.data?.monitorId;
      if (!mid) continue;
      const mm = await prisma.monitor.findUnique({ where: { id: mid } });
      if (!mm || (!mm.sslMonitoringEnabled && !mm.domainMonitoringEnabled)) {
        try { await sslDomainQueue.removeJobScheduler(s.key); } catch {}
        console.log(`[ssl-domain] Removed orphan ${s.key}`);
      }
    }
    console.log(`[ssl-domain] Boot re-hydration complete`);
  } catch (err) {
    console.error(`[ssl-domain] scheduleAllSslDomainChecks failed:`, err.message);
  }
}

// Fire once on boot (non-blocking for health server, but awaited before first jobs)
scheduleAllHeartbeats();
scheduleAllSslDomainChecks();

const app = express();
app.get("/", (req, res) => res.send("Worker is running"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Worker health server listening on port ${PORT}`));

console.log("BullMQ workers started. Listening for monitor-check, heartbeat-check, and ssl-domain-check jobs...");