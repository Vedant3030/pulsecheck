import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

function LoginFormFallback() {
  return (
    <p className="text-center text-xs tracking-widest text-phosphor-dim uppercase">
      Loading terminal…
    </p>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="panel-border w-full max-w-md bg-bg-panel p-8">
        <header className="mb-8 text-center">
          <h1 className="text-phosphor-glow text-2xl font-bold tracking-[0.2em] text-phosphor uppercase">
            PulseCheck
          </h1>
          <p className="mt-2 text-xs tracking-widest text-phosphor-dim uppercase">
            Operator Access · Secure Terminal
          </p>
        </header>

        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-[10px] tracking-widest text-muted uppercase">
          JWT stored in localStorage · v1 simplification
        </p>
      </div>
    </div>
  );
}
