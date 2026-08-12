import type { Monitor, MonitorStatus } from "@/types/monitor";

/** INIT = registered but worker hasn't pinged yet. */
export type DisplayStatus = "init" | MonitorStatus;

export function getDisplayStatus(monitor: Monitor): DisplayStatus {
  if (monitor.checkedAt == null) return "init";
  return monitor.status;
}

export function formatMonitorTime(checkedAt: string | null): string {
  if (checkedAt == null) return "Never";
  return new Date(checkedAt).toLocaleTimeString("en-US", { hour12: false });
}
