"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createMonitor, deleteMonitor, updateMonitor } from "@/lib/api";
import { LOGIN_EXPIRED_PATH } from "@/lib/auth";
import { getDisplayStatus } from "@/lib/monitor-status";
import { useMonitors } from "@/hooks/useMonitors";
import type { Monitor } from "@/types/monitor";
import { LogoutButton } from "@/components/LogoutButton";
import { PublicSlugSettings } from "@/components/PublicSlugSettings";

const EMPTY_FORM = { name: "", url: "", intervalMins: "5", isActive: true };
type Filter = "all" | "up" | "down" | "paused";

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
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null);

  const displayError = error ?? loadError;
  const filteredMonitors = useMemo(() => {
    const query = search.trim().toLowerCase();
    return monitors.filter((monitor) => {
      const matchesQuery = !query || monitor.name.toLowerCase().includes(query) || monitor.url.toLowerCase().includes(query);
      const matchesFilter = filter === "all" || (filter === "paused" ? !monitor.isActive : monitor.isActive && monitor.status === filter && monitor.checkedAt != null);
      return matchesQuery && matchesFilter;
    });
  }, [filter, monitors, search]);

  function resetForm() { setForm(EMPTY_FORM); setEditingId(null); setFormOpen(false); }
  function startCreate() { setError(null); setEditingId(null); setForm(EMPTY_FORM); setFormOpen(true); }
  function startEdit(monitor: Monitor) { setError(null); setEditingId(monitor.id); setForm({ name: monitor.name, url: monitor.url, intervalMins: String(monitor.intervalMins), isActive: monitor.isActive }); setFormOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function handleFailure(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : fallback;
    if (message === "Session expired") { router.replace(LOGIN_EXPIRED_PATH); return; }
    setError(message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const payload = { name: form.name.trim(), url: form.url.trim(), intervalMins: Number(form.intervalMins), isActive: form.isActive };
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
          <div className="flex items-center gap-3"><Link href="/" className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 text-lg text-phosphor">⌁</Link><div><p className="text-xs font-medium text-muted">PulseCheck</p><h1 className="text-xl font-semibold tracking-tight text-slate-50">Monitor management</h1></div></div>
          <div className="flex items-center gap-4"><Link href="/" className="text-xs font-medium text-muted transition hover:text-slate-50">← Back to overview</Link><LogoutButton className="text-xs font-medium text-muted transition hover:text-slate-50" /></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7 md:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold tracking-tight text-slate-50">Monitors</h2><p className="mt-1 text-sm text-muted">Configure endpoints, review their latest checks, and control monitoring.</p></div><button type="button" onClick={startCreate} className="management-button management-button-primary">+ Add monitor</button></div>

        {displayError && <section role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{displayError}</section>}

        {formOpen && <section className="dashboard-panel mb-6 p-5"><div className="flex items-center justify-between gap-4"><div><h3 className="text-base font-semibold text-slate-50">{editingId ? "Edit monitor" : "Add monitor"}</h3><p className="mt-1 text-xs text-muted">{editingId ? "Update the endpoint or monitoring configuration." : "Add a URL to begin monitoring its availability."}</p></div><button type="button" onClick={resetForm} className="text-xs text-muted hover:text-slate-50">Close</button></div><form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2"><div><label htmlFor="name" className="management-label">Monitor name</label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="management-control w-full" placeholder="Production API" /></div><div><label htmlFor="url" className="management-label">URL</label><input id="url" type="url" required value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} className="management-control w-full" placeholder="https://api.example.com/health" /></div><div><label htmlFor="intervalMins" className="management-label">Check interval (minutes)</label><input id="intervalMins" type="number" min={1} required value={form.intervalMins} onChange={(event) => setForm({ ...form, intervalMins: event.target.value })} className="management-control w-full" /></div>{editingId && <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-200"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-600 bg-bg-strip text-green-500" /> Monitoring enabled</label>}<div className="flex gap-3 md:col-span-2"><button type="submit" disabled={saving} className="management-button management-button-primary">{saving ? "Saving…" : editingId ? "Save changes" : "Add monitor"}</button><button type="button" onClick={resetForm} className="management-button management-button-secondary">Cancel</button></div></form></section>}

        <section className="dashboard-panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-grid p-4 md:p-5"><div><h3 className="text-base font-semibold text-slate-50">All monitors <span className="ml-1 text-sm font-normal text-muted">{monitors.length}</span></h3><p className="mt-1 text-xs text-muted">Search, filter, and manage your monitored services.</p></div><div className="flex flex-wrap gap-2"><div className="relative"><input value={search} onChange={(event) => setSearch(event.target.value)} className="management-control w-56 pr-8" placeholder="Search monitors…" aria-label="Search monitors" /><span className="pointer-events-none absolute right-3 top-2.5 text-muted">⌕</span></div>{(["all", "up", "down", "paused"] as Filter[]).map((value) => <button key={value} type="button" className="dashboard-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
          {loading ? <div className="p-8"><p className="text-sm text-muted">Loading monitors…</p><div className="mt-4 space-y-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-bg-strip" />)}</div></div> : monitors.length === 0 ? <div className="p-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-green-500/10 text-xl text-phosphor">+</div><h3 className="mt-4 text-base font-semibold text-slate-50">No monitors yet</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted">Add your first endpoint to start tracking uptime and response time.</p><button type="button" onClick={startCreate} className="management-button management-button-primary mt-5">Add your first monitor</button></div> : filteredMonitors.length === 0 ? <div className="p-12 text-center"><h3 className="text-base font-semibold text-slate-50">No matching monitors</h3><p className="mt-2 text-sm text-muted">Try another search term or clear the active filter.</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="mt-4 text-xs font-medium text-phosphor hover:underline">Clear filters</button></div> : <div>{filteredMonitors.map((monitor) => <article key={monitor.id} className="management-table-row grid gap-4 p-4 md:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_7rem_9rem_auto] md:items-center md:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-semibold text-slate-50">{monitor.name}</h4><StatusBadge monitor={monitor} /></div><p className="mt-1 truncate text-xs text-muted">{monitor.url}</p></div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted">Response time</p><p className="mt-1 font-medium text-slate-200">{monitor.responseTimeMs == null ? "—" : `${monitor.responseTimeMs} ms`}</p></div><div><p className="text-muted">Last check</p><p className="mt-1 font-medium text-slate-200">{formatCheckedAt(monitor.checkedAt)}</p></div></div><div className="text-xs"><p className="text-muted">Interval</p><p className="mt-1 font-medium text-slate-200">Every {monitor.intervalMins} min</p></div><div className="text-xs"><p className="text-muted">Check state</p><p className="mt-1 font-medium text-slate-200">{monitor.checkedAt ? `${monitor.statusCode ?? "—"} · ${monitor.status.toUpperCase()}` : "Pending"}</p></div><div className="flex flex-wrap gap-2 md:justify-end"><button type="button" disabled={saving} onClick={() => handleToggle(monitor)} className="management-button management-button-secondary">{monitor.isActive ? "Disable" : "Enable"}</button><button type="button" onClick={() => startEdit(monitor)} className="management-button management-button-secondary">Edit</button><button type="button" disabled={saving} onClick={() => setPendingDelete(monitor)} className="management-button management-button-danger">Delete</button></div></article>)}</div>}
        </section>

        <section className="mt-6"><PublicSlugSettings /></section>
      </main>

      {pendingDelete && <div className="confirmation-backdrop fixed inset-0 z-50 flex items-center justify-center p-5" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="dashboard-panel w-full max-w-md p-6 shadow-2xl"><h2 id="delete-title" className="text-lg font-semibold text-slate-50">Delete monitor?</h2><p className="mt-2 text-sm leading-relaxed text-muted">This will permanently remove <span className="font-medium text-slate-200">{pendingDelete.name}</span> and its recorded checks. This action cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={() => setPendingDelete(null)} className="management-button management-button-secondary">Cancel</button><button type="button" disabled={saving} onClick={handleDelete} className="management-button management-button-danger">{saving ? "Deleting…" : "Delete monitor"}</button></div></section></div>}
    </div>
  );
}
