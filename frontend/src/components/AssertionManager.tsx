"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createAssertion,
  deleteAssertion,
  fetchAssertions,
} from "@/lib/api";
import type { AssertionInput, } from "@/lib/api";
import type {
  MonitorAssertion,
} from "@/types/monitor";
import { AssertionComposer, assertionSentence } from "@/components/AssertionComposer";

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

  async function handleAddAssertion(input: AssertionInput) {
    setSaving(true);
    setError(null);
    try {
      await createAssertion(monitorId, input);
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
                    {assertionSentence(assertion.type, assertion.field, assertion.operator, assertion.expectedValue)}
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

          <AssertionComposer onAdd={(input) => void handleAddAssertion(input)} idPrefix={monitorId} disabled={saving} />
        </div>
      )}
    </div>
  );
}
