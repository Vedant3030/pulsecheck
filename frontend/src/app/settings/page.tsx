import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { DeleteAccount } from "@/components/DeleteAccount";
import { LogoutButton } from "@/components/LogoutButton";
import { AppBrand } from "@/components/ui/AppBrand";

export default function SettingsPage() {
  return (
    <AuthGate>
      <div className="dashboard-shell min-h-screen">
        <header className="border-b border-grid bg-bg/95 px-5 py-4 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AppBrand compact />
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)]">PulseCheck</p>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--text-main)]">Account settings</h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/" className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]">← Back to overview</Link>
              <LogoutButton className="text-xs font-medium text-[var(--text-muted)] transition hover:text-[var(--text-main)]" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-5 py-7 md:px-8">
          <DeleteAccount />
        </main>
      </div>
    </AuthGate>
  );
}
