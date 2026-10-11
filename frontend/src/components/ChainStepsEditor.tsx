"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { AssertionInput } from "@/lib/api";
import type { AssertionOperator, AssertionType } from "@/types/monitor";

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

const ASSERTION_TYPES: AssertionType[] = ["STATUS_CODE", "RESPONSE_TIME", "BODY_CONTAINS", "JSON_FIELD_EQUALS"];
const OPERATORS_BY_TYPE: Record<AssertionType, AssertionOperator[]> = {
  STATUS_CODE: ["EQUALS"],
  RESPONSE_TIME: ["EQUALS", "LESS_THAN", "GREATER_THAN"],
  BODY_CONTAINS: ["CONTAINS", "EQUALS"],
  JSON_FIELD_EQUALS: ["EQUALS", "CONTAINS", "LESS_THAN", "GREATER_THAN"],
};

function varsAvailableTo(steps: ChainStepForm[], index: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < index; i++) {
    for (const rule of steps[i].extracts) {
      if (rule.variable.trim() && !out.includes(rule.variable.trim())) out.push(rule.variable.trim());
    }
  }
  return out;
}

function NewAssertionForm({ onAdd }: { onAdd: (a: AssertionInput) => void }) {
  const [type, setType] = useState<AssertionType>("STATUS_CODE");
  const [operator, setOperator] = useState<AssertionOperator>("EQUALS");
  const [field, setField] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const operators = OPERATORS_BY_TYPE[type];
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
      <select
        value={type}
        onChange={(e) => { const t = e.target.value as AssertionType; setType(t); setOperator(OPERATORS_BY_TYPE[t][0]); }}
        className="management-control w-full"
        aria-label="Assertion type"
      >
        {ASSERTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value as AssertionOperator)}
        className="management-control w-full"
        aria-label="Assertion operator"
      >
        {operators.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        value={type === "JSON_FIELD_EQUALS" ? field : expectedValue}
        onChange={(e) => (type === "JSON_FIELD_EQUALS" ? setField(e.target.value) : setExpectedValue(e.target.value))}
        className="management-control w-full"
        placeholder={type === "JSON_FIELD_EQUALS" ? "field, e.g. data.status" : "expected value"}
        aria-label={type === "JSON_FIELD_EQUALS" ? "Assertion field" : "Assertion expected value"}
      />
      {type === "JSON_FIELD_EQUALS" && (
        <input
          value={expectedValue}
          onChange={(e) => setExpectedValue(e.target.value)}
          className="management-control w-full"
          placeholder="expected value"
          aria-label="Assertion expected value"
        />
      )}
      <button
        type="button"
        onClick={() => {
          onAdd({ type, operator, field: type === "JSON_FIELD_EQUALS" ? field : null, expectedValue });
          setField("");
          setExpectedValue("");
        }}
        className="text-xs font-medium text-phosphor hover:underline"
      >
        + Add rule
      </button>
    </div>
  );
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
                <input value={step.url} onChange={(e) => update(index, { url: e.target.value })} className="management-control w-full font-mono" placeholder="https://api.example.com/login" spellCheck={false} />
                {available.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Available variables: {available.map((v) => <code key={v} className="font-mono text-phosphor">{`{{${v}}}`}</code>).reduce((acc: ReactNode[], el, i) => (i === 0 ? [el] : [...acc, ", ", el]), [])}
                  </p>
                )}
              </div>
              {BODY_METHODS.includes(step.method) && (
                <div className="md:col-span-2">
                  <label className="management-label">JSON body</label>
                  <textarea value={step.requestBody} onChange={(e) => update(index, { requestBody: e.target.value })} className="management-control w-full font-mono" rows={4} spellCheck={false} />
                </div>
              )}
            </div>

            <div className="mt-3">
              <p className="management-label">Custom headers</p>
              {step.headers.map((row, hi) => (
                <div key={hi} className="mt-2 flex gap-2">
                  <input value={row.key} onChange={(e) => update(index, { headers: step.headers.map((r, i) => (i === hi ? { ...r, key: e.target.value } : r)) })} className="management-control w-full" placeholder="Header name" aria-label="Header name" />
                  <input value={row.value} onChange={(e) => update(index, { headers: step.headers.map((r, i) => (i === hi ? { ...r, value: e.target.value } : r)) })} className="management-control w-full" placeholder="Header value — {{variables}} allowed" aria-label="Header value" />
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
                <input type="password" value={step.authValue} onChange={(e) => update(index, { authValue: e.target.value })} className="management-control w-full" placeholder={step.hasAuth ? "Leave empty to keep existing" : "Enter secret"} autoComplete="new-password" />
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
                  <code className="font-mono text-[var(--text-main)]">{a.type} {a.operator}{a.field ? ` ${a.field}` : ""} = {a.expectedValue}</code>
                  <button type="button" onClick={() => update(index, { assertions: step.assertions.filter((_, i) => i !== ai) })} className="text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Remove assertion">✕</button>
                </div>
              ))}
              <NewAssertionForm onAdd={(a) => update(index, { assertions: [...step.assertions, a] })} />
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
