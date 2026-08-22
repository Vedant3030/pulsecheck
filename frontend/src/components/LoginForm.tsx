"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/lib/api";
import { isAuthenticated, setAuth } from "@/lib/auth";
import { PasswordField } from "@/components/ui/PasswordField";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setLoading(true);

    try {
      const { token, email: userEmail } = await login(email, password);
      setAuth(token, userEmail);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {sessionExpired && <p className="auth-feedback auth-feedback-info mb-4">Your session expired. Please sign in again.</p>}
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className=""
            placeholder="you@example.com"
          />
        </div>
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading} className="auth-submit">{loading ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="auth-footer">New to PulseCheck? <Link href="/signup">Create an account</Link></p>
    </>
  );
}
