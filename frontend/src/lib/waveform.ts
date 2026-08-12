import type { CheckResult } from "@/types/monitor";

export const SEGMENT_WIDTH = 20;
export const BASELINE = 40;
export const VIEW_HEIGHT = 80;
export const BEAT_WIDTH = 120;

/** Map latency → spike height (slow = weaker pulse). */
export function latencyToAmplitude(responseTimeMs: number | null): number {
  const ms = responseTimeMs ?? 500;
  const clamped = Math.min(Math.max(ms, 50), 3000);
  return 1 - ((clamped - 50) / 2950) * 0.45;
}

/** Target crawl speed — real monitor paper drift, not a frantic scroll. */
const SCROLL_PX_PER_SEC = 32;

/** Map scroll distance + latency → animation duration (seconds). */
export function scrollDurationForShift(
  shiftPx: number,
  responseTimeMs: number | null,
): number {
  const ms = responseTimeMs ?? 500;
  const clamped = Math.min(Math.max(ms, 50), 3000);
  // High latency → slightly slower drift (calmer when the site is sluggish)
  const latencyFactor = 1 + (clamped / 3000) * 0.35;

  const duration = (Math.abs(shiftPx) / SCROLL_PX_PER_SEC) * latencyFactor;

  // Never frantic, never frozen — ~4s for a single beat, up to ~50s for long history
  return Math.min(Math.max(duration, 4), 50);
}

/** @deprecated use scrollDurationForShift — kept for reference */
export function latencyToDuration(responseTimeMs: number | null): number {
  return scrollDurationForShift(BEAT_WIDTH, responseTimeMs);
}

/**
 * Build one continuous SVG path from check history.
 * Each check = one segment; UP draws a QRS spike scaled by latency, DOWN stays flat.
 * Checks must be ordered oldest → newest (most recent last).
 */
export function buildHistoryPath(checks: CheckResult[]): string {
  if (checks.length === 0) return "";

  const parts: string[] = [];

  for (let i = 0; i < checks.length; i++) {
    const x = i * SEGMENT_WIDTH;
    const xEnd = x + SEGMENT_WIDTH;
    const check = checks[i];

    if (i === 0) {
      parts.push(`M ${x} ${BASELINE}`);
    }

    if (check.status !== "up") {
      parts.push(`L ${xEnd} ${BASELINE}`);
      continue;
    }

    const amp = latencyToAmplitude(check.responseTimeMs);
    const peak = BASELINE - 32 * amp;
    const trough = BASELINE + 15 * amp;
    const mid = x + SEGMENT_WIDTH * 0.45;

    parts.push(
      `L ${mid - 8} ${BASELINE}`,
      `L ${mid - 2} ${BASELINE - 2 * amp}`,
      `L ${mid} ${peak}`,
      `L ${mid + 2} ${trough}`,
      `L ${mid + 8} ${BASELINE}`,
      `L ${xEnd} ${BASELINE}`,
    );
  }

  return parts.join(" ");
}

/** Decorative fallback beat when history hasn't loaded yet. */
export const FALLBACK_BEAT_PATH = [
  `M 0 ${BASELINE}`,
  `L 20 ${BASELINE}`,
  `L 25 ${BASELINE - 2}`,
  `L 30 ${BASELINE}`,
  `L 35 ${BASELINE - 32}`,
  `L 40 ${BASELINE + 15}`,
  `L 45 ${BASELINE - 8}`,
  `L 50 ${BASELINE}`,
  `L ${BEAT_WIDTH} ${BASELINE}`,
].join(" ");

export function fallbackBeatTransform(index: number, amplitude: number): string {
  const x = index * BEAT_WIDTH;
  return `translate(${x}, 0) translate(0, ${BASELINE}) scale(1, ${amplitude}) translate(0, ${-BASELINE})`;
}
