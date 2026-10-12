"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { AssertionManager } from "@/components/AssertionManager";
import { useRouter } from "next/navigation";
import { createMonitor, deleteMonitor, fetchMe, testChainRequest, testMonitorRequest, updateMonitor } from "@/lib/api";
import type { ChainStepInput, ChainTestResult, MonitorInput, TestRequestInput, TestRequestResult } from "@/lib/api";
import { LOGIN_EXPIRED_PATH } from "@/lib/auth";
import { getDisplayStatus } from "@/lib/monitor-status";
import { useMonitors } from "@/hooks/useMonitors";
import type { Monitor } from "@/types/monitor";
import { LogoutButton } from "@/components/LogoutButton";
import { PublicSlugSettings } from "@/components/PublicSlugSettings";
import { AppBrand } from "@/components/ui/AppBrand";
import { ChainStepsEditor } from "@/components/ChainStepsEditor";
import type { ChainStepForm } from "@/components/ChainStepsEditor";
import { ChainStepChips } from "@/components/ChainStepChips";
import { useMode } from "@/hooks/useMode";

const EMPTY_FORM = { name: "", url: "", intervalMins: "5", isActive: true, method: "GET", requestBody: "", headers: [] as { key: string; value: string }[], authType: "none", authValue: "", authHeaderName: "X-API-Key", hasAuth: false, monitorType: "single" as "single" | "chain", chainSteps: [] as ChainStepForm[] };
type Filter = "all" | "up" | "down" | "paused";

const BODY_METHODS = ["POST", "PUT", "PATCH"];

function headersToObject(rows: { key: string; value: string }[]): Record<string, string> | null {
  const obj: Record<string, string> = {};
  for (const row of rows) {
    if (!row.key.trim() && !row.value) continue;
    obj[row.key.trim()] = row.value;
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

/** Interval choices by plan. Grandfathered values stay selectable as "(current)" so frozen rows can be saved unchanged. */
function intervalOptions(current: string, isFree: boolean): { value: string; label: string }[] {
  const allowed = isFree ? ["30", "60"] : ["1", "5", "15", "30", "60"];
  const opts = allowed.map((v) => ({ value: v, label: `Every ${v} minute${v === "1" ? "" : "s"}` }));
  if (!allowed.includes(current)) {
    opts.unshift({ value: current, label: `${current} minutes (current)` });
  }
  return opts;
}

function formatCheckedAt(value: string | null): string {
  if (!value) return "No checks yet";
  return new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function StatusBadge({ monitor }: { monitor: Monitor }) {
  const display = !monitor.isActive ? "paused" : getDisplayStatus(monitor);
  const label = display === "init" ? "Awaiting check" : display === "paused" ? "Paused" : display === "up" ? "Operational" : "Down";
  return <span className={`status-badge status-badge-${display}`}><span className={`status-dot ${display === "up" ? "status-dot-up" : display === "down" ? "status-dot-down" : "status-dot-pending"}`} />{label}</span>;
}

export function ManageMonitors() {
  const router = useRouter();
  const { monitors, loading, error: loadError, refetch } = useMonitors({ pollIntervalMs: false, refetchOnFocus: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const { isSimple } = useMode();
  // Billing plan — free until the profile loads (secure default; the
  // backend enforces every limit regardless of what the UI shows).
  const [plan, setPlan] = useState<string>("free");
  useEffect(() => {
    fetchMe().then((profile) => setPlan(profile.plan ?? "free")).catch(() => {});
  }, []);
  const isFree = plan !== "pro";
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestRequestResult | null>(null);
  const [chainTestResult, setChainTestResult] = useState<ChainTestResult | null>(null);

const TEST_ERROR_COPY: Record<string, string> = {
  blocked_target: "This address isn't allowed: private and internal addresses can't be tested.",
  dns_failure: "That hostname couldn't be resolved. Check the spelling and try again.",
  timeout: "The request timed out after 10 seconds.",
  connection_refused: "The server refused the connection. Check the host and port.",
  connection_failed: "The connection failed before a response was received.",
  tls_error: "The server's TLS certificate couldn't be verified.",
  invalid_input: "Check the request details and try again.",
  not_found: "That monitor no longer exists.",
  rate_limited: "Too many test requests — wait a minute and try again.",
  upstream_error: "The test request failed unexpectedly.",
};

function prettyPreviewBody(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return preview;
  }
}

  const displayError = error ?? loadError;
  const filteredMonitors = useMemo(() => {
    const query = search.trim().toLowerCase();
    return monitors.filter((monitor) => {
      const matchesQuery = !query || monitor.name.toLowerCase().includes(query) || monitor.url.toLowerCase().includes(query);
      const matchesFilter = filter === "all" || (filter === "paused" ? !monitor.isActive : monitor.isActive && monitor.status === filter && monitor.checkedAt != null);
      return matchesQuery && matchesFilter;
    });
  }, [filter, monitors, search]);

  function resetForm() { setForm(EMPTY_FORM); setEditingId(null); setFormOpen(false); setTestResult(null); setChainTestResult(null); }
  function startCreate() { setError(null); setEditingId(null); setForm({ ...EMPTY_FORM, intervalMins: isFree ? "30" : "5", chainSteps: [] }); setFormOpen(true); setTestResult(null); setChainTestResult(null); }
  function startEdit(monitor: Monitor) { setError(null); setEditingId(monitor.id); setForm({ name: monitor.name, url: monitor.url, intervalMins: String(monitor.intervalMins), isActive: monitor.isActive, method: monitor.method ?? "GET", requestBody: monitor.requestBody ?? "", headers: Object.entries(monitor.requestHeaders ?? {}).map(([key, value]) => ({ key, value })), authType: monitor.authType ?? "none", authValue: "", authHeaderName: monitor.authHeaderName ?? "X-API-Key", hasAuth: monitor.hasAuth ?? false, monitorType: monitor.type ?? "single", chainSteps: (monitor.steps ?? []).map((s) => ({ id: s.id, name: s.name, method: s.method ?? "GET", url: s.url, requestBody: s.requestBody ?? "", headers: Object.entries(s.requestHeaders ?? {}).map(([key, value]) => ({ key, value })), authType: s.authType ?? "none", authValue: "", authHeaderName: s.authHeaderName ?? "X-API-Key", hasAuth: s.hasAuth ?? false, extracts: (s.extracts ?? []).map((r) => ({ variable: r.variable, source: r.source, path: r.path ?? "" })), assertions: (s.assertions ?? []).map((a) => ({ type: a.type, field: a.field, operator: a.operator, expectedValue: a.expectedValue })) })) }); setFormOpen(true); setTestResult(null); setChainTestResult(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function handleFailure(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : fallback;
    if (message === "Session expired") { router.replace(LOGIN_EXPIRED_PATH); return; }
    setError(message);
  }

  function buildTestInput(): TestRequestInput | null {
    const showBody = BODY_METHODS.includes(form.method);
    const trimmedBody = form.requestBody.trim();
    if (showBody && trimmedBody !== "") {
      try { JSON.parse(form.requestBody); }
      catch { setError("Request body must be valid JSON."); return null; }
    }
    for (const row of form.headers) {
      if (!row.key.trim() && row.value) { setError("Header keys must not be empty."); return null; }
    }
    if (form.authType !== "none" && !form.hasAuth && !form.authValue) { setError("Enter a secret value for the selected auth type."); return null; }
    const input: TestRequestInput = { method: form.method, url: form.url.trim() };
    input.requestBody = showBody && trimmedBody !== "" ? form.requestBody : null;
    input.requestHeaders = headersToObject(form.headers);
    if (form.authType === "none") { input.authType = null; }
    else {
      input.authType = form.authType;
      if (form.authType === "apiKey") input.authHeaderName = form.authHeaderName.trim() || "X-API-Key";
      if (form.authValue) input.authValue = form.authValue;
    }
    return input;
  }

  async function handleTestRequest() {
    if (testing || !form.url.trim()) return;
    const input = buildTestInput();
    if (!input) return;
    // Edit mode with stored auth and an untouched secret field: let the
    // server use the saved credential instead of sending nothing.
    if (editingId && form.authType !== "none" && !form.authValue && form.hasAuth) {
      input.monitorId = editingId;
    }
    setTesting(true); setTestResult(null); setError(null);
    try {
      const result = await testMonitorRequest(input);
      setTestResult(result);
    } catch (err) { handleFailure(err, "Test request failed"); }
    finally { setTesting(false); }
  }

  const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
  const VAR_REF_RE = /\{\{([A-Za-z_][A-Za-z0-9_]{0,31})\}\}/g;

  function buildChainStepsInput(): ChainStepInput[] | null {
    if (form.chainSteps.length === 0 || form.chainSteps.length > 5) {
      setError("Chains need 1 to 5 steps.");
      return null;
    }
    const defined = new Set<string>();
    const out: ChainStepInput[] = [];
    for (let i = 0; i < form.chainSteps.length; i++) {
      const step = form.chainSteps[i];
      const label = `Step ${i + 1}`;
      if (!step.name.trim()) { setError(`${label} needs a name.`); return null; }
      if (!step.url.trim()) { setError(`${label} needs a URL.`); return null; }
      const showBody = BODY_METHODS.includes(step.method);
      const trimmedBody = step.requestBody.trim();
      if (showBody && trimmedBody !== "" && !/\{\{[A-Za-z_][A-Za-z0-9_]{0,31}\}\}/.test(step.requestBody)) {
        try { JSON.parse(step.requestBody); }
        catch { setError(`${label}: request body must be valid JSON.`); return null; }
      }
      for (const row of step.headers) {
        if (!row.key.trim() && row.value) { setError(`${label}: header keys must not be empty.`); return null; }
      }
      if (step.authType !== "none" && !step.hasAuth && !step.authValue) {
        setError(`${label}: enter a secret value for the selected auth type.`);
        return null;
      }
      const seenVars = new Set<string>();
      for (const rule of step.extracts) {
        if (!VAR_NAME_RE.test(rule.variable)) { setError(`${label}: variable names must match /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.`); return null; }
        if (seenVars.has(rule.variable)) { setError(`${label}: duplicate variable '${rule.variable}'.`); return null; }
        seenVars.add(rule.variable);
        if (rule.source === "header" && !rule.path.trim()) { setError(`${label}: header extracts need a header name.`); return null; }
        if (rule.source === "body" && rule.path !== "$" && !/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+$/.test(rule.path)) {
          setError(`${label}: extract path must look like $.data.token or $.items[0].id.`);
          return null;
        }
      }
      const templates = [step.url, ...step.headers.map((r) => r.value)];
      if (trimmedBody !== "") templates.push(step.requestBody);
      if (step.authValue) templates.push(step.authValue);
      for (const t of templates) {
        VAR_REF_RE.lastIndex = 0;
        let m;
        while ((m = VAR_REF_RE.exec(t)) !== null) {
          if (!defined.has(m[1])) { setError(`${label}: variable '{{${m[1]}}}' is not defined by an earlier step.`); return null; }
        }
      }
      for (const a of step.assertions) {
        if (!String(a.expectedValue).trim()) { setError(`${label}: assertion expected value is required.`); return null; }
        if (a.type === "JSON_FIELD_EQUALS" && !(a.field || "").trim()) { setError(`${label}: JSON field assertions need a field path.`); return null; }
      }
      const input: ChainStepInput = {
        ...(step.id ? { id: step.id } : {}),
        name: step.name.trim(),
        method: step.method,
        url: step.url.trim(),
        requestBody: showBody && trimmedBody !== "" ? step.requestBody : null,
        requestHeaders: headersToObject(step.headers),
        extracts: step.extracts.map((r) => ({ variable: r.variable, source: r.source, path: r.source === "header" ? r.path.trim() : (r.path === "" ? null : r.path) })),
        assertions: step.assertions,
      };
      if (step.authType === "none") { input.authType = null; }
      else {
        input.authType = step.authType;
        if (step.authType === "apiKey") input.authHeaderName = step.authHeaderName.trim() || "X-API-Key";
        if (step.authValue) input.authValue = step.authValue;
      }
      out.push(input);
      for (const rule of step.extracts) defined.add(rule.variable);
    }
    return out;
  }

  async function handleChainTest() {
    if (testing) return;
    const steps = buildChainStepsInput();
    if (!steps) return;
    setTesting(true); setChainTestResult(null); setError(null);
    try {
      const result = await testChainRequest({ steps, ...(editingId ? { monitorId: editingId } : {}) });
      setChainTestResult(result);
    } catch (err) { handleFailure(err, "Chain test failed"); }
    finally { setTesting(false); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mins = Number(form.intervalMins);
    if (!Number.isFinite(mins) || mins < 1) {
      setError("Check interval must be at least 1 minute.");
      return;
    }
    if (isSimple) {
      // Simple mode: name + URL only, fixed 30-minute interval. Minimal
      // payload — PUT leaves every other field untouched server-side.
      if (!form.url.trim()) {
        setError("URL is required.");
        return;
      }
      setSaving(true); setError(null);
      const simplePayload: MonitorInput = { name: form.name.trim(), url: form.url.trim(), intervalMins: 30, isActive: form.isActive };
      try { if (editingId) await updateMonitor(editingId, simplePayload); else await createMonitor(simplePayload); resetForm(); await refetch(); }
      catch (err) { handleFailure(err, "Failed to save monitor"); }
      finally { setSaving(false); }
      return;
    }
    if (isFree && mins < 30) {
      const storedMins = editingId ? monitors.find((m) => m.id === editingId)?.intervalMins : undefined;
      if (mins !== storedMins) {
        setError("Free plan checks every 30 minutes or slower.");
        return;
      }
    }
    if (!editingId) {
      const cap = isFree ? 5 : 50;
      if (monitors.length >= cap) {
        setError(`Plan limit reached: up to ${cap} monitors on this plan.`);
        return;
      }
    }
    if (form.monitorType === "chain") {
      if (isFree) {
        setError("Multi-step chains are a Pro feature. Upgrade coming soon.");
        return;
      }
      if (mins < 5) {
        setError("Chain monitors must be checked at most every 5 minutes.");
        return;
      }
      setSaving(true); setError(null);
      const steps = buildChainStepsInput();
      if (!steps) { setSaving(false); return; }
      const payload: MonitorInput = { name: form.name.trim(), intervalMins: mins, isActive: form.isActive, type: "chain", steps };
      try { if (editingId) await updateMonitor(editingId, payload); else await createMonitor(payload); resetForm(); await refetch(); }
      catch (err) { handleFailure(err, "Failed to save monitor"); }
      finally { setSaving(false); }
      return;
    }
    setSaving(true); setError(null);
    const showBody = BODY_METHODS.includes(form.method);
    const trimmedBody = form.requestBody.trim();
    if (showBody && trimmedBody !== "") {
      try { JSON.parse(form.requestBody); }
      catch { setSaving(false); setError("Request body must be valid JSON."); return; }
    }
    for (const row of form.headers) {
      if (!row.key.trim() && row.value) { setSaving(false); setError("Header keys must not be empty."); return; }
    }
    if (form.authType !== "none" && !form.hasAuth && !form.authValue) { setSaving(false); setError("Enter a secret value for the selected auth type."); return; }
    const payload: MonitorInput = { name: form.name.trim(), url: form.url.trim(), intervalMins: mins, isActive: form.isActive, method: form.method };
    payload.requestBody = showBody && trimmedBody !== "" ? form.requestBody : null;
    payload.requestHeaders = headersToObject(form.headers);
    if (form.authType === "none") { payload.authType = null; }
    else {
      payload.authType = form.authType;
      if (form.authType === "apiKey") payload.authHeaderName = form.authHeaderName.trim() || "X-API-Key";
      if (form.authValue) payload.authValue = form.authValue;
    }
    try { if (editingId) await updateMonitor(editingId, payload); else await createMonitor(payload); resetForm(); await refetch(); }
    catch (err) { handleFailure(err, "Failed to save monitor"); }
    finally { setSaving(false); }
  }

  async function handleToggle(monitor: Monitor) {
    setSaving(true); setError(null);
    try { await updateMonitor(monitor.id, { name: monitor.name, url: monitor.url, intervalMins: monitor.intervalMins, isActive: !monitor.isActive }); await refetch(); }
    catch (err) { handleFailure(err, "Failed to update monitor"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setSaving(true); setError(null);
    try { await deleteMonitor(pendingDelete.id); if (editingId === pendingDelete.id) resetForm(); setPendingDelete(null); await refetch(); }
    catch (err) { handleFailure(err, "Failed to delete monitor"); }
    finally { setSaving(false); }
  }

  return (
    <div className="dashboard-shell min-h-screen">
      <header className="border-b border-grid bg-bg/95 px-5 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AppBrand compact />
            <div>
              <p className="text-xs font-medium text-[var(--text-muted)]">PulseCheck</p>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)]">Monitor management</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]">← Back to overview</Link>
            <Link href="/settings" className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]">Settings</Link>
            <LogoutButton className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7 md:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Monitors</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Configure endpoints, review their latest checks, and control monitoring.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isFree ? (
              <span className="rounded-md border border-grid px-2 py-1 text-xs text-[var(--text-muted)]">Free plan · {monitors.length}/5 monitors</span>
            ) : (
              <span className="rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs font-medium text-green-300">Pro plan</span>
            )}
            <button type="button" onClick={startCreate} className="management-button management-button-primary">+ Add monitor</button>
          </div>
        </div>

        {displayError && <section role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{displayError}</section>}

        {formOpen && <section className="dashboard-panel mb-6 p-5"><div className="flex items-center justify-between gap-4"><div><h3 className="text-base font-semibold text-[var(--text-main)]">{editingId ? "Edit monitor" : "Add monitor"}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{editingId ? "Update the endpoint or monitoring configuration." : "Add a URL to begin monitoring its availability."}</p></div><button type="button" onClick={resetForm} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">Close</button></div><form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">{!isSimple && !isFree && (<div className="md:col-span-2 flex gap-2" role="group" aria-label="Monitor type"><button type="button" onClick={() => setForm({ ...form, monitorType: "single" })} className={`management-button ${form.monitorType === "single" ? "management-button-primary" : "management-button-secondary"}`} aria-pressed={form.monitorType === "single"}>Single request</button><button type="button" onClick={() => setForm({ ...form, monitorType: "chain" })} className={`management-button ${form.monitorType === "chain" ? "management-button-primary" : "management-button-secondary"}`} aria-pressed={form.monitorType === "chain"}>Multi-step chain</button></div>)}{!isSimple && isFree && (<div className="md:col-span-2 rounded-lg border border-grid p-4"><p className="text-sm text-[var(--text-main)]">Multi-step chains are a Pro feature. <span className="text-[var(--text-muted)]">Upgrade coming soon.</span></p></div>)}{isSimple && form.monitorType === "chain" && (<div className="md:col-span-2 rounded-lg border border-grid p-4"><p className="text-sm text-[var(--text-main)]">This is a multi-step chain — switch to Dev mode to edit its steps.</p></div>)}<div><label htmlFor="name" className="management-label">Monitor name</label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="management-control w-full" placeholder="Production API" /></div>{(form.monitorType === "single" || isSimple) && (<Fragment><div><label htmlFor="url" className="management-label">URL</label><input id="url" type="url" required value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} className="management-control w-full" placeholder="https://api.example.com/health" /></div>{!isSimple && (<div><label htmlFor="method" className="management-label">Method</label><select id="method" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })} className="management-control w-full">{["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>)}</Fragment>)}{isSimple ? (<div><p className="management-label">Check interval</p><p className="mt-2 text-sm text-[var(--text-main)]">Every 30 minutes</p></div>) : (<div><label htmlFor="intervalMins" className="management-label">Check interval (minutes)</label><select id="intervalMins" required value={form.intervalMins} onChange={(event) => setForm({ ...form, intervalMins: event.target.value })} className="management-control w-full">{intervalOptions(form.intervalMins, isFree).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{isFree && (<p className="mt-1 text-xs text-[var(--text-muted)]">Free plan checks every 30 minutes or slower.</p>)}</div>)}{!isSimple && form.monitorType === "single" && BODY_METHODS.includes(form.method) && <div className="md:col-span-2"><label htmlFor="requestBody" className="management-label">JSON body</label><textarea id="requestBody" value={form.requestBody} onChange={(event) => setForm({ ...form, requestBody: event.target.value })} className="management-control w-full font-mono" rows={5} placeholder={'{\n  "key": "value"\n}'} spellCheck={false} /></div>}{editingId && <label className="flex items-center gap-2 self-end pb-2 text-sm text-[var(--text-main)]"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-[var(--color-grid)] bg-bg-strip text-phosphor" /> Monitoring enabled</label>}{!isSimple && form.monitorType === "chain" && (<Fragment><div className="md:col-span-2"><p className="management-label">Steps (max 5, run in order, stop at first failure)</p><p className="mt-1 text-xs text-[var(--text-muted)]">Each step can use variables from earlier steps as {"{{name}}"} in URL, headers, body, or auth value. Chain monitors run at most every 5 minutes.</p></div><ChainStepsEditor steps={form.chainSteps} onChange={(chainSteps) => setForm({ ...form, chainSteps })} /><div className="flex gap-3 md:col-span-2"><button type="button" onClick={handleChainTest} disabled={testing || form.chainSteps.length === 0} className="management-button management-button-secondary">{testing ? "Testing…" : "Run chain test"}</button></div><p className="text-xs text-[var(--text-muted)] md:col-span-2">Test requests are sent from PulseCheck&apos;s servers. Extracted values are never shown.</p>{chainTestResult && (<div role="status" className="md:col-span-2 rounded-lg border border-grid p-4">{chainTestResult.ok ? (<div><div className="flex flex-wrap items-center gap-3 text-sm"><span className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold ${chainTestResult.status === "up" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>{chainTestResult.status === "up" ? "CHAIN UP" : `CHAIN DOWN${chainTestResult.failedStepIndex != null ? ` AT STEP ${chainTestResult.failedStepIndex + 1}` : ""}`}</span></div><div className="mt-3 space-y-3">{chainTestResult.steps.map((s) => (<div key={s.stepIndex} className="rounded-md border border-grid p-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold ${s.status === "up" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>{s.stepIndex + 1}. {s.name} — {s.statusCode ?? "—"} · {s.status.toUpperCase()}</span><span className="text-xs text-[var(--text-muted)]">{s.responseTimeMs ?? "—"} ms</span></div>{s.error && (<p className="mt-2 text-xs text-red-300">{s.error}</p>)}{s.assertions.length > 0 && (<ul className="mt-2 space-y-1">{s.assertions.map((a, ai) => (<li key={ai} className={`text-xs ${a.pass ? "text-green-300" : "text-red-300"}`}>{a.pass ? "✓" : "✗"} {a.message}</li>))}</ul>)}{s.extracts.length > 0 && (<p className="mt-2 text-xs text-[var(--text-muted)]">Extracts: {s.extracts.map((e) => `${e.variable} (${e.extracted ? "extracted" : "not found"})`).join(", ")}</p>)}{s.bodyPreview && (<pre className="management-control mt-2 max-h-40 overflow-auto font-mono text-xs">{prettyPreviewBody(s.bodyPreview) || "(empty body)"}</pre>)}</div>))}</div></div>) : (<div><p className="text-sm font-medium text-red-300">Chain test failed</p><p className="mt-1 text-sm text-[var(--text-main)]">{TEST_ERROR_COPY[chainTestResult.code] ?? chainTestResult.message}</p><p className="mt-1 font-mono text-xs text-[var(--text-muted)]">code: {chainTestResult.code}</p></div>)}</div>)}</Fragment>)}{!isSimple && form.monitorType === "single" && (<details className="md:col-span-2 rounded-lg border border-grid p-4"><summary className="cursor-pointer text-sm font-medium text-[var(--text-main)]">Advanced: headers & auth</summary><div className="mt-4"><p className="management-label">Custom headers</p>{form.headers.map((row, index) => <div key={index} className="mt-2 flex gap-2"><input value={row.key} onChange={(event) => setForm({ ...form, headers: form.headers.map((r, i) => i === index ? { ...r, key: event.target.value } : r) })} className="management-control w-full" placeholder="Header name" aria-label="Header name" /><input value={row.value} onChange={(event) => setForm({ ...form, headers: form.headers.map((r, i) => i === index ? { ...r, value: event.target.value } : r) })} className="management-control w-full" placeholder="Header value" aria-label="Header value" /><button type="button" onClick={() => setForm({ ...form, headers: form.headers.filter((_, i) => i !== index) })} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Remove header">✕</button></div>)}<button type="button" onClick={() => setForm({ ...form, headers: [...form.headers, { key: "", value: "" }] })} className="mt-2 text-xs font-medium text-phosphor hover:underline">+ Add header</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><div><label htmlFor="authType" className="management-label">Auth</label><select id="authType" value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value, authValue: "" })} className="management-control w-full"><option value="none">None</option><option value="bearer">Bearer Token</option><option value="apiKey">API Key</option></select></div>{form.authType === "apiKey" && <div><label htmlFor="authHeaderName" className="management-label">Header name</label><input id="authHeaderName" value={form.authHeaderName} onChange={(event) => setForm({ ...form, authHeaderName: event.target.value })} className="management-control w-full" placeholder="X-API-Key" /></div>}</div>{form.authType !== "none" && <div className="mt-4"><label htmlFor="authValue" className="management-label">Secret value</label>{editingId && form.hasAuth && !form.authValue && <p className="mb-2 text-xs text-[var(--text-muted)]">Auth configured (hidden) — leave empty to keep it, or type a new value to replace it.</p>}<input id="authValue" type="password" value={form.authValue} onChange={(event) => setForm({ ...form, authValue: event.target.value })} className="management-control w-full" placeholder={editingId && form.hasAuth ? "Leave empty to keep existing" : "Enter secret"} autoComplete="new-password" /></div>}</details>)}<div className="flex gap-3 md:col-span-2"><button type="submit" disabled={saving} className="management-button management-button-primary">{saving ? "Saving…" : editingId ? "Save changes" : "Add monitor"}</button><button type="button" onClick={resetForm} className="management-button management-button-secondary">Cancel</button>{!isSimple && form.monitorType === "single" && (<button type="button" onClick={handleTestRequest} disabled={testing || !form.url.trim()} className="management-button management-button-secondary">{testing ? "Testing…" : "Send test request"}</button>)}</div><p className="text-xs text-[var(--text-muted)] md:col-span-2">Test requests are sent from PulseCheck&apos;s servers.</p>{!isSimple && form.monitorType === "single" && testResult && <div role="status" className="md:col-span-2 rounded-lg border border-grid p-4">{testResult.ok ? <div><div className="flex flex-wrap items-center gap-3 text-sm"><span className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold ${testResult.statusCode < 300 ? "border-green-500/30 bg-green-500/10 text-green-300" : testResult.statusCode < 400 ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>{testResult.statusCode}{testResult.statusText ? ` ${testResult.statusText}` : ""}</span><span className="text-[var(--text-muted)]">{testResult.durationMs} ms</span><span className="truncate text-[var(--text-muted)]">{testResult.contentType ?? "no content type"}</span></div>{testResult.redirectLocation && <p className="mt-2 truncate text-xs text-[var(--text-muted)]">Redirects to: {testResult.redirectLocation} (not followed)</p>}<pre className="management-control mt-3 max-h-64 overflow-auto font-mono text-xs">{prettyPreviewBody(testResult.bodyPreview) || "(empty body)"}</pre>{testResult.bodyTruncated && <p className="mt-2 text-xs text-[var(--text-muted)]">Response truncated — showing the first 4KB.</p>}</div> : <div><p className="text-sm font-medium text-red-300">Test failed</p><p className="mt-1 text-sm text-[var(--text-main)]">{TEST_ERROR_COPY[testResult.code] ?? testResult.message}</p><p className="mt-1 font-mono text-xs text-[var(--text-muted)]">code: {testResult.code}</p></div>}</div>}</form></section>}

        <section className="dashboard-panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-grid p-4 md:p-5"><div><h3 className="text-base font-semibold text-[var(--text-main)]">All monitors <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">{monitors.length}</span></h3><p className="mt-1 text-xs text-[var(--text-muted)]">Search, filter, and manage your monitored services.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><input value={search} onChange={(event) => setSearch(event.target.value)} className="management-control w-56 pr-8" placeholder="Search monitors…" aria-label="Search monitors" /><span className="pointer-events-none absolute right-3 top-2.5 text-[var(--text-muted)]">⌕</span></div>{(["all", "up", "down", "paused"] as Filter[]).map((value) => <button key={value} type="button" className="dashboard-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
          {loading ? <div className="p-8"><p className="text-sm text-[var(--text-muted)]">Loading monitors…</p><div className="mt-4 space-y-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-bg-strip" />)}</div></div> : monitors.length === 0 ? <div className="p-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(var(--color-phosphor-rgb),0.1)] text-xl text-phosphor">+</div><h3 className="mt-4 text-base font-semibold text-[var(--text-main)]">No monitors yet</h3><p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-muted)]">Add your first endpoint to start tracking uptime and response time.</p><button type="button" onClick={startCreate} className="management-button management-button-primary mt-5">Add your first monitor</button></div> : filteredMonitors.length === 0 ? <div className="p-12 text-center"><h3 className="text-base font-semibold text-[var(--text-main)]">No matching monitors</h3><p className="mt-2 text-sm text-[var(--text-muted)]">Try another search term or clear the active filter.</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="mt-4 text-xs font-medium text-phosphor hover:underline">Clear filters</button></div> : <div>{filteredMonitors.map((monitor) => <Fragment key={monitor.id}><article className="management-table-row grid gap-4 p-4 md:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_7rem_9rem_auto] md:items-center md:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-semibold text-[var(--text-main)]">{monitor.name}</h4><StatusBadge monitor={monitor} /></div><p className="mt-1 truncate text-xs text-[var(--text-muted)]">{monitor.url}</p><ChainStepChips steps={monitor.steps} stepResults={monitor.stepResults} /></div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-[var(--text-muted)]">Response time</p><p className="mt-1 font-medium text-[var(--text-main)]">{monitor.responseTimeMs == null ? "—" : `${monitor.responseTimeMs} ms`}</p></div><div><p className="text-[var(--text-muted)]">Last check</p><p className="mt-1 font-medium text-[var(--text-main)]">{formatCheckedAt(monitor.checkedAt)}</p></div></div><div className="text-xs"><p className="text-[var(--text-muted)]">Interval</p><p className="mt-1 font-medium text-[var(--text-main)]">Every {monitor.intervalMins} min</p></div><div className="text-xs"><p className="text-[var(--text-muted)]">Check state</p><p className="mt-1 font-medium text-[var(--text-main)]">{monitor.checkedAt ? `${monitor.statusCode ?? "—"} · ${monitor.status.toUpperCase()}` : "Pending"}</p></div><div className="flex flex-wrap gap-2 md:justify-end"><button type="button" disabled={saving} onClick={() => handleToggle(monitor)} className="management-button management-button-secondary">{monitor.isActive ? "Disable" : "Enable"}</button><button type="button" onClick={() => startEdit(monitor)} className="management-button management-button-secondary">Edit</button><button type="button" disabled={saving} onClick={() => setPendingDelete(monitor)} className="management-button management-button-danger">Delete</button></div></article>{isSimple ? null : (monitor.type === "chain" ? (<p className="mt-2 text-xs text-[var(--text-muted)]">Chain assertions are managed per step in the editor.</p>) : (<AssertionManager monitorId={monitor.id} monitorName={monitor.name} />))}</Fragment>)}</div>}
        </section>

        <section className="mt-6"><PublicSlugSettings /></section>
      </main>

      {pendingDelete && <div className="confirmation-backdrop fixed inset-0 z-50 flex items-center justify-center p-5" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="dashboard-panel w-full max-w-md p-6 shadow-2xl"><h2 id="delete-title" className="text-lg font-semibold text-[var(--text-main)]">Delete monitor?</h2><p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">This will permanently remove <span className="font-medium text-[var(--text-main)]">{pendingDelete.name}</span> and its recorded checks. This action cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={() => setPendingDelete(null)} className="management-button management-button-secondary">Cancel</button><button type="button" disabled={saving} onClick={handleDelete} className="management-button management-button-danger">{saving ? "Deleting…" : "Delete monitor"}</button></div></section></div>}
    </div>
  );
}
