import "dotenv/config";
import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const monitorQueue = new Queue("monitor-checks", { connection });
export const heartbeatQueue = new Queue("heartbeat-checks", { connection });
export const sslDomainQueue = new Queue("ssl-domain-checks", { connection });
export { connection };