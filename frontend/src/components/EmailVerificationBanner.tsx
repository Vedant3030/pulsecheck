"use client";

import { useEffect, useState } from "react";
import { fetchMe, resendVerification } from "@/lib/api";

const DISMISSED_KEY = "pulsecheck-verify-dismissed";

export function EmailVerificationBanner() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(DISMISSED_KEY)) return;
    fetchMe()
      .then((user) => {
        if (!user.emailVerified) setVisible(true);
      })
      .catch(() => {
        // Don't show banner on fetch failure
      });
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  async function handleResend() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await resendVerification();
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend email");
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <section role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex-1">
        <p className="font-medium text-amber-200">Please verify your email to secure your account.</p>
        <p className="mt-1 text-xs text-amber-200/80">Check your inbox for a verification link.</p>
        {message && <p className="mt-2 text-xs text-phosphor">{message}</p>}
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={handleResend} disabled={loading} className="management-button management-button-secondary text-xs">
          {loading ? "Sending…" : "Resend email"}
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-xs text-amber-200/70 transition hover:text-amber-100">
          Dismiss
        </button>
      </div>
    </section>
  );
}
