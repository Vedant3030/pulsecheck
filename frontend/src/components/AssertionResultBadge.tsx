"use client";

import type { AssertionResult } from "@/types/monitor";

function ruleLabel(result: AssertionResult): string {
  const target =
    result.type === "JSON_FIELD_EQUALS" && result.field
      ? `JSON ${result.field}`
      : result.type === "STATUS_CODE"
        ? "Status code"
        : result.type === "RESPONSE_TIME"
          ? "Response time"
          : "Response body";
  return `${target} ${result.operator} ${result.expectedValue}`;
}

export function AssertionResultBadge({
  results,
}: {
  results: AssertionResult[] | null | undefined;
}) {
  if (!results || results.length === 0) return null;

  const failed = results.filter((result) => !result.pass);
  const passedCount = results.length - failed.length;

  return (
    <div className="mt-2 border-t border-grid/50 pt-2">
      <p className="vital-label">
        Assertions{" "}
        <span className={failed.length > 0 ? "text-alarm" : "text-phosphor"}>
          {failed.length > 0
            ? `${failed.length} failed`
            : `${passedCount} passed`}
        </span>
      </p>
      {failed.length > 0 && (
        <ul className="mt-2 space-y-2">
          {failed.map((result, index) => (
            <li
              key={`${result.type}-${result.field ?? "body"}-${index}`}
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2"
            >
              <p className="font-medium text-red-200">
                {ruleLabel(result)}
                <span className="ml-2 font-normal text-red-200/70">
                  (got {result.actual})
                </span>
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-red-200/80">
                {result.message}
              </p>
            </li>
          ))}
        </ul>
      )}
      {failed.length === 0 && (
        <p className="mt-1 text-[11px] text-muted">
          All {passedCount} assertion{passedCount === 1 ? "" : "s"} passed on
          the latest check.
        </p>
      )}
    </div>
  );
}
