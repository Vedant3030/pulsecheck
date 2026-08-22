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
  variant = "clinical",
}: WaveformStripProps) {
  const isUp = status === "up";
  const awaitingCheck = !isUp && checkedAt == null;
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [expanded, setExpanded] = useState(false);

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
        // Keep last known history on transient errors
      });

    return () => {
      cancelled = true;
    };
  }, [monitorId, checkedAt, awaitingCheck, publicSlug]);

  const history = useMemo(() => buildHistoryWaveform(checks), [checks]);
  const hasHistory = checks.length >= 2;
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
      className={`${variant === "dashboard" ? "dashboard-monitor" : "monitor-strip-button panel-border bg-bg-strip"} p-4 ${isUp ? "" : awaitingCheck ? "strip-pending" : "strip-alarm"}`}
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
            className={`text-sm tracking-wider ${variant === "dashboard" ? "font-semibold text-slate-50" : "text-phosphor uppercase"}`}
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
        </div>
      </div>

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
              <animateTransform
                attributeName="transform"
                type="translate"
                from="0 0"
                to={`${-historyWidth} 0`}
                dur={`${duration}s`}
                repeatCount="indefinite"
              />
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
              style={
                {
                  "--wave-duration": `${duration}s`,
                  "--wave-shift": `${-BEAT_WIDTH}px`,
                } as React.CSSProperties
              }
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
        </div>
      )}
    </article>
  );
}
