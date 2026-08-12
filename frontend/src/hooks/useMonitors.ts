"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMonitors } from "@/lib/api";
import { LOGIN_EXPIRED_PATH } from "@/lib/auth";
import type { Monitor } from "@/types/monitor";

interface UseMonitorsOptions {
  /** Poll interval in ms. Set false to disable polling. Default: 10_000 */
  pollIntervalMs?: number | false;
  /** Refetch when the browser tab regains focus. Default: true */
  refetchOnFocus?: boolean;
}

interface UseMonitorsResult {
  monitors: Monitor[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => Promise<void>;
}

export function useMonitors(
  options: UseMonitorsOptions = {},
): UseMonitorsResult {
  const { pollIntervalMs = 10_000, refetchOnFocus = true } = options;
  const router = useRouter();

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialLoadDone = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const data = await fetchMonitors();
      setMonitors(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch monitors";

      if (message === "Session expired") {
        router.replace(LOGIN_EXPIRED_PATH);
        return;
      }

      setError(message);
    } finally {
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        setLoading(false);
      }
    }
  }, [router]);

  // Initial fetch + optional polling
  useEffect(() => {
    refetch();

    if (pollIntervalMs === false) return;

    const interval = setInterval(refetch, pollIntervalMs);
    return () => clearInterval(interval);
  }, [refetch, pollIntervalMs]);

  // Refetch when tab/window regains focus
  useEffect(() => {
    if (!refetchOnFocus) return;

    function handleFocus() {
      refetch();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetch, refetchOnFocus]);

  return { monitors, loading, error, lastUpdated, refetch };
}
