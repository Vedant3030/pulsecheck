"use client";

import type { StepResultSummary } from "@/types/monitor";

/**
 * Per-step status chips for chain monitors. Prefers the latest check's
 * stepResults (with failing-step highlight); falls back to plain step names.
 */
export function ChainStepChips({
  steps,
  stepResults,
}: {
  steps?: { name: string }[];
  stepResults?: StepResultSummary[] | null;
}) {
  const names = steps ?? [];
  if ((!stepResults || stepResults.length === 0) && names.length === 0) return null;
  const failingIndex = stepResults?.find((s) => s.status !== "up")?.stepIndex ?? null;
  const rows = stepResults && stepResults.length > 0
    ? stepResults.map((s) => ({ name: s.name, up: s.status === "up", failed: s.stepIndex === failingIndex }))
    : names.map((s) => ({ name: s.name, up: null as boolean | null, failed: false }));
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {rows.map((row, i) => (
        <span
          key={i}
          title={row.failed ? "Failing step" : row.up === null ? row.name : `${row.name} — ${row.up ? "up" : "down"}`}
          className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
            row.failed
              ? "border-red-500/50 bg-red-500/10 text-red-300"
              : row.up === null
                ? "border-grid text-[var(--text-muted)]"
                : row.up
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {i + 1}. {row.name}
        </span>
      ))}
    </div>
  );
}
