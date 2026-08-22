import type { CheckResult } from "@/types/monitor";

export const SEGMENT_WIDTH = 20;
export const BASELINE = 40;
export const VIEW_HEIGHT = 80;
export const BEAT_WIDTH = 120;

export interface HistoryWaveform {
  path: string;
  width: number;
}

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
 * Build a continuous SVG path from timestamped check history.
 *
 * Horizontal distance is derived from the elapsed time between checks, normalized
 * against the monitor's typical (median) check gap. This keeps a 1-minute monitor
 * and a 5-minute monitor equally readable while preserving meaningful late/missed
 * check gaps. Checks must be ordered oldest → newest (most recent last).
 */
export function buildHistoryWaveform(checks: CheckResult[]): HistoryWaveform {
  if (checks.length === 0) return { path: "", width: BEAT_WIDTH };

  const gaps = checks
    .slice(1)
    .map((check, index) => new Date(check.checkedAt).getTime() - new Date(checks[index].checkedAt).getTime())
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const widths = checks.map((check, index) => {
    if (index === 0 || typicalGap === 0) return SEGMENT_WIDTH;
    const elapsed = new Date(check.checkedAt).getTime() - new Date(checks[index - 1].checkedAt).getTime();
    // Corrupt/out-of-order timestamps fall back to the normal segment width.
    if (!Number.isFinite(elapsed) || elapsed <= 0) return SEGMENT_WIDTH;
    // Retain timing information without allowing one delayed job to create a blank screen.
    return SEGMENT_WIDTH * Math.min(Math.max(elapsed / typicalGap, 0.55), 3);
  });

  const parts: string[] = [];
  let x = 0;

  for (let i = 0; i < checks.length; i++) {
    const segmentWidth = widths[i];
    const xEnd = x + segmentWidth;
    const check = checks[i];

    if (i === 0) {
      parts.push(`M ${x} ${BASELINE}`);
    }

    if (check.status !== "up") {
      parts.push(`L ${xEnd} ${BASELINE}`);
      x = xEnd;
      continue;
    }

    const amp = latencyToAmplitude(check.responseTimeMs);
    const peak = BASELINE - 32 * amp;
    const trough = BASELINE + 15 * amp;
    const mid = x + segmentWidth * 0.45;
    const spikeWidth = Math.min(segmentWidth * 0.18, 8);

    parts.push(
      `L ${mid - spikeWidth} ${BASELINE}`,
      `L ${mid - spikeWidth / 4} ${BASELINE - 2 * amp}`,
      `L ${mid} ${peak}`,
      `L ${mid + spikeWidth / 4} ${trough}`,
      `L ${mid + spikeWidth} ${BASELINE}`,
      `L ${xEnd} ${BASELINE}`,
    );

    x = xEnd;
  }

  return { path: parts.join(" "), width: Math.max(x, BEAT_WIDTH) };
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
