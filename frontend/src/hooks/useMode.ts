"use client";

import { useCallback, useEffect, useState } from "react";

export type UiMode = "simple" | "dev";

const STORAGE_KEY = "pulsecheck-mode";

function getInitialMode(): UiMode {
  if (typeof window === "undefined") return "simple";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dev" ? "dev" : "simple";
}

/** Simple (free-tier, non-technical) vs Dev (full request/chain UI) mode. Persisted locally. */
export function useMode() {
  const [mode, setModeState] = useState<UiMode>(getInitialMode);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setModeState(getInitialMode());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }, [mode, mounted]);

  const setMode = useCallback((next: UiMode) => setModeState(next), []);

  return { mode, setMode, isSimple: mode === "simple", mounted };
}
