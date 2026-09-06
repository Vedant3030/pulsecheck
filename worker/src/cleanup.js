import "dotenv/config";
import { monitorQueue } from "./queue.js";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  const schedulers = await monitorQueue.getJobSchedulers();
  console.log(`Found ${schedulers.length} scheduled job(s) in Redis.`);

  for (const scheduler of schedulers) {
    const monitorId = scheduler.template.data.monitorId;
    const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });

    if (!monitor) {
      await monitorQueue.removeJobScheduler(scheduler.key);
      console.log(`Removed stale schedule for missing monitor: ${monitorId}`);
    } else {
      console.log(`Kept valid schedule for: ${monitor.name}`);
    }
  }

  console.log("Cleanup done.");
  process.exit(0);
}

cleanup();