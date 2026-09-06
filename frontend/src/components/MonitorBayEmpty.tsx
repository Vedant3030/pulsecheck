"use client";

import Link from "next/link";

/** Shown when fetch succeeded but the operator has zero monitors. */
export function MonitorBayEmpty() {
  return (
    <section
      aria-label="No monitors"
      className="panel-border flex min-h-[320px] flex-col items-center justify-center bg-bg-strip p-8"
    >
      <div className="mb-6 flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-bg-strip flex items-center justify-center">
          <svg
            className="h-7 w-7 text-phosphor-dim"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <line x1="9" y1="12" x2="9.01" y2="12" />
            <line x1="15" y1="12" x2="15.01" y2="12" />
          </svg>
        </div>
        <p className="text-sm tracking-widest text-amber uppercase">
          No monitors connected
        </p>
        <p className="text-xs text-muted">
          No monitors registered for this operator.
        </p>
      </div>

      <p className="text-center text-sm text-muted max-w-md">
        Add a URL to begin pulse tracking and see real-time status on your dashboard.
      </p>

      <Link
        href="/manage"
        className="clinical-button mt-6 flex items-center gap-2 px-4 py-2 text-[10px] font-medium"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 4l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <line x1="9" y1="12" x2="9.01" y2="12" />
          <line x1="15" y1="12" x2="15.01" y2="12" />
        </svg>
        Add monitor
      </Link>
    </section>
  );
}