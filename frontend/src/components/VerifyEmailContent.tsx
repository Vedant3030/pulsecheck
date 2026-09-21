"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { verifyEmail } from "@/lib/api";

export function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Invalid verification link — missing token.");
      return;
    }
    verifyEmail(token)
      .then((res) => setSuccess(res.message))
      .catch((err) => setError(err instanceof Error ? err.message : "Verification failed"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="auth-feedback auth-feedback-info">Verifying your email…</p>;
  }
  if (success) {
    return (
      <div className="space-y-4">
        <p className="auth-feedback auth-feedback-info" role="status">{success}</p>
        <p className="auth-footer">
          <Link href="/login">Sign in to continue</Link> · <Link href="/">Go to dashboard</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>
      <p className="auth-footer">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
