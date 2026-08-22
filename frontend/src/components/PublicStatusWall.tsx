"use client";

import { AppBrand } from "@/components/ui/AppBrand";
import { MonitorBayLoading } from "@/components/MonitorBayLoading";
import { PublicServiceCard } from "@/components/status/PublicServiceCard";
import { PublicStatusSummary } from "@/components/status/PublicStatusSummary";
import { usePublicStatus } from "@/hooks/usePublicStatus";

const POLL_INTERVAL_MS = 10_000;

interface PublicStatusWallProps { slug: string; }

export function PublicStatusWall({ slug }: PublicStatusWallProps) {
  const { monitors, loading, error, lastUpdated } = usePublicStatus(slug, { pollIntervalMs: POLL_INTERVAL_MS, refetchOnFocus: true });
  const downCount = monitors.filter((monitor) => monitor.status === "down" && monitor.checkedAt != null).length;

  return <div className="public-status-page"><header className="public-status-header"><div className="public-status-container"><AppBrand href={`/status/${slug}`} /><p className="text-xs text-muted">Status page</p></div></header><main className="public-status-container public-status-content">{loading ? <MonitorBayLoading /> : error ? <section className="public-error" role="alert"><h1>Unable to load this status page</h1><p>{error}</p></section> : monitors.length === 0 ? <section className="public-empty"><h1>No active services</h1><p>This status page does not have any active monitors to display.</p></section> : <><PublicStatusSummary total={monitors.length} down={downCount} lastUpdated={lastUpdated} /><section className="mt-8"><div className="mb-4"><h2 className="text-lg font-semibold text-slate-50">Services</h2><p className="mt-1 text-sm text-muted">Live status for monitored services</p></div><div className="grid gap-4">{monitors.map((monitor) => <PublicServiceCard key={monitor.id} slug={slug} monitor={monitor} />)}</div></section></>}</main><footer className="public-status-container public-status-footer">Powered by PulseCheck · Live status updates every {POLL_INTERVAL_MS / 1000} seconds</footer></div>;
}
