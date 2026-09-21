/** Shown while the first GET /monitors request is in flight — clinical spin-up sequence. */
export function MonitorBayLoading() {
  return (
    <section
      aria-live="polite"
      aria-busy="true"
      aria-label="Syncing vitals"
      className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-green-500/20 bg-black/50 p-8 backdrop-blur-sm"
    >
      {/* Pulsing green border glow */}
      <div className="relative flex flex-col items-center">
        <p className="text-sm font-semibold tracking-[0.2em] text-phosphor uppercase animate-pulse">
          SYNCING VITALS<span className="inline-flex w-[1.2em] justify-start"><span className="animate-[dotPulse_1.2s_ease-in-out_infinite]">.</span><span className="animate-[dotPulse_1.2s_ease-in-out_0.2s_infinite]">.</span><span className="animate-[dotPulse_1.2s_ease-in-out_0.4s_infinite]">.</span></span>
        </p>
        <p className="mt-2 text-xs tracking-widest text-muted uppercase">
          Connecting to monitors
        </p>

        {/* Scanning waveform — thin green trace with traveling dot */}
        <svg
          className="mt-8 w-full max-w-md opacity-60"
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
            strokeDasharray="4 6"
            opacity="0.5"
          />
          {/* traveling pulse */}
          <circle r="2.5" fill="var(--color-phosphor)">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M 0 20 H 400" />
          </circle>
        </svg>

        {/* Subtle vital readout placeholders */}
        <div className="mt-6 flex gap-2">
          <span className="h-1 w-8 rounded-full bg-phosphor/20 animate-[barPulse_1.2s_ease-in-out_infinite]" />
          <span className="h-1 w-12 rounded-full bg-phosphor/20 animate-[barPulse_1.2s_ease-in-out_0.15s_infinite]" />
          <span className="h-1 w-6 rounded-full bg-phosphor/20 animate-[barPulse_1.2s_ease-in-out_0.3s_infinite]" />
        </div>
      </div>

      <style>{`
        @keyframes dotPulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
        @keyframes barPulse { 0%, 100% { opacity: 0.3; transform: scaleX(0.8); } 50% { opacity: 0.7; transform: scaleX(1); } }
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse, [style*="dotPulse"], [style*="barPulse"] { animation: none !important; opacity: 0.7; }
        }
      `}</style>
    </section>
  );
}
