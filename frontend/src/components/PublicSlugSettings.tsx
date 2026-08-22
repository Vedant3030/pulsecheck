"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe, updatePublicSlug } from "@/lib/api";
import { LOGIN_EXPIRED_PATH } from "@/lib/auth";
import { normalizePublicSlugInput } from "@/lib/public-slug";

export function PublicSlugSettings() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMe()
      .then((user) => {
        setSavedSlug(user.publicSlug);
        setSlug(user.publicSlug ?? "");
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Failed to load profile";
        if (message === "Session expired") {
          router.replace(LOGIN_EXPIRED_PATH);
          return;
        }
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [router]);

  const publicUrl =
    typeof window !== "undefined" && savedSlug
      ? `${window.location.origin}/status/${savedSlug}`
      : null;

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const cleaned = normalizePublicSlugInput(slug);
      const user = await updatePublicSlug(cleaned || null);
      setSavedSlug(user.publicSlug);
      setSlug(user.publicSlug ?? "");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save slug";
      if (message === "Session expired") {
        router.replace(LOGIN_EXPIRED_PATH);
        return;
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    setSaving(true);
    setError(null);
    try {
      const user = await updatePublicSlug(null);
      setSavedSlug(user.publicSlug);
      setSlug("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable page");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <section className="manage-panel mb-10 p-6">
        <p className="text-sm text-muted">Loading public page settings…</p>
      </section>
    );
  }

  return (
    <section className="manage-panel mb-10 p-6">
      <div className="mb-4 flex items-center justify-between border-b border-grid pb-3">
      <h2 className="text-xs tracking-widest text-phosphor uppercase">
        Public signal
      </h2>
      <span className="text-[10px] tracking-wider text-muted uppercase">Visitor feed</span>
      </div>
      <p className="mb-4 text-xs text-muted">
        Share a read-only ICU monitor wall. Only active monitors are shown; URLs
        are hidden from visitors.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="publicSlug" className="manage-label">
            Page slug
          </label>
          <div className="flex">
            <span className="flex items-center border border-r-0 border-phosphor-dim bg-bg-strip px-3 text-sm text-muted">
              /status/
            </span>
            <input
              id="publicSlug"
              value={slug}
              onChange={(e) =>
                setSlug(normalizePublicSlugInput(e.target.value))
              }
              className="manage-input min-w-0 flex-1 rounded-l-none"
              placeholder="my-team"
              pattern="[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?"
              title="3–32 chars: lowercase letters, numbers, hyphens"
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Example: <code className="text-phosphor-dim">acme-ops</code>
          </p>
        </div>

        {error && (
          <p className="text-sm text-alarm" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="manage-button">
            {saving ? "Saving…" : "Save slug"}
          </button>
          {savedSlug && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="manage-button-secondary"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={handleDisable}
                disabled={saving}
                className="manage-button-danger"
              >
                Disable page
              </button>
            </>
          )}
        </div>
      </form>

      {publicUrl && (
        <p className="mt-4 text-xs text-muted">
          Live at{" "}
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-phosphor underline-offset-2 hover:underline"
          >
            {publicUrl}
          </a>
        </p>
      )}
    </section>
  );
}
