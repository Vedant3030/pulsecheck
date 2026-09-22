"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, signup } from "@/lib/api";
import { isAuthenticated, setAuth } from "@/lib/auth";
import { PasswordField } from "@/components/ui/PasswordField";
import { TurnstileWidget } from "@/components/TurnstileWidget";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/");
    }
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Access keys do not match");
      return;
    }

    if (password.length < 8) {
      setError("Access key must be at least 8 characters");
      return;
    }

    if (!turnstileToken) {
      setError("Please complete the human verification check.");
      return;
    }

    setLoading(true);

    try {
      await signup(email, password, turnstileToken);
      // Auto-login after successful registration
      const { token, email: userEmail } = await login(email, password);
      setAuth(token, userEmail);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      // Token is single-use — reset widget so user gets a fresh challenge
      setTurnstileToken(null);
      setResetSignal((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <label htmlFor="signup-email">Email address</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className=""
            placeholder="you@example.com"
          />
        </div>
        <PasswordField id="signup-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} hint="Use at least 8 characters." />
        <PasswordField id="signup-confirm" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={8} />
        <TurnstileWidget
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          onError={() => setTurnstileToken(null)}
          resetSignal={resetSignal}
        />
        {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading} className="auth-submit">{loading ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="auth-footer">Already have an account? <Link href="/login">Sign in</Link></p>
    </>
  );
}
