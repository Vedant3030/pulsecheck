import { SignupForm } from "@/components/SignupForm";
import { AuthLayout } from "@/components/layout/AuthLayout";

export default function SignupPage() {
  return (
    <AuthLayout title="Start monitoring" description="Create your PulseCheck account and add your first service in minutes."><SignupForm /></AuthLayout>
  );
}
