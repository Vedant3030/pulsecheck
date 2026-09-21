import Link from "next/link";
import { AppBrand } from "@/components/ui/AppBrand";

export const metadata = {
  title: "Privacy — PulseCheck",
  description: "How PulseCheck handles your data.",
};

export default function PrivacyPage() {
  return (
    <main className="dashboard-shell min-h-screen px-5 py-10 md:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">← Back to PulseCheck</Link>
        <div className="mt-4 flex items-center gap-3">
          <AppBrand compact />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Privacy Policy</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Last updated: September 21, 2026</p>

        <section className="dashboard-panel mt-6 space-y-6 p-6 text-sm leading-relaxed text-[var(--text-soft)] md:p-8">
          <p>
            PulseCheck is a small, independent uptime monitoring service. This page explains in plain language what we collect, how we use it, and your choices. We keep it short on purpose.
          </p>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">What we store</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong className="text-[var(--text-main)]">Your email</strong> — to create your account, sign you in, and send alerts you asked for.</li>
              <li><strong className="text-[var(--text-main)]">URLs you choose to monitor</strong> — the name, URL, check interval, and monitoring preferences (SSL/domain toggles) you configure.</li>
              <li><strong className="text-[var(--text-main)]">Check results</strong> — status, response time, and optional assertion results from each check.</li>
              <li><strong className="text-[var(--text-main)]">Account settings</strong> — like your public status-page slug and whether your email is verified.</li>
            </ul>
            <p className="mt-2">We don&apos;t collect anything else. No analytics trackers, no ad pixels, no third-party cookies.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">How we use it</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>To check the URLs you add, on the schedule you set.</li>
              <li>To send you email alerts via <strong className="text-[var(--text-main)]">Resend</strong> when a monitor goes down, recovers, or an SSL/domain is about to expire.</li>
              <li>To send account emails — verification and password-reset links.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Who we share it with</h2>
            <p className="mt-2"><strong className="text-[var(--text-main)]">We don&apos;t sell your data. Ever.</strong> The only external service that receives data is Resend, which we use to deliver the emails you asked for. Resend sees your email and the alert content — nothing more. We don&apos;t share your monitored URLs with anyone.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Retention & deletion</h2>
            <p className="mt-2">Your monitors and check history are kept until you delete them. If you want your account deleted, email us at <a href="mailto:privacy@bhosalevedant.dev" className="text-phosphor underline-offset-4 hover:underline">privacy@bhosalevedant.dev</a> from the email on file and we&apos;ll remove your account and all associated data.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Security</h2>
            <p className="mt-2">Passwords are hashed with bcrypt and never stored in plain text. Password-reset and email-verification tokens are stored as hashes and expire automatically. We use HTTPS everywhere and hash tokens with SHA-256 before storing them.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Changes</h2>
            <p className="mt-2">If we change this policy in a meaningful way, we&apos;ll update the date above. For questions, reach us at <a href="mailto:privacy@bhosalevedant.dev" className="text-phosphor underline-offset-4 hover:underline">privacy@bhosalevedant.dev</a>.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
