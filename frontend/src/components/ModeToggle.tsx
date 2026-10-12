"use client";

import { useMode } from "@/hooks/useMode";

/** Simple (normal users) vs Dev (technical users) mode switch. Dark-only app. */
export function ModeToggle() {
  const { mode, setMode, mounted } = useMode();

  return (
    <div
      className="flex items-center rounded-md border border-grid p-0.5 text-xs"
      role="group"
      aria-label="Interface mode"
      suppressHydrationWarning
    >
      {(["simple", "dev"] as const).map((value) => {
        const active = mounted ? mode === value : value === "simple";
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={active}
            title={value === "simple" ? "Simple mode for everyday monitoring" : "Dev mode with full request and chain controls"}
            className={`rounded px-2.5 py-1 font-medium transition-colors ${
              active ? "bg-bg-strip text-phosphor" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {value === "simple" ? "Simple" : "Dev"}
          </button>
        );
      })}
    </div>
  );
}
