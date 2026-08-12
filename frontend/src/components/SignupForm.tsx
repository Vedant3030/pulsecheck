"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, signup } from "@/lib/api";
import { isAuthenticated, setAuth } from "@/lib/auth";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    setLoading(true);

    try {
      await signup(email, password);
      // Auto-login after successful registration
      const { token, email: userEmail } = await login(email, password);
      setAuth(token, userEmail);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-email" className="clinical-label">
            Operator ID
          </label>
          <input
            id="signup-email"
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
          <label htmlFor="signup-password" className="clinical-label">
            Access Key
          </label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="clinical-input"
            placeholder="••••••••"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signup-confirm" className="clinical-label">
            Confirm Access Key
          </label>
          <input
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
          {loading ? "Registering…" : "Create Account"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        Already registered?{" "}
        <Link
          href="/login"
          className="text-phosphor-dim underline-offset-2 hover:text-phosphor hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
