"use client";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton-pulse ${className}`} aria-hidden="true" />;
}

export function MonitorBaySkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Syncing vitals">
      {/* Clinical header — matches MonitorBayLoading spin-up */}
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="h-2 w-2 rounded-full bg-phosphor animate-pulse" />
        <span className="text-xs font-semibold tracking-[0.18em] text-phosphor uppercase">
          SYNCING VITALS...
        </span>
        <span className="text-xs text-muted">Connecting to monitors</span>
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-green-500/20 bg-black/50 p-4 backdrop-blur-sm"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
