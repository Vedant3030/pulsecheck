import "dotenv/config";
import { Worker } from "bullmq";
import pkg from "../../backend/node_modules/@prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { connection } from "./queue.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function checkMonitor(monitorId) {
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });

  if (!monitor || !monitor.isActive) {
    console.log(`Skipping ${monitorId} — not found or inactive`);
    return;
  }

  const start = Date.now();
  try {
    const response = await fetch(monitor.url, { method: "GET" });
    const responseTimeMs = Date.now() - start;

    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: response.ok ? "up" : "down",
        statusCode: response.status,
        responseTimeMs,
      },
    });

    console.log(`[${monitor.name}] ${response.status} - ${responseTimeMs}ms`);
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        status: "down",
        statusCode: null,
        responseTimeMs,
      },
    });
    console.log(`[${monitor.name}] FAILED - ${err.message}`);
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

console.log("BullMQ worker started. Listening for monitor-check jobs...");