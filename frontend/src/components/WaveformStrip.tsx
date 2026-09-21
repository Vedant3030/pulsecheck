"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMonitorChecks, fetchPublicMonitorChecks } from "@/lib/api";
import {
  BASELINE,
  BEAT_WIDTH,
  FALLBACK_BEAT_PATH,
  VIEW_HEIGHT,
  buildHistoryWaveform,
  fallbackBeatTransform,
  latencyToAmplitude,
  scrollDurationForShift,
} from "@/lib/waveform";
import type { CheckResult, WaveformStripProps } from "@/types/monitor";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { Switch } from "@/components/ui/switch";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { AssertionResultBadge } from "@/components/AssertionResultBadge";

function formatCheckedAt(value: Date | string | null): string {
  if (value == null) return "---";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString("en-US", { hour12: false });
}

export function WaveformStrip({
  monitorId,
  name,
  status,
  responseTimeMs,
  statusCode,
  checkedAt,
  publicSlug,
  variant = "dashboard",
  sslMonitoringEnabled = false,
  certExpiresAt = null,
  sslAlertStage = "NONE",
  domainMonitoringEnabled = false,
  domainExpiresAt = null,
  domainAlertStage = "NONE",
  onToggleSsl,
  onToggleDomain,
  isToggling = false,
}: WaveformStripProps) {
  const isUp = status === "up";
  const awaitingCheck = !isUp && checkedAt == null;
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();

  // Refetch history when parent poll updates checkedAt (new ping landed)
  useEffect(() => {
    if (awaitingCheck) return;

    let cancelled = false;

    const loadChecks = publicSlug
      ? fetchPublicMonitorChecks(publicSlug, monitorId, 60)
      : fetchMonitorChecks(monitorId, 60);

    loadChecks
      .then((data) => {
        if (!cancelled) setChecks(data);
      })
      .catch(() => {
        // Keep last known history on transient errors - do not set state
      });

    return () => {
      cancelled = true;
    };
  }, [monitorId, checkedAt, awaitingCheck, publicSlug]);

  const history = useMemo(() => buildHistoryWaveform(checks), [checks]);
  const hasHistory = checks.length >= 2;
  // Newest check is last (backend returns oldest-first). Public endpoint omits assertionResults.
  const latestCheck = checks.length > 0 ? checks[checks.length - 1] : null;
  const historyWidth = history.width;

  const scrollShift = hasHistory ? historyWidth : BEAT_WIDTH;
  const duration = scrollDurationForShift(scrollShift, responseTimeMs);
  // Render enough tiles to cover the entire viewBox while the first tile scrolls out.
  const historyTileCount = Math.ceil(800 / historyWidth) + 2;
  const amplitude = latencyToAmplitude(responseTimeMs);
  const statusLabel = awaitingCheck ? "INIT" : status.toUpperCase();
  const successfulChecks = checks.filter((check) => check.status === "up");
  const uptime = checks.length
    ? Math.round((successfulChecks.length / checks.length) * 100)
    : null;
  const averageLatency = successfulChecks.length
    ? Math.round(
      successfulChecks.reduce((total, check) => total + (check.responseTimeMs ?? 0), 0) /
        successfulChecks.length,
    )
    : null;

  const strokeColor = awaitingCheck
    ? "var(--color-phosphor-dim)"
    : isUp
      ? "var(--color-phosphor)"
      : "var(--color-alarm)";

  return (
    <article
      className={`${variant === "dashboard" ? "dashboard-monitor bg-black/50 backdrop-blur-sm" : "monitor-strip-button panel-border bg-bg-strip"} p-4 ${isUp ? "border-green-500/20" : awaitingCheck ? "strip-pending" : "strip-alarm !border-red-500/20"}`}
      aria-label={`${name} monitor strip`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded((value) => !value);
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            className={"text-sm tracking-wider " + (variant === "dashboard" ? "font-semibold text-[var(--text-main)]" : "text-phosphor uppercase")}
          >
            {name}
          </h2>
          <span
            className={
              isUp
                ? "text-xs tracking-widest text-phosphor"
                : awaitingCheck
                  ? "text-xs tracking-widest text-amber"
                  : "alarm-blink-text text-xs tracking-widest text-alarm text-alarm-glow"
            }
          >
            {statusLabel}
          </span>
          {!awaitingCheck && statusCode != null && (
            <span className="text-[10px] text-muted">HTTP {statusCode}</span>
          )}
        </div>

        <div className="flex gap-4 text-xs">
          <span className="tracking-wider text-amber">
            {responseTimeMs != null ? `${responseTimeMs} ms` : "--- ms"}
          </span>
          <span className="text-muted">{formatCheckedAt(checkedAt)}</span>
          {hasHistory && (
            <span className="text-[10px] text-muted">{checks.length} pts</span>
          )}
          {!hasHistory && !awaitingCheck && (
            <span className="text-[10px] text-muted">No history yet</span>
          )}
        </div>
      </div>

      {/* Expiry monitoring — compact supplementary row (ICU theme, monospace) */}
      {variant === "dashboard" && (onToggleSsl || onToggleDomain) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 border-y border-grid/50 bg-black/20 px-2 py-2">
          <label className="flex items-center gap-1.5 text-[10px] tracking-widest text-muted uppercase">
            <Switch
              checked={!!sslMonitoringEnabled}
              onCheckedChange={(v) => {
                if (isToggling) return;
                onToggleSsl?.(v);
              }}
              disabled={isToggling}
              aria-label="SSL Monitoring"
              className="scale-90"
              onClick={(e) => e.stopPropagation()}
            />
            SSL
          </label>
          <ExpiryBadge kind="SSL" expiresAt={certExpiresAt} stage={sslAlertStage} enabled={!!sslMonitoringEnabled} />
          <span className="h-3 w-px bg-grid/50" aria-hidden />
          <label className="flex items-center gap-1.5 text-[10px] tracking-widest text-muted uppercase">
            <Switch
              checked={!!domainMonitoringEnabled}
              onCheckedChange={(v) => {
                if (isToggling) return;
                onToggleDomain?.(v);
              }}
              disabled={isToggling}
              aria-label="Domain Monitoring"
              className="scale-90"
              onClick={(e) => e.stopPropagation()}
            />
            Domain
          </label>
          <ExpiryBadge kind="Domain" expiresAt={domainExpiresAt} stage={domainAlertStage} enabled={!!domainMonitoringEnabled} />
        </div>
      )}

      <div className="relative h-20 overflow-hidden border border-grid bg-bg">
        {!isUp && !awaitingCheck && (
          <span className="alarm-blink-text absolute top-1.5 right-2 z-10 text-[10px] tracking-[0.2em] text-alarm text-alarm-glow">
            ALM
          </span>
        )}

        <svg
          className="h-full w-full"
          viewBox={`0 0 800 ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {awaitingCheck ? (
            <line
              x1="0"
              y1={BASELINE}
              x2="800"
              y2={BASELINE}
              stroke="var(--color-phosphor-dim)"
              strokeWidth="1"
              strokeDasharray="6 8"
              opacity="0.5"
            />
          ) : hasHistory ? (
            <g>
              {!reducedMotion && (
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0 0"
                  to={`${-historyWidth} 0`}
                  dur={`${duration}s`}
                  repeatCount="indefinite"
                />
              )}
              {Array.from({ length: historyTileCount }, (_, index) => (
                <path
                  key={index}
                  d={history.path}
                  transform={`translate(${(index - 1) * historyWidth}, 0)`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="1.75"
                  vectorEffect="non-scaling-stroke"
                  className={!isUp ? "alarm-blink-line" : undefined}
                />
              ))}
            </g>
          ) : isUp ? (
            <g
              className="wave-scroll"
              style={{
                "--wave-duration": `${duration}s`,
                "--wave-shift": `${-BEAT_WIDTH}px`,
              } as React.CSSProperties}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <path
                  key={i}
                  d={FALLBACK_BEAT_PATH}
                  transform={fallbackBeatTransform(i, amplitude)}
                  fill="none"
                  stroke="var(--color-phosphor)"
                  strokeWidth="1.75"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ) : (
            <line
              x1="0"
              y1={BASELINE}
              x2="800"
              y2={BASELINE}
              stroke="var(--color-alarm)"
              strokeWidth="2"
              className="alarm-blink-line"
            />
          )}
        </svg>
      </div>

      {expanded && (
        <div className="monitor-detail grid gap-4 text-xs sm:grid-cols-4">
          <div>
            <p className="vital-label">History</p>
            <p className="mt-1 text-phosphor">{checks.length || "—"} recent checks</p>
          </div>
          <div>
            <p className="vital-label">Availability</p>
            <p className="mt-1 text-phosphor">
              {uptime == null ? "Awaiting data" : `${uptime}% in visible history`}
            </p>
          </div>
          <div>
            <p className="vital-label">Average latency</p>
            <p className="mt-1 text-amber">
              {averageLatency == null ? "—" : `${averageLatency} ms`}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="vital-label">Inspection</p>
            <p className="mt-1 text-muted">Click again to collapse</p>
          </div>
          {!publicSlug && latestCheck?.assertionResults && latestCheck.assertionResults.length > 0 && (
            <div className="sm:col-span-4">
              <AssertionResultBadge results={latestCheck.assertionResults} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}