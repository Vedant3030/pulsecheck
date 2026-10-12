"use client";

import { useRef, useState } from "react";
import type { AssertionInput } from "@/lib/api";
import { AssertionComposer, assertionSentence } from "@/components/AssertionComposer";

export interface ChainStepForm {
  id?: string;
  name: string;
  method: string;
  url: string;
  requestBody: string;
  headers: { key: string; value: string }[];
  authType: string;
  authValue: string;
  authHeaderName: string;
  hasAuth: boolean;
  extracts: { variable: string; source: string; path: string }[];
  assertions: AssertionInput[];
}

export const EMPTY_CHAIN_STEP: ChainStepForm = {
  name: "",
  method: "GET",
  url: "",
  requestBody: "",
  headers: [],
  authType: "none",
  authValue: "",
  authHeaderName: "X-API-Key",
  hasAuth: false,
  extracts: [],
  assertions: [],
};

const BODY_METHODS = ["POST", "PUT", "PATCH"];

function varsAvailableTo(steps: ChainStepForm[], index: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < index; i++) {
    for (const rule of steps[i].extracts) {
      if (rule.variable.trim() && !out.includes(rule.variable.trim())) out.push(rule.variable.trim());
    }
  }
  return out;
}

export function ChainStepsEditor({
  steps,
  onChange,
}: {
  steps: ChainStepForm[];
  onChange: (steps: ChainStepForm[]) => void;
}) {
  function update(index: number, patch: Partial<ChainStepForm>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  // Clickable variable chips: insert {{name}} into the focused field of the
  // same step, or copy to clipboard when nothing is focused. Chip mousedown
  // is cancelled so the input keeps focus (and its cursor position).
  const fieldRefs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [chipNote, setChipNote] = useState<{ index: number; text: string } | null>(null);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function fieldProps(key: string) {
    return {
      ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (el) fieldRefs.current.set(key, el);
        else fieldRefs.current.delete(key);
      },
      onFocus: () => setFocusedField(key),
    };
  }

  function showChipNote(index: number, text: string) {
    setChipNote({ index, text });
    if (chipTimer.current) clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setChipNote(null), 2500);
  }

  function insertToken(stepIndex: number, variable: string) {
    const token = `{{${variable}}}`;
    const step = steps[stepIndex];
    const key =
      focusedField && focusedField.startsWith(`${stepIndex}:`) ? focusedField : `${stepIndex}:url`;
    const el = fieldRefs.current.get(key);
    const field = key.split(":").slice(1).join(":");
    const current =
      field === "url" ? step.url
      : field === "body" ? step.requestBody
      : field === "auth" ? step.authValue
      : field.startsWith("header:")
        ? (step.headers[Number(field.split(":")[1])]?.value ?? "")
        : null;
    if (el && current !== null) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      if (field === "url") update(stepIndex, { url: next });
      else if (field === "body") update(stepIndex, { requestBody: next });
      else if (field === "auth") update(stepIndex, { authValue: next });
      else {
        const hi = Number(field.split(":")[1]);
        update(stepIndex, { headers: step.headers.map((r, i) => (i === hi ? { ...r, value: next } : r)) });
      }
      const pos = start + token.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
      showChipNote(stepIndex, `Inserted ${token}`);
      return;
    }
    try {
      void navigator.clipboard?.writeText(token);
      showChipNote(stepIndex, `Copied ${token} — focus a field and click again to insert`);
    } catch {
      showChipNote(stepIndex, `Copy this: ${token}`);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-4 md:col-span-2">
      {steps.map((step, index) => {
        const available = varsAvailableTo(steps, index);
        return (
          <section key={index} className="rounded-lg border border-grid p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--text-main)]">
                Step {index + 1}{step.name.trim() ? ` — ${step.name.trim()}` : ""}
              </h4>
              <div className="flex gap-2">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30" aria-label="Move step up">↑</button>
                <button type="button" disabled={index === steps.length - 1} onClick={() => move(index, 1)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30" aria-label="Move step down">↓</button>
                <button type="button" disabled={steps.length <= 1} onClick={() => onChange(steps.filter((_, i) => i !== index))} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30" aria-label="Remove step">✕</button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="management-label">Step name</label>
                <input value={step.name} onChange={(e) => update(index, { name: e.target.value })} className="management-control w-full" placeholder="Login" />
              </div>
              <div>
                <label className="management-label">Method</label>
                <select value={step.method} onChange={(e) => update(index, { method: e.target.value })} className="management-control w-full">
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="management-label">URL</label>
                <input value={step.url} onChange={(e) => update(index, { url: e.target.value })} {...fieldProps(`${index}:url`)} className="management-control w-full font-mono" placeholder="https://api.example.com/login" spellCheck={false} />
                {available.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-[var(--text-muted)]">Insert variable:</span>
                    {available.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertToken(index, v)}
                        title={`Insert {{${v}}} into the focused field`}
                        className="rounded border border-grid px-1.5 py-0.5 font-mono text-[11px] text-phosphor transition hover:border-phosphor"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                    {chipNote && chipNote.index === index && (
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">{chipNote.text}</span>
                    )}
                  </div>
                )}
              </div>
              {BODY_METHODS.includes(step.method) && (
                <div className="md:col-span-2">
                  <label className="management-label">JSON body</label>
                  <textarea value={step.requestBody} onChange={(e) => update(index, { requestBody: e.target.value })} {...fieldProps(`${index}:body`)} className="management-control w-full font-mono" rows={4} spellCheck={false} />
                </div>
              )}
            </div>

            <div className="mt-3">
              <p className="management-label">Custom headers</p>
              {step.headers.map((row, hi) => (
                <div key={hi} className="mt-2 flex gap-2">
                  <input value={row.key} onChange={(e) => update(index, { headers: step.headers.map((r, i) => (i === hi ? { ...r, key: e.target.value } : r)) })} className="management-control w-full" placeholder="Header name" aria-label="Header name" />
                  <input value={row.value} onChange={(e) => update(index, { headers: step.headers.map((r, i) => (i === hi ? { ...r, value: e.target.value } : r)) })} {...fieldProps(`${index}:header:${hi}`)} className="management-control w-full" placeholder="Header value — {{variables}} allowed" aria-label="Header value" />
                  <button type="button" onClick={() => update(index, { headers: step.headers.filter((_, i) => i !== hi) })} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Remove header">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => update(index, { headers: [...step.headers, { key: "", value: "" }] })} className="mt-2 text-xs font-medium text-phosphor hover:underline">+ Add header</button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="management-label">Auth</label>
                <select value={step.authType} onChange={(e) => update(index, { authType: e.target.value, authValue: "" })} className="management-control w-full">
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="apiKey">API Key</option>
                </select>
              </div>
              {step.authType === "apiKey" && (
                <div>
                  <label className="management-label">Header name</label>
                  <input value={step.authHeaderName} onChange={(e) => update(index, { authHeaderName: e.target.value })} className="management-control w-full" placeholder="X-API-Key" />
                </div>
              )}
            </div>
            {step.authType !== "none" && (
              <div className="mt-3">
                <label className="management-label">Secret value ({"{{variables}}"} allowed)</label>
                {step.hasAuth && !step.authValue && (
                  <p className="mb-2 text-xs text-[var(--text-muted)]">Auth configured (hidden) — leave empty to keep it, or type a new value to replace it.</p>
                )}
                <input type="password" value={step.authValue} onChange={(e) => update(index, { authValue: e.target.value })} {...fieldProps(`${index}:auth`)} className="management-control w-full" placeholder={step.hasAuth ? "Leave empty to keep existing" : "Enter secret"} autoComplete="new-password" />
              </div>
            )}

            <div className="mt-3">
              <p className="management-label">Extract variables for later steps</p>
              {step.extracts.map((rule, ei) => (
                <div key={ei} className="mt-2 grid gap-2 md:grid-cols-[1fr_8rem_1fr_auto]">
                  <input value={rule.variable} onChange={(e) => update(index, { extracts: step.extracts.map((r, i) => (i === ei ? { ...r, variable: e.target.value } : r)) })} className="management-control w-full font-mono" placeholder="token" aria-label="Variable name" />
                  <select value={rule.source} onChange={(e) => update(index, { extracts: step.extracts.map((r, i) => (i === ei ? { ...r, source: e.target.value, path: e.target.value === "status" ? "" : r.path } : r)) })} className="management-control w-full" aria-label="Extract source">
                    <option value="body">body</option>
                    <option value="header">header</option>
                    <option value="status">status</option>
                  </select>
                  {rule.source === "status" ? (
                    <p className="self-center text-xs text-[var(--text-muted)]">HTTP status code</p>
                  ) : (
                    <input value={rule.path} onChange={(e) => update(index, { extracts: step.extracts.map((r, i) => (i === ei ? { ...r, path: e.target.value } : r)) })} className="management-control w-full font-mono" placeholder={rule.source === "body" ? "$.data.token" : "X-RateLimit-Remaining"} aria-label="Extract path" spellCheck={false} />
                  )}
                  <button type="button" onClick={() => update(index, { extracts: step.extracts.filter((_, i) => i !== ei) })} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Remove extract rule">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => update(index, { extracts: [...step.extracts, { variable: "", source: "body", path: "" }] })} className="mt-2 text-xs font-medium text-phosphor hover:underline">+ Add extract rule</button>
            </div>

            <div className="mt-3">
              <p className="management-label">Step assertions (a step with none passes on 2xx)</p>
              {step.assertions.map((a, ai) => (
                <div key={ai} className="mt-1 flex items-center gap-2 text-xs">
                  <code className="font-mono text-[var(--text-main)]">{assertionSentence(a.type, a.field ?? null, a.operator, a.expectedValue)}</code>
                  <button type="button" onClick={() => update(index, { assertions: step.assertions.filter((_, i) => i !== ai) })} className="text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Remove assertion">✕</button>
                </div>
              ))}
              <AssertionComposer onAdd={(a) => update(index, { assertions: [...step.assertions, a] })} idPrefix={`chain-step-${index}`} />
            </div>
          </section>
        );
      })}
      {steps.length < 5 && (
        <button type="button" onClick={() => onChange([...steps, { ...EMPTY_CHAIN_STEP, headers: [], extracts: [], assertions: [] }])} className="management-button management-button-secondary">+ Add step ({steps.length}/5)</button>
      )}
    </div>
  );
}
