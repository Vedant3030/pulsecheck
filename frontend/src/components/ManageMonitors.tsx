"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createMonitor, deleteMonitor, updateMonitor } from "@/lib/api";
import { LOGIN_EXPIRED_PATH } from "@/lib/auth";
import { useMonitors } from "@/hooks/useMonitors";
import type { Monitor } from "@/types/monitor";
import { LogoutButton } from "@/components/LogoutButton";
import { MonitorStatusBadge } from "@/components/MonitorStatusBadge";
import { PublicSlugSettings } from "@/components/PublicSlugSettings";

const EMPTY_FORM = {
  name: "",
  url: "",
  intervalMins: "5",
  isActive: true,
};

export function ManageMonitors() {
  const router = useRouter();
  const { monitors, loading, error: loadError, refetch } = useMonitors({
    pollIntervalMs: false,
    refetchOnFocus: true,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const displayError = error ?? loadError;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(monitor: Monitor) {
    setEditingId(monitor.id);
    setForm({
      name: monitor.name,
      url: monitor.url,
      intervalMins: String(monitor.intervalMins),
      isActive: monitor.isActive,
    });
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      intervalMins: Number(form.intervalMins),
      isActive: form.isActive,
    };

    try {
      if (editingId) {
        await updateMonitor(editingId, payload);
      } else {
        await createMonitor(payload);
      }
      resetForm();
      await refetch();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save monitor";
      if (message === "Session expired") {
        router.replace(LOGIN_EXPIRED_PATH);
        return;
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(monitor: Monitor) {
    const confirmed = window.confirm(
      `Delete monitor "${monitor.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      await deleteMonitor(monitor.id);
      if (editingId === monitor.id) resetForm();
      await refetch();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete monitor";
      if (message === "Session expired") {
        router.replace(LOGIN_EXPIRED_PATH);
        return;
      }
      setError(message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">
            Manage Monitors
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Add, edit, or remove URLs to watch.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
          >
            ← Back to monitor wall
          </Link>
          <LogoutButton className="text-sm text-neutral-400 hover:text-neutral-200" />
        </div>
      </div>

      <PublicSlugSettings />

      <section className="mb-10 rounded-lg border border-neutral-800 bg-neutral-900/50 p-6">
        <h2 className="mb-4 text-sm font-medium text-neutral-300">
          {editingId ? "Edit monitor" : "Add monitor"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="manage-label">
                Name
              </label>
              <input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="manage-input"
                placeholder="Production API"
              />
            </div>
            <div>
              <label htmlFor="url" className="manage-label">
                URL
              </label>
              <input
                id="url"
                type="url"
                required
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="manage-input"
                placeholder="https://example.com"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="intervalMins" className="manage-label">
                Check interval (minutes)
              </label>
              <input
                id="intervalMins"
                type="number"
                min={1}
                required
                value={form.intervalMins}
                onChange={(e) =>
                  setForm({ ...form, intervalMins: e.target.value })
                }
                className="manage-input"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Stored now; worker still checks every 60s until per-monitor
                intervals are implemented.
              </p>
            </div>

            {editingId && (
              <div className="flex items-end pb-6">
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) =>
                      setForm({ ...form, isActive: e.target.checked })
                    }
                    className="rounded border-neutral-600 bg-neutral-800"
                  />
                  Active (included in checks)
                </label>
              </div>
            )}
          </div>

          {displayError && (
            <p className="text-sm text-red-400" role="alert">
              {displayError}
            </p>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="manage-button">
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Add monitor"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="manage-button-secondary"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium text-neutral-300">
          Your monitors
        </h2>

        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : monitors.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No monitors yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {monitors.map((monitor) => (
              <li
                key={monitor.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-100">{monitor.name}</p>
                  <p className="truncate text-sm text-neutral-400">
                    {monitor.url}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Every {monitor.intervalMins} min ·{" "}
                    {monitor.isActive ? "Active" : "Paused"}
                  </p>
                </div>

                <MonitorStatusBadge monitor={monitor} />

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(monitor)}
                    className="manage-button-secondary text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(monitor)}
                    className="manage-button-danger text-xs"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
