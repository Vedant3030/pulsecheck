import Link from "next/link";

/** Shown when fetch succeeded but the operator has zero monitors. */
export function MonitorBayEmpty() {
  return (
    <section
      aria-label="No monitors"
      className="panel-border flex min-h-[320px] flex-col items-center justify-center bg-bg-strip p-8"
    >
      <p className="text-sm tracking-widest text-amber uppercase">
        No channels connected
      </p>
      <p className="mt-2 max-w-sm text-center text-xs leading-relaxed text-muted">
        No monitors registered for this operator.
        <br />
        Add a URL to begin pulse tracking.
      </p>

      {/* Static flatline — empty bay, no alarm blink */}
      <svg
        className="mt-8 w-full max-w-md opacity-30"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="20"
          x2="400"
          y2="20"
          stroke="var(--color-muted)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
      </svg>

      <Link
        href="/manage"
        className="clinical-button mt-6 px-4 py-2 text-[10px]"
      >
        Add monitor
      </Link>
    </section>
  );
}
