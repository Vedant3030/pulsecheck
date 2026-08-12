"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMonitorChecks, fetchPublicMonitorChecks } from "@/lib/api";
import {
  BASELINE,
  BEAT_WIDTH,
  FALLBACK_BEAT_PATH,
  SEGMENT_WIDTH,
  VIEW_HEIGHT,
  buildHistoryPath,
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
}: WaveformStripProps) {
  const isUp = status === "up";
  const awaitingCheck = !isUp && checkedAt == null;
  const [checks, setChecks] = useState<CheckResult[]>([]);

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

  const historyPath = useMemo(() => buildHistoryPath(checks), [checks]);
  const hasHistory = checks.length >= 2;
  const historyWidth = Math.max(checks.length * SEGMENT_WIDTH, BEAT_WIDTH);

  const scrollShift = hasHistory ? historyWidth : BEAT_WIDTH;
  const duration = scrollDurationForShift(scrollShift, responseTimeMs);
  const amplitude = latencyToAmplitude(responseTimeMs);
  const statusLabel = awaitingCheck ? "INIT" : status.toUpperCase();

  const strokeColor = awaitingCheck
    ? "var(--color-phosphor-dim)"
    : isUp
      ? "var(--color-phosphor)"
      : "var(--color-alarm)";

  return (
    <article
      className={`panel-border bg-bg-strip p-4 ${isUp ? "" : awaitingCheck ? "strip-pending" : "strip-alarm"}`}
      aria-label={`${name} monitor strip`}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm tracking-wider text-phosphor uppercase">
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
            <g
              className="wave-scroll"
              style={
                {
                  "--wave-duration": `${duration}s`,
                  "--wave-shift": `${-historyWidth}px`,
                } as React.CSSProperties
              }
            >
              <path
                d={historyPath}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
                className={!isUp ? "alarm-blink-line" : undefined}
              />
              <path
                d={historyPath}
                transform={`translate(${historyWidth}, 0)`}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
                className={!isUp ? "alarm-blink-line" : undefined}
              />
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
    </article>
  );
}
