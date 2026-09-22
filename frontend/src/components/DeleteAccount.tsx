"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount } from "@/lib/api";
import { clearAuth, LOGIN_EXPIRED_PATH } from "@/lib/auth";

export function DeleteAccount() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openModal() {
    setError(null);
    setPassword("");
    setConfirmText("");
    setModalOpen(true);
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (confirmText.trim().toUpperCase() !== "DELETE") {
      setError('Type DELETE in the box to confirm.');
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setDeleting(true);
    try {
      await deleteAccount(password);
      clearAuth();
      router.replace("/login?deleted=1");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete account";
      if (message === "Session expired") {
        router.replace(LOGIN_EXPIRED_PATH);
        return;
      }
      setError(message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="dashboard-panel p-4 md:p-5">
      <h2 className="text-base font-semibold text-[var(--text-main)]">Danger zone</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Permanently delete your account, monitors, check history, and settings. This cannot be undone.
      </p>
      <button
        type="button"
        onClick={openModal}
        className="management-button management-button-danger mt-4"
      >
        Delete account…
      </button>

      {modalOpen && (
        <div className="confirmation-backdrop fixed inset-0 z-50 flex items-center justify-center p-5" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="dashboard-panel w-full max-w-md p-6 shadow-2xl">
            <h2 id="delete-account-title" className="text-lg font-semibold text-[var(--text-main)]">
              Delete your account?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              This permanently removes your account, all monitors, check history,
              heartbeat monitors, and status page settings. This action cannot be undone.
            </p>
            <form onSubmit={handleDelete} className="mt-5 space-y-4">
              <div>
                <label htmlFor="delete-confirm-text" className="management-label">
                  Type DELETE to confirm
                </label>
                <input
                  id="delete-confirm-text"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  className="management-control w-full font-mono"
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="delete-confirm-password" className="management-label">
                  Your password
                </label>
                <input
                  id="delete-confirm-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="management-control w-full"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setModalOpen(false)}
                  className="management-button management-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleting}
                  className="management-button management-button-danger"
                >
                  {deleting ? "Deleting…" : "Delete my account"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
