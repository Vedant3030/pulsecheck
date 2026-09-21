"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createAssertion,
  deleteAssertion,
  fetchAssertions,
} from "@/lib/api";
import type {
  AssertionOperator,
  AssertionType,
  MonitorAssertion,
} from "@/types/monitor";

const TYPE_OPTIONS: { value: AssertionType; label: string }[] = [
  { value: "STATUS_CODE", label: "Status code" },
  { value: "RESPONSE_TIME", label: "Response time (ms)" },
  { value: "BODY_CONTAINS", label: "Body contains" },
  { value: "JSON_FIELD_EQUALS", label: "JSON field" },
];

const OPERATORS_BY_TYPE: Record<AssertionType, AssertionOperator[]> = {
  STATUS_CODE: ["EQUALS"],
  RESPONSE_TIME: ["EQUALS", "LESS_THAN", "GREATER_THAN"],
  BODY_CONTAINS: ["CONTAINS", "EQUALS"],
  JSON_FIELD_EQUALS: ["EQUALS", "CONTAINS", "LESS_THAN", "GREATER_THAN"],
};

function operatorLabel(operator: AssertionOperator): string {
  switch (operator) {
    case "EQUALS":
      return "equals";
    case "CONTAINS":
      return "contains";
    case "LESS_THAN":
      return "< less than";
    case "GREATER_THAN":
      return "> greater than";
  }
}

/** Mirrors backend strict validation so bad rules are caught before submit. */
function validateInput(
  type: AssertionType,
  field: string,
  operator: AssertionOperator,
  expectedValue: string,
): string | null {
  if (!expectedValue.trim()) return "Expected value is required.";
  if (type === "JSON_FIELD_EQUALS" && !field.trim()) {
    return "Field path is required for JSON field assertions (e.g. data.status).";
  }
  const numericExpected =
    type === "STATUS_CODE" ||
    type === "RESPONSE_TIME" ||
    (type === "JSON_FIELD_EQUALS" &&
      (operator === "LESS_THAN" || operator === "GREATER_THAN"));
  if (numericExpected && Number.isNaN(Number(expectedValue))) {
    return "Expected value must be numeric for this rule.";
  }
  return null;
}

function ruleSummary(assertion: MonitorAssertion): string {
  const target =
    assertion.type === "JSON_FIELD_EQUALS" && assertion.field
      ? `JSON ${assertion.field}`
      : assertion.type === "STATUS_CODE"
        ? "Status code"
        : assertion.type === "RESPONSE_TIME"
          ? "Response time"
          : "Response body";
  return `${target} ${operatorLabel(assertion.operator)} ${assertion.expectedValue}`;
}

export function AssertionManager({
  monitorId,
  monitorName,
}: {
  monitorId: string;
  monitorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [assertions, setAssertions] = useState<MonitorAssertion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<AssertionType>("STATUS_CODE");
  const [field, setField] = useState("");
  const [operator, setOperator] = useState<AssertionOperator>("EQUALS");
  const [expectedValue, setExpectedValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssertions(await fetchAssertions(monitorId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assertions");
    } finally {
      setLoading(false);
    }
  }, [monitorId]);

  useEffect(() => {
    if (open && assertions === null && !loading) {
      void load();
    }
  }, [open, assertions, loading, load]);

  function handleTypeChange(next: AssertionType) {
    setType(next);
    // Keep operator valid for the new type (mirrors backend strict combos)
    if (!OPERATORS_BY_TYPE[next].includes(operator)) {
      setOperator(OPERATORS_BY_TYPE[next][0]);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateInput(type, field, operator, expectedValue);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createAssertion(monitorId, {
        type,
        field: type === "JSON_FIELD_EQUALS" ? field.trim() : null,
        operator,
        expectedValue: expectedValue.trim(),
      });
      setField("");
      setExpectedValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create assertion");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assertionId: string) {
    setSaving(true);
    setError(null);
    try {
      await deleteAssertion(monitorId, assertionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete assertion");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-grid/50 px-4 py-2 md:px-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]"
      >
        {open ? "▾" : "▸"} Assertions
        {assertions !== null && assertions.length > 0 && (
          <span className="ml-1 rounded-full bg-bg-strip px-2 py-0.5 text-[10px]">
            {assertions.length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 pb-2">
          {error && (
            <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}

          {loading || assertions === null ? (
            <p className="text-xs text-[var(--text-muted)]">Loading assertions…</p>
          ) : assertions.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No assertions yet — this monitor is judged on HTTP status alone.
              Add one below to fail the check when the response content is wrong.
            </p>
          ) : (
            <ul className="mb-3 space-y-2">
              {assertions.map((assertion) => (
                <li
                  key={assertion.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-grid bg-black/20 px-3 py-2 text-xs"
                >
                  <span className="font-mono text-[var(--text-main)]">
                    {ruleSummary(assertion)}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDelete(assertion.id)}
                    aria-label={`Delete assertion for ${monitorName}`}
                    className="shrink-0 text-[var(--text-muted)] transition hover:text-red-300"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="grid gap-2 md:grid-cols-[10rem_1fr_9rem_9rem_auto]">
            <label className="sr-only" htmlFor={`assert-type-${monitorId}`}>Rule type</label>
            <select
              id={`assert-type-${monitorId}`}
              value={type}
              onChange={(event) => handleTypeChange(event.target.value as AssertionType)}
              className="management-control text-xs"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor={`assert-field-${monitorId}`}>JSON field path</label>
            <input
              id={`assert-field-${monitorId}`}
              value={field}
              onChange={(event) => setField(event.target.value)}
              className={`management-control font-mono text-xs ${type === "JSON_FIELD_EQUALS" ? "" : "hidden"}`}
              placeholder="data.status"
              tabIndex={type === "JSON_FIELD_EQUALS" ? undefined : -1}
            />

            <label className="sr-only" htmlFor={`assert-op-${monitorId}`}>Operator</label>
            <select
              id={`assert-op-${monitorId}`}
              value={operator}
              onChange={(event) => setOperator(event.target.value as AssertionOperator)}
              className="management-control text-xs"
            >
              {OPERATORS_BY_TYPE[type].map((value) => (
                <option key={value} value={value}>
                  {operatorLabel(value)}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor={`assert-expected-${monitorId}`}>Expected value</label>
            <input
              id={`assert-expected-${monitorId}`}
              value={expectedValue}
              onChange={(event) => setExpectedValue(event.target.value)}
              className="management-control font-mono text-xs"
              placeholder={type === "STATUS_CODE" ? "200" : type === "RESPONSE_TIME" ? "1500" : "expected value"}
            />

            <button
              type="submit"
              disabled={saving}
              className="management-button management-button-secondary text-xs"
            >
              {saving ? "Saving…" : "Add rule"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
