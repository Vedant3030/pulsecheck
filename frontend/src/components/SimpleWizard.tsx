"use client";

import { useState } from "react";
import { createAssertion, createMonitor } from "@/lib/api";
import type { AssertionInput } from "@/lib/api";

type WizardKind = "website" | "api" | "keyword";

const KINDS: { value: WizardKind; title: string; hint: string }[] = [
  { value: "website", title: "A website", hint: "Alert me when it goes down." },
  { value: "api", title: "An API", hint: "Alert me when it stops returning 200." },
  { value: "keyword", title: "A page keyword", hint: "Alert me when text disappears." },
];

/** Three-question guided setup for Simple mode (create only). Same create payload as the simple form. */
export function SimpleWizard({
  maxMonitors,
  monitorCount,
  onDone,
  onCancel,
}: {
  maxMonitors: number;
  monitorCount: number;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<WizardKind | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validDetails(): boolean {
    if (!name.trim() || !url.trim()) return false;
    if (kind === "keyword" && !keyword.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function handleCreate() {
    if (monitorCount >= maxMonitors) {
      setError(`Plan limit reached: up to ${maxMonitors} monitors on this plan.`);
      return;
    }
    if (!validDetails() || !kind) {
      setError("Give the monitor a name, a full http or https URL, and a keyword when asked.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createMonitor({
        name: name.trim(),
        url: url.trim(),
        intervalMins: 30,
        isActive: true,
        method: "GET",
      });
      const assertions: AssertionInput[] =
        kind === "api"
          ? [{ type: "STATUS_CODE", field: null, operator: "EQUALS", expectedValue: "200" }]
          : kind === "keyword"
            ? [{ type: "BODY_CONTAINS", field: null, operator: "CONTAINS", expectedValue: keyword.trim() }]
            : [];
      for (const a of assertions) {
        await createAssertion(created.id, { type: a.type, field: a.field, operator: a.operator, expectedValue: a.expectedValue });
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the monitor.");
    } finally {
      setCreating(false);
    }
  }

  const kindLabel = kind === null ? "" : KINDS.find((k) => k.value === kind)?.title ?? "";

  return (
    <div className="mt-5">
      <ol className="flex items-center gap-2 text-xs" aria-label="Setup progress">
        {["What", "Details", "Review"].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                step > i + 1
                  ? "border-phosphor bg-phosphor text-black"
                  : step === i + 1
                    ? "border-phosphor text-phosphor"
                    : "border-grid text-[var(--text-muted)]"
              }`}
            >
              {i + 1}
            </span>
            <span className={step === i + 1 ? "text-[var(--text-main)]" : "text-[var(--text-muted)]"}>{label}</span>
            {i < 2 && <span className="mx-1 h-px w-6 bg-grid" />}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="mt-4">
          <p className="management-label">What do you want to watch?</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => {
                  setKind(k.value);
                  setStep(2);
                }}
                className="rounded-lg border border-grid p-4 text-left transition hover:border-phosphor hover:bg-bg-strip"
              >
                <span className="block text-sm font-medium text-[var(--text-main)]">{k.title}</span>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">{k.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <p className="text-sm text-[var(--text-main)]">
              Watching: <span className="font-medium">{kindLabel}</span>{" "}
              <button type="button" onClick={() => setStep(1)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">
                Change
              </button>
            </p>
          </div>
          <div>
            <label htmlFor="wizard-name" className="management-label">Name it</label>
            <input
              id="wizard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="management-control w-full"
              placeholder="My homepage"
            />
          </div>
          <div>
            <label htmlFor="wizard-url" className="management-label">Paste the URL</label>
            <input
              id="wizard-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="management-control w-full font-mono"
              placeholder="https://example.com"
              spellCheck={false}
            />
          </div>
          {kind === "keyword" && (
            <div className="md:col-span-2">
              <label htmlFor="wizard-keyword" className="management-label">Text that must stay on the page</label>
              <input
                id="wizard-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="management-control w-full font-mono"
                placeholder="Open now"
                spellCheck={false}
              />
            </div>
          )}
          <div className="flex gap-3 md:col-span-2">
            <button type="button" onClick={() => setStep(1)} className="management-button management-button-secondary">Back</button>
            <button type="button" disabled={!validDetails()} onClick={() => setStep(3)} className="management-button management-button-primary">Review</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4">
          <div className="rounded-lg border border-grid p-4 text-sm">
            <p className="font-medium text-[var(--text-main)]">{name.trim() || "Untitled monitor"}</p>
            <p className="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{url.trim()}</p>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              <li>Checks every 30 minutes from our servers.</li>
              {kind === "api" && <li>Alerts unless the status code is 200.</li>}
              {kind === "keyword" && <li>Alerts unless the page still contains {keyword.trim()}.</li>}
              {kind === "website" && <li>Alerts when the page goes down.</li>}
            </ul>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="management-button management-button-secondary">Back</button>
            <button type="button" disabled={creating} onClick={() => void handleCreate()} className="management-button management-button-primary">
              {creating ? "Creating…" : "Start monitoring"}
            </button>
            <button type="button" onClick={onCancel} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
