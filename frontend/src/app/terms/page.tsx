import Link from "next/link";
import { AppBrand } from "@/components/ui/AppBrand";

export const metadata = {
  title: "Terms — PulseCheck",
  description: "Terms of service for PulseCheck.",
};

export default function TermsPage() {
  return (
    <main className="dashboard-shell min-h-screen px-5 py-10 md:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]">← Back to PulseCheck</Link>
        <div className="mt-4 flex items-center gap-3">
          <AppBrand compact />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Terms of Service</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Last updated: September 21, 2026 · Beta</p>

        <section className="dashboard-panel mt-6 space-y-6 p-6 text-sm leading-relaxed text-[var(--text-soft)] md:p-8">
          <p>
            PulseCheck is currently in <strong className="text-[var(--text-main)]">beta</strong>. Core features are live and working, but things may change as we improve the service. By using PulseCheck, you agree to these simple, fair terms.
          </p>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">What PulseCheck does</h2>
            <p className="mt-2">You give us URLs to watch. We check them on your schedule, record the results, and email you when something changes or goes down. We also offer heartbeat, SSL/domain expiry, and content-assertion features. Public status pages are visible to anyone with the link.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Your responsibilities</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Only monitor URLs you have permission to check. Don&apos;t use PulseCheck to probe or overload sites you don&apos;t own.</li>
              <li>Keep your account credentials safe.</li>
              <li>Don&apos;t abuse the service (scraping via monitors, bypassing rate limits, etc.).</li>
              <li>Check intervals must be at least 1 minute — we enforce this to be fair to the sites you monitor.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Our responsibilities</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>We&apos;ll do our best to keep PulseCheck running and your data safe.</li>
              <li>Alerts are sent on a best-effort basis via email. We can&apos;t guarantee instant delivery — email is inherently imperfect.</li>
              <li>We may rate-limit authentication endpoints (5 attempts per 15 minutes) to protect accounts.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Data & privacy</h2>
            <p className="mt-2">We store your email and the URLs you choose to monitor. We send emails via Resend and don&apos;t sell your data. See our <Link href="/privacy" className="text-phosphor underline-offset-4 hover:underline">Privacy Policy</Link> for details. You can request account deletion at <a href="mailto:privacy@bhosalevedant.dev" className="text-phosphor underline-offset-4 hover:underline">privacy@bhosalevedant.dev</a>.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Beta & changes</h2>
            <p className="mt-2">Because we&apos;re in beta, features, limits, and these terms may evolve. We&apos;ll keep changes reasonable and update the date above when they happen. If a change is significant, we&apos;ll try to let you know by email.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Disclaimer</h2>
            <p className="mt-2">PulseCheck is provided as-is. We work hard to keep checks accurate and timely, but we don&apos;t guarantee 100% uptime of the service itself or that an alert will always arrive the second a site changes. Don&apos;t rely on PulseCheck as your sole safety net for critical systems without additional redundancy.</p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[var(--text-main)]">Contact</h2>
            <p className="mt-2">Questions? Reach us at <a href="mailto:privacy@bhosalevedant.dev" className="text-phosphor underline-offset-4 hover:underline">privacy@bhosalevedant.dev</a>.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
