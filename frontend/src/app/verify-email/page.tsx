import { Suspense } from "react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { VerifyEmailContent } from "@/components/VerifyEmailContent";

function Fallback() {
  return <p className="text-center text-xs tracking-widest text-phosphor-dim uppercase">Verifying…</p>;
}

export default function VerifyEmailPage() {
  return (
    <AuthLayout title="Verify your email" description="Confirming your email address.">
      <Suspense fallback={<Fallback />}>
        <VerifyEmailContent />
      </Suspense>
    </AuthLayout>
  );
}
