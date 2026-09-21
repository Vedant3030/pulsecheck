import type { ExpiryAlertStage } from "@/types/monitor";

/**
 * Mirrors worker/src/lib/expiryStage.js ranking (NONE < 30D < 14D < 7D < EXPIRED)
 * Frontend-only: computes days remaining + tone for compact badge.
 */
export function daysUntil(expiryIso: string | null | undefined): number | null {
  if (!expiryIso) return null;
  const ms = new Date(expiryIso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function expiryTone(stage: ExpiryAlertStage | undefined): "green" | "amber" | "red" | "muted" {
  switch (stage) {
    case "UNSUPPORTED":
      return "muted";
    case "EXPIRED":
    case "WARNED_7D":
      return "red";
    case "WARNED_14D":
    case "WARNED_30D":
      return "amber";
    case "NONE":
      return "green";
    default:
      return "muted";
  }
}

export function formatExpiryLabel(kind: "SSL" | "Domain", days: number | null, stage: ExpiryAlertStage | undefined): string {
  if (stage === "UNSUPPORTED") return `${kind}: not supported for this TLD`;
  if (stage === "EXPIRED") return `${kind}: EXPIRED`;
  if (days == null) return `${kind}: —`;
  if (days < 0) return `${kind}: EXPIRED`;
  if (days === 0) return `${kind}: today`;
  if (days === 1) return `${kind}: 1 day`;
  return `${kind}: ${days} days`;
}
