import "dotenv/config";
import pkg from "../../backend/node_modules/@prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { monitorQueue } from "./queue.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function scheduleAllMonitors() {
  const monitors = await prisma.monitor.findMany({ where: { isActive: true } });

  console.log(`Scheduling ${monitors.length} monitor(s)...`);

  for (const monitor of monitors) {
    await monitorQueue.add(
      "check-monitor",
      { monitorId: monitor.id },
      {
        repeat: { every: monitor.intervalMins * 60 * 1000 },
        jobId: `monitor-${monitor.id}`, // prevents duplicate schedules for the same monitor
      }
    );
    console.log(`  Scheduled "${monitor.name}" every ${monitor.intervalMins} min`);
  }

  console.log("Done scheduling. Exiting.");
  process.exit(0);
}

scheduleAllMonitors();