"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getEmail } from "@/lib/auth";
import { useMonitors } from "@/hooks/useMonitors";
import { LiveClock } from "@/components/LiveClock";
import { LogoutButton } from "@/components/LogoutButton";
import { MonitorBayEmpty } from "@/components/MonitorBayEmpty";
import { MonitorBayLoading } from "@/components/MonitorBayLoading";
import { WaveformStrip } from "@/components/WaveformStrip";

const POLL_INTERVAL_MS = 10_000;
type Filter = "all" | "up" | "down" | "paused";

function formatTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("en-US", { hour12: false })
    : "Waiting";
}

export function MonitorWall() {
  const { monitors, loading, error, lastUpdated } = useMonitors({
    pollIntervalMs: POLL_INTERVAL_MS,
    refetchOnFocus: true,
  });
  const [filter, setFilter] = useState<Filter>("all");

  const summary = useMemo(() => {
    const active = monitors.filter((monitor) => monitor.isActive);
    const up = active.filter(
      (monitor) => monitor.status === "up" && monitor.checkedAt != null,
    );
    const down = active.filter(
      (monitor) => monitor.status === "down" && monitor.checkedAt != null,
    );
    const latencyReadings = up
      .map((monitor) => monitor.responseTimeMs)
      .filter((reading): reading is number => reading != null);

    return {
      activeCount: active.length,
      upCount: up.length,
      downCount: down.length,
      availability: active.length ? Math.round((up.length / active.length) * 100) : null,
      averageLatency: latencyReadings.length
        ? Math.round(latencyReadings.reduce((total, reading) => total + reading, 0) / latencyReadings.length)
        : null,
    };
  }, [monitors]);

  const filteredMonitors = monitors.filter((monitor) => {
    if (filter === "all") return true;
    if (filter === "paused") return !monitor.isActive;
    return monitor.isActive && monitor.status === filter && monitor.checkedAt != null;
  });
  const recentMonitors = [...monitors]
    .sort((a, b) => new Date(b.checkedAt ?? 0).getTime() - new Date(a.checkedAt ?? 0).getTime())
    .slice(0, 4);
  const hasIncident = summary.downCount > 0;

  return (
    <div className="dashboard-shell flex">
      <aside className="dashboard-sidebar fixed inset-y-0 left-0 z-20 flex flex-col p-4">
        <Link href="/" className="mb-9 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 text-lg text-phosphor">⌁</span>
          <span><span className="block text-base font-semibold tracking-tight text-slate-50">PulseCheck</span><span className="block text-[11px] text-muted">Uptime monitoring</span></span>
        </Link>
        <nav aria-label="Primary navigation" className="space-y-1">
          <Link href="/" className="dashboard-nav-link dashboard-nav-link-active"><span aria-hidden>▦</span> Overview</Link>
          <a href="#monitors" className="dashboard-nav-link"><span aria-hidden>◫</span> Monitors</a>
          <a href="#activity" className="dashboard-nav-link"><span aria-hidden>◷</span> Activity</a>
          <Link href="/manage" className="dashboard-nav-link"><span aria-hidden>⚙</span> Settings</Link>
        </nav>
        <div className="dashboard-panel mt-auto p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-200"><span className={`status-dot ${hasIncident ? "status-dot-down" : "status-dot-up"}`} />System status</div>
          <p className={`mt-2 text-sm font-semibold ${hasIncident ? "text-alarm" : "text-phosphor"}`}>{hasIncident ? "Attention required" : "Operational"}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{hasIncident ? "One or more active monitors are down." : "All active checks are healthy."}</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1 lg:ml-[15.5rem]">
        <header className="sticky top-0 z-10 border-b border-grid bg-bg/95 px-5 py-4 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3"><span className="rounded-md border border-grid px-2 py-1 text-xs text-muted lg:hidden">⌁</span><div><h1 className="text-xl font-semibold tracking-tight text-slate-50">Overview</h1><p className="mt-0.5 text-xs text-muted">Real-time health and performance across your services</p></div></div>
            <div className="flex items-center gap-4"><div className="hidden text-right sm:block"><LiveClock /></div><div className="hidden h-8 w-px bg-grid sm:block" /><div className="text-right text-xs"><p className="text-slate-200">{getEmail() ?? "operator"}</p><p className="mt-1 text-muted">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-US", { hour12: false })}` : "Connecting…"}</p></div><Link href="/manage" className="rounded-md border border-grid px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-bg-strip">Manage</Link><LogoutButton className="text-xs font-medium text-muted transition hover:text-slate-50" /></div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          {error && <section role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span>Unable to refresh monitor data: {error}</span><span className="shrink-0 text-xs text-red-300">Showing last available data</span></section>}
          {loading ? <MonitorBayLoading /> : monitors.length === 0 ? <MonitorBayEmpty /> : <>
            <section aria-label="System health summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="dashboard-stat"><p className="dashboard-stat-label">System health</p><div className="mt-3 flex items-center gap-2"><span className={`status-dot ${hasIncident ? "status-dot-down" : "status-dot-up"}`} /><p className={`dashboard-stat-value text-lg ${hasIncident ? "text-alarm" : "text-phosphor"}`}>{hasIncident ? "Incident" : "Healthy"}</p></div><p className="mt-2 text-xs text-muted">{hasIncident ? `${summary.downCount} monitor needs attention` : "All active checks passing"}</p></div>
              <div className="dashboard-stat"><p className="dashboard-stat-label">Total monitors</p><p className="dashboard-stat-value mt-3">{monitors.length}</p><p className="mt-2 text-xs text-muted">{summary.activeCount} active</p></div>
              <div className="dashboard-stat"><p className="dashboard-stat-label">Active monitors</p><p className="dashboard-stat-value mt-3">{summary.upCount} <span className="text-base font-medium text-muted">/ {summary.activeCount}</span></p><p className={`mt-2 text-xs ${summary.downCount ? "text-alarm" : "text-phosphor"}`}>{summary.downCount ? `${summary.downCount} down` : "No active incidents"}</p></div>
              <div className="dashboard-stat"><p className="dashboard-stat-label">Average latency</p><p className="dashboard-stat-value mt-3">{summary.averageLatency == null ? "—" : `${summary.averageLatency} ms`}</p><p className="mt-2 text-xs text-muted">Across healthy monitors</p></div>
              <div className="dashboard-stat"><p className="dashboard-stat-label">Current uptime</p><p className="dashboard-stat-value mt-3">{summary.availability == null ? "—" : `${summary.availability}%`}</p><p className="mt-2 text-xs text-muted">Based on latest checks</p></div>
            </section>
            {hasIncident && <section className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3"><p className="text-sm font-medium text-red-200">Active incident detected</p><p className="mt-1 text-xs text-red-300">{summary.downCount} active monitor{summary.downCount === 1 ? " is" : "s are"} reporting an unhealthy check. Filter by “Down” to inspect affected services.</p></section>}
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <section id="monitors" className="dashboard-panel min-w-0 p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-slate-50">Monitors</h2><p className="mt-1 text-xs text-muted">Latest check and response-time history for each endpoint</p></div><div className="flex flex-wrap gap-2" aria-label="Monitor filters">{(["all", "up", "down", "paused"] as Filter[]).map((value) => <button key={value} type="button" className="dashboard-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div><div className="mt-5 space-y-3">{filteredMonitors.length ? filteredMonitors.map((monitor) => <WaveformStrip key={monitor.id} monitorId={monitor.id} name={monitor.name} status={monitor.status} responseTimeMs={monitor.responseTimeMs} statusCode={monitor.statusCode} checkedAt={monitor.checkedAt} variant="dashboard" />) : <div className="rounded-lg border border-dashed border-grid px-5 py-10 text-center"><p className="text-sm font-medium text-slate-200">No monitors in this view</p><button type="button" className="mt-3 text-xs font-medium text-phosphor hover:underline" onClick={() => setFilter("all")}>Show all monitors</button></div>}</div></section>
              <aside id="activity" className="dashboard-panel h-fit p-4 md:p-5"><h2 className="text-base font-semibold text-slate-50">Recent activity</h2><p className="mt-1 text-xs text-muted">Most recently checked services</p><div className="mt-4">{recentMonitors.map((monitor) => { const isDown = monitor.status === "down" && monitor.checkedAt != null; return <div key={monitor.id} className="activity-item flex gap-3 py-3 first:pt-0"><span className={`status-dot mt-1.5 shrink-0 ${isDown ? "status-dot-down" : monitor.checkedAt == null ? "status-dot-pending" : "status-dot-up"}`} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-xs font-medium text-slate-200">{monitor.name}</p><time className="shrink-0 text-[11px] text-muted">{formatTime(monitor.checkedAt)}</time></div><p className={`mt-1 text-[11px] ${isDown ? "text-alarm" : "text-muted"}`}>{monitor.checkedAt == null ? "Waiting for first check" : isDown ? "Check failed" : `${monitor.responseTimeMs ?? "—"} ms · HTTP ${monitor.statusCode ?? "—"}`}</p></div></div>; })}</div><Link href="/manage" className="mt-3 block rounded-md border border-grid px-3 py-2 text-center text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-bg-strip">Add or manage monitors</Link></aside>
            </div>
          </>}
        </main>
      </div>
    </div>
  );
}
