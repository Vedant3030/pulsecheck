/** Matches the shape we'll get from GET /monitors once the backend is wired. */
export type MonitorStatus = "up" | "down";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMins: number;
  isActive: boolean;
  createdAt: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string | null;
}

/** One ping result — from GET /monitors/:id/checks */
export interface CheckResult {
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string;
}

export interface WaveformStripProps {
  monitorId: string;
  name: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode?: number | null;
  checkedAt: Date | string | null;
  /** When set, fetches check history via the public status API. */
  publicSlug?: string;
}
