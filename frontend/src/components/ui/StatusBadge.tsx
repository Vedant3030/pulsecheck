type StatusTone = "up" | "down" | "pending" | "paused";

interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  const dotClass = tone === "up" ? "status-dot-up" : tone === "down" ? "status-dot-down" : "status-dot-pending";
  return <span className={`status-badge status-badge-${tone}`}><span className={`status-dot ${dotClass}`} />{children}</span>;
}
