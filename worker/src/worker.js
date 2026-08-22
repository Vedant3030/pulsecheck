import "dotenv/config";
import { Worker } from "bullmq";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { connection } from "./queue.js";
import { Resend } from "resend";
import express from "express";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const resend = new Resend(process.env.RESEND_API_KEY);

async function checkMonitor(monitorId) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: { user: true },
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

  try {
    const response = await fetch(monitor.url, { method: "GET" });
    const responseTimeMs = Date.now() - start;
    newStatus = response.ok ? "up" : "down";

    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: newStatus,
        statusCode: response.status,
        responseTimeMs,
      },
    });

    console.log(`[${monitor.name}] ${response.status} - ${responseTimeMs}ms`);
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    newStatus = "down";

    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: newStatus,
        statusCode: null,
        responseTimeMs,
      },
    });

    console.log(`[${monitor.name}] FAILED - ${err.message}`);
  }

  // Only alert if the status actually changed from the last check
  const statusChanged = previousCheck && previousCheck.status !== newStatus;

  if (statusChanged) {
    await sendAlertEmail(monitor, newStatus);
  }
}

async function sendAlertEmail(monitor, newStatus) {
  const subject =
    newStatus === "down"
      ? `🔴 ${monitor.name} is DOWN`
      : `🟢 ${monitor.name} is back UP`;

  const body =
    newStatus === "down"
      ? `Your monitor "${monitor.name}" (${monitor.url}) just went down.`
      : `Your monitor "${monitor.name}" (${monitor.url}) has recovered.`;

  try {
    await resend.emails.send({
      from: "PulseCheck <onboarding@resend.dev>",
      to: monitor.user.email,
      subject,
      text: body,
    });
    console.log(`  → Alert email sent to ${monitor.user.email}`);
  } catch (err) {
    console.error(`  → Failed to send alert email:`, err.message);
  }
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

const app = express();
app.get("/", (req, res) => res.send("Worker is running"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Worker health server listening on port ${PORT}`));

console.log("BullMQ worker started. Listening for monitor-check jobs...");