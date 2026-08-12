import type { MonitorStatus } from "./monitor";

/** Monitor data exposed on a public status page (no auth). */
export interface PublicMonitor {
  id: string;
  name: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string | null;
}

export interface PublicStatusPage {
  slug: string;
  monitors: PublicMonitor[];
}

export interface UserProfile {
  id: string;
  email: string;
  createdAt: string;
  publicSlug: string | null;
}
