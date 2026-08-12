/** Shown while the first GET /monitors request is in flight. */
export function MonitorBayLoading() {
  return (
    <section
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading monitors"
      className="panel-border flex min-h-[320px] flex-col items-center justify-center bg-bg-strip p-8"
    >
      <p className="text-sm tracking-widest text-phosphor-dim uppercase">
        Initializing channel feed
      </p>
      <p className="mt-2 text-xs text-muted">Scanning monitor registry…</p>

      {/* Static flatline — idle monitor, no animation */}
      <svg
        className="mt-8 w-full max-w-md opacity-40"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="20"
          x2="400"
          y2="20"
          stroke="var(--color-phosphor-dim)"
          strokeWidth="1"
        />
      </svg>
    </section>
  );
}
