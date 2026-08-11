import "dotenv/config";
import pkg from "../../backend/node_modules/@prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function checkMonitor(monitor) {
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

async function runChecks() {
  const monitors = await prisma.monitor.findMany({ where: { isActive: true } });
  console.log(`Running checks for ${monitors.length} monitor(s)...`);
  for (const monitor of monitors) {
    await checkMonitor(monitor);
  }
}

// Run immediately, then every 60 seconds (simple version — real intervals per monitor come later)
runChecks();
setInterval(runChecks, 60 * 1000);

console.log("Worker started. Checking monitors every 60 seconds.");