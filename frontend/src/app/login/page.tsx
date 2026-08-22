import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
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
    <AuthLayout title="Welcome back" description="Sign in to view the health of your monitored services."><Suspense fallback={<LoginFormFallback />}><LoginForm /></Suspense></AuthLayout>
  );
}
