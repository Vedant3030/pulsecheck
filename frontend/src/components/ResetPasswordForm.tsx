"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { resetPassword } from "@/lib/api";
import { PasswordField } from "@/components/ui/PasswordField";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Invalid reset link — missing token. Please request a new link.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(token, newPassword);
      setSuccess(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reset password";
      // Map common backend errors to helpful UI
      if (msg.toLowerCase().includes("expired")) {
        setError("This reset link has expired. Please request a new one.");
      } else if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("used")) {
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <p className="auth-feedback auth-feedback-error" role="alert">
          Invalid reset link — no token found. Please request a new password reset email.
        </p>
        <p className="auth-footer">
          <Link href="/forgot-password">Request a new link</Link> · <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4">
        <p className="auth-feedback auth-feedback-info" role="status">{success}</p>
        <p className="auth-footer">
          <Link href="/login">Sign in with your new password</Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="auth-form">
        <PasswordField id="new-password" label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={8} hint="At least 8 characters." />
        <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
        {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading} className="auth-submit">
          {loading ? "Resetting…" : "Reset password"}
        </button>
      </form>
      <p className="auth-footer">
        Remember your password? <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
