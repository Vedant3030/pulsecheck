"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchPublicMonitorChecks } from "@/lib/api";
import { VIEW_HEIGHT, buildHistoryWaveform } from "@/lib/waveform";
import type { CheckResult } from "@/types/monitor";
import type { PublicMonitor } from "@/types/status";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface PublicServiceCardProps {
  slug: string;
  monitor: PublicMonitor;
}

function formatCheckedAt(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "Awaiting first check";
}

export function PublicServiceCard({ slug, monitor }: PublicServiceCardProps) {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const isUp = monitor.status === "up" && monitor.checkedAt != null;

  useEffect(() => {
    let cancelled = false;
    fetchPublicMonitorChecks(slug, monitor.id, 60).then((data) => { if (!cancelled) setChecks(data); }).catch(() => { /* latest status remains useful when history is unavailable */ });
    return () => { cancelled = true; };
  }, [monitor.checkedAt, monitor.id, slug]);

  const history = useMemo(() => buildHistoryWaveform(checks), [checks]);
  const uptime = checks.length ? (checks.filter((check) => check.status === "up").length / checks.length) * 100 : null;

  return <article className="public-service-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2>{monitor.name}</h2><div className="mt-2"><StatusBadge tone={isUp ? "up" : monitor.checkedAt == null ? "pending" : "down"}>{isUp ? "Operational" : monitor.checkedAt == null ? "Awaiting check" : "Service disruption"}</StatusBadge></div></div><div className="text-right"><p className="public-metric">{uptime == null ? "—" : `${uptime.toFixed(uptime === 100 ? 0 : 2)}%`}</p><p className="mt-1 text-xs text-muted">Uptime · recent checks</p></div></div><div className="public-chart mt-6"><svg viewBox={`0 0 ${Math.max(history.width, 120)} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-label="Recent check history" role="img"><path d={history.path} fill="none" stroke={isUp ? "var(--color-phosphor)" : "var(--color-alarm)"} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></div><div className="mt-4 flex flex-wrap justify-between gap-3 text-xs text-muted"><span>{checks.length ? `${checks.length} checks in visible history` : "History loading…"}</span><span>Last checked {formatCheckedAt(monitor.checkedAt)}</span></div></article>;
}
