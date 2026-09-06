"use client";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton-pulse ${className}`} aria-hidden="true" />;
}

export function MonitorBaySkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading monitors">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="dashboard-panel p-4">
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
