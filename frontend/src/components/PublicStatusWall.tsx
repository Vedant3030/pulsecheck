"use client";

import { LiveClock } from "@/components/LiveClock";
import { MonitorBayLoading } from "@/components/MonitorBayLoading";
import { ScanlineOverlay } from "@/components/ScanlineOverlay";
import { WaveformStrip } from "@/components/WaveformStrip";
import { usePublicStatus } from "@/hooks/usePublicStatus";

const POLL_INTERVAL_MS = 10_000;

interface PublicStatusWallProps {
  slug: string;
}

export function PublicStatusWall({ slug }: PublicStatusWallProps) {
  const { monitors, loading, error, lastUpdated } = usePublicStatus(slug, {
    pollIntervalMs: POLL_INTERVAL_MS,
    refetchOnFocus: true,
  });

  const upCount = monitors.filter((m) => m.status === "up").length;

  function headerStatus(): string {
    if (loading) return "Connecting…";
    if (monitors.length === 0) return "0 Channels";
    return `${upCount}/${monitors.length} Channels Up`;
  }

  return (
    <div className="icu-display relative flex min-h-screen flex-col">
      <ScanlineOverlay />

      <header className="relative z-10 panel-border border-b-0 border-x-0 border-t-0 bg-bg-panel/90 px-6 py-5 backdrop-blur-[1px]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <h1 className="text-phosphor-glow text-4xl font-bold tracking-[0.25em] text-phosphor uppercase">
              PulseCheck
            </h1>
            <p className="mt-1 text-xs tracking-widest text-phosphor-dim uppercase">
              Public Status · {slug}
            </p>
          </div>

          <LiveClock />

          <div className="text-right text-sm sm:justify-self-end">
            <p className="text-[10px] tracking-widest text-phosphor-dim uppercase">
              Read-only feed
            </p>
            <p className="mt-1 tracking-wider text-amber uppercase">
              {headerStatus()}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {!loading && lastUpdated
                ? `sync ${lastUpdated.toLocaleTimeString("en-US", { hour12: false })}`
                : loading
                  ? "acquiring signal"
                  : ""}
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          {error && (
            <p className="alarm-blink-text text-xs tracking-wider text-alarm text-alarm-glow">
              {error}
            </p>
          )}

          {loading ? (
            <MonitorBayLoading />
          ) : !error && monitors.length === 0 ? (
            <section className="panel-border flex min-h-[320px] flex-col items-center justify-center bg-bg-strip p-8">
              <p className="text-sm tracking-widest text-phosphor-dim uppercase">
                No active channels
              </p>
              <p className="mt-2 text-xs text-muted">
                This status page has no public monitors to display.
              </p>
            </section>
          ) : (
            monitors.map((monitor) => (
              <WaveformStrip
                key={monitor.id}
                monitorId={monitor.id}
                name={monitor.name}
                status={monitor.status}
                responseTimeMs={monitor.responseTimeMs}
                statusCode={monitor.statusCode}
                checkedAt={monitor.checkedAt}
                publicSlug={slug}
              />
            ))
          )}
        </div>
      </main>

      <footer className="relative z-10 border-t border-grid px-6 py-3">
        <p className="mx-auto max-w-6xl text-[10px] tracking-widest text-muted uppercase">
          PulseCheck · Public status page · /status/{slug}
        </p>
      </footer>
    </div>
  );
}
