import type { Monitor } from "@/types/monitor";
import {
  formatMonitorTime,
  getDisplayStatus,
} from "@/lib/monitor-status";

interface MonitorStatusBadgeProps {
  monitor: Monitor;
}

export function MonitorStatusBadge({ monitor }: MonitorStatusBadgeProps) {
  const display = getDisplayStatus(monitor);

  const config = {
    up: {
      dot: "bg-emerald-400",
      label: "UP",
      text: "text-emerald-400",
    },
    down: {
      dot: "bg-red-400",
      label: "DOWN",
      text: "text-red-400",
    },
    init: {
      dot: "bg-amber-400",
      label: "INIT",
      text: "text-amber-400",
    },
  }[display];

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${config.dot}`} />
        <span className={`text-xs font-medium tracking-wider ${config.text}`}>
          {config.label}
        </span>
      </div>
      <p className="text-[11px] text-neutral-500">
        {monitor.responseTimeMs != null
          ? `${monitor.responseTimeMs} ms`
          : "--- ms"}
        {" · "}
        {formatMonitorTime(monitor.checkedAt)}
      </p>
    </div>
  );
}
