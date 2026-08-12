"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPublicStatus } from "@/lib/api";
import type { PublicMonitor } from "@/types/status";

interface UsePublicStatusOptions {
  pollIntervalMs?: number | false;
  refetchOnFocus?: boolean;
}

interface UsePublicStatusResult {
  slug: string | null;
  monitors: PublicMonitor[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => Promise<void>;
}

export function usePublicStatus(
  slug: string,
  options: UsePublicStatusOptions = {},
): UsePublicStatusResult {
  const { pollIntervalMs = 10_000, refetchOnFocus = true } = options;

  const [pageSlug, setPageSlug] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<PublicMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialLoadDone = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const data = await fetchPublicStatus(slug);
      setPageSlug(data.slug);
      setMonitors(data.monitors);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load status page",
      );
    } finally {
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        setLoading(false);
      }
    }
  }, [slug]);

  useEffect(() => {
    initialLoadDone.current = false;
    setLoading(true);
    refetch();

    if (pollIntervalMs === false) return;

    const interval = setInterval(refetch, pollIntervalMs);
    return () => clearInterval(interval);
  }, [refetch, pollIntervalMs]);

  useEffect(() => {
    if (!refetchOnFocus) return;

    function handleFocus() {
      refetch();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetch, refetchOnFocus]);

  return { slug: pageSlug, monitors, loading, error, lastUpdated, refetch };
}
