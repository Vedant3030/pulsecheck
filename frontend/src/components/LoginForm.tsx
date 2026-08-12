"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/lib/api";
import { isAuthenticated, setAuth } from "@/lib/auth";

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
      {sessionExpired && (
        <p className="mb-4 text-xs tracking-wider text-amber">
          Session expired — please sign in again.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="clinical-label">
            Operator ID
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="clinical-input"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="clinical-label">
            Access Key
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="clinical-input"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="alarm-blink text-xs tracking-wider text-alarm text-alarm-glow">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="clinical-button">
          {loading ? "Authenticating…" : "Sign In"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        No account?{" "}
        <Link
          href="/signup"
          className="text-phosphor-dim underline-offset-2 hover:text-phosphor hover:underline"
        >
          Register operator
        </Link>
      </p>
    </>
  );
}
