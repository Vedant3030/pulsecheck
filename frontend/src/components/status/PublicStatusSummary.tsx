interface PublicStatusSummaryProps {
  total: number;
  down: number;
  lastUpdated: Date | null;
}

export function PublicStatusSummary({ total, down, lastUpdated }: PublicStatusSummaryProps) {
  const healthy = down === 0;
  return <section className={`public-status-summary ${healthy ? "" : "public-status-summary-alert"}`} aria-label="Overall system status"><p className="public-eyebrow">Overall system status</p><div className="mt-3 flex items-center gap-3"><span className={`status-dot ${healthy ? "status-dot-up" : "status-dot-down"}`} /><h1>{healthy ? "All Systems Operational" : `${down} Service${down === 1 ? "" : "s"} Experiencing Issues`}</h1></div><p className="mt-3 text-sm text-muted">{healthy ? `All ${total} monitored service${total === 1 ? " is" : "s are"} responding normally.` : "Our team is aware of the affected services and is monitoring recovery."}</p>{lastUpdated && <p className="mt-5 text-xs text-muted">Last updated {lastUpdated.toLocaleTimeString("en-US", { hour12: false })}</p>}</section>;
}
