import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

function Fallback() {
  return <p className="text-center text-xs tracking-widest text-phosphor-dim uppercase">Loading…</p>;
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Set a new password" description="Choose a strong password to secure your account.">
      <Suspense fallback={<Fallback />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
