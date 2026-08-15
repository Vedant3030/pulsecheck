import "dotenv/config";
import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: null,
});

export const monitorQueue = new Queue("monitor-checks", { connection });