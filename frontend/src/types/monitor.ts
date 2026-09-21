/** Matches the shape we'll get from GET /monitors once the backend is wired. */
export type MonitorStatus = "up" | "down";

export type ExpiryAlertStage = "NONE" | "WARNED_30D" | "WARNED_14D" | "WARNED_7D" | "EXPIRED" | "UNSUPPORTED";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMins: number;
  isActive: boolean;
  createdAt: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string | null;
  sslMonitoringEnabled: boolean;
  certExpiresAt: string | null;
  lastSslCheckAt: string | null;
  sslAlertStage: ExpiryAlertStage;
  domainMonitoringEnabled: boolean;
  domainExpiresAt: string | null;
  lastDomainCheckAt: string | null;
  domainAlertStage: ExpiryAlertStage;
}

/** One ping result — from GET /monitors/:id/checks */
export interface CheckResult {
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string;
  /** Per-assertion verdicts — present on the authed checks endpoint, absent on public. */
  assertionResults?: AssertionResult[] | null;
}

export type AssertionType =
  | "STATUS_CODE"
  | "RESPONSE_TIME"
  | "BODY_CONTAINS"
  | "JSON_FIELD_EQUALS";

export type AssertionOperator =
  | "EQUALS"
  | "CONTAINS"
  | "LESS_THAN"
  | "GREATER_THAN";

/** Stored rule — from GET /monitors/:id/assertions */
export interface MonitorAssertion {
  id: string;
  monitorId: string;
  type: AssertionType;
  field: string | null;
  operator: AssertionOperator;
  expectedValue: string;
  createdAt: string;
}

/** Single verdict stored on a CheckResult */
export interface AssertionResult {
  type: string;
  field: string | null;
  operator: string;
  expectedValue: string;
  actual: string;
  pass: boolean;
  message: string;
}

export interface WaveformStripProps {
  monitorId: string;
  name: string;
  status: MonitorStatus;
  responseTimeMs: number | null;
  statusCode?: number | null;
  checkedAt: Date | string | null;
  /** When set, fetches check history via the public status API. */
  publicSlug?: string;
  /** Presentation only; monitor data and requests remain identical. */
  variant?: "clinical" | "dashboard";
  // Expiry monitoring (compact dashboard row)
  sslMonitoringEnabled?: boolean;
  certExpiresAt?: string | null;
  sslAlertStage?: ExpiryAlertStage;
  domainMonitoringEnabled?: boolean;
  domainExpiresAt?: string | null;
  domainAlertStage?: ExpiryAlertStage;
  onToggleSsl?: (next: boolean) => void;
  onToggleDomain?: (next: boolean) => void;
  isToggling?: boolean;
}
