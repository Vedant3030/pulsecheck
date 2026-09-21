"use client";

import { ShieldCheck, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpiryAlertStage } from "@/types/monitor";
import { daysUntil, expiryTone, formatExpiryLabel } from "@/lib/expiry";

interface ExpiryBadgeProps {
  kind: "SSL" | "Domain";
  expiresAt: string | null | undefined;
  stage: ExpiryAlertStage | undefined;
  enabled: boolean;
  className?: string;
}

export function ExpiryBadge({ kind, expiresAt, stage, enabled, className }: ExpiryBadgeProps) {
  if (!enabled) return null;

  const days = daysUntil(expiresAt ?? null);
  const tone = expiryTone(stage);
  // Distinguish "never checked" (last check null, stage NONE, no expiry) vs "unsupported TLD"
  const unsupported = stage === "UNSUPPORTED";
  const checking = enabled && !expiresAt && !unsupported;

  // Compact row — small pill, monospace, phosphor language
  const toneClass =
    stage === "UNSUPPORTED"
      ? "border-grid bg-black/20 text-muted"
      : stage === "EXPIRED"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/10 text-red-300"
          : tone === "amber"
            ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
            : tone === "green"
              ? "border-green-500/20 bg-black/30 text-phosphor"
              : "border-grid bg-black/20 text-muted";

  const Icon = kind === "SSL" ? ShieldCheck : Globe;

  if (checking) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-green-500/10 bg-black/20 px-2 py-0.5 text-[10px] tracking-widest text-muted animate-pulse",
          className
        )}
      >
        <Icon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
        {kind}: checking...
      </span>
    );
  }

  const label = formatExpiryLabel(kind, days, stage);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wider",
        toneClass,
        className
      )}
      title={expiresAt ? `Expires ${new Date(expiresAt).toISOString().split("T")[0]} • stage ${stage}` : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
