"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Client-side route guard. Checks localStorage for a JWT and
 * redirects to /login if none is found. Shows a brief loading
 * state while the check runs (localStorage only exists in browser).
 */
export function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-xs tracking-widest text-phosphor-dim uppercase">
          Verifying session…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
