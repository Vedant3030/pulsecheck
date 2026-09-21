import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

function Fallback() {
  return <p className="text-center text-xs tracking-widest text-phosphor-dim uppercase">Loading…</p>;
}

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" description="Enter your email and we'll send you a reset link.">
      <Suspense fallback={<Fallback />}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
