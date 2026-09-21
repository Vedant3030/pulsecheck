/**
 * Shared expiry stage helper — used for both SSL cert and domain expiry.
 * Rank ordering: NONE < WARNED_30D < WARNED_14D < WARNED_7D < EXPIRED
 * UNSUPPORTED is a terminal distinct state for TLDs with no WHOIS (not an alert rank).
 */

const RANK = {
  NONE: 0,
  WARNED_30D: 1,
  WARNED_14D: 2,
  WARNED_7D: 3,
  EXPIRED: 4,
  UNSUPPORTED: 5,
};

export function getExpiryStage(expiryDate) {
  if (!expiryDate) return "NONE";
  const now = Date.now();
  const msRemaining = new Date(expiryDate).getTime() - now;
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
  if (daysRemaining < 0) return "EXPIRED";
  if (daysRemaining < 7) return "WARNED_7D";
  if (daysRemaining < 14) return "WARNED_14D";
  if (daysRemaining < 30) return "WARNED_30D";
  return "NONE";
}

export function getStageRank(stage) {
  return RANK[stage] ?? 0;
}

export function shouldAlert(prevStage, nextStage) {
  if (nextStage === "UNSUPPORTED") return false;
  return getStageRank(nextStage) > getStageRank(prevStage);
}

export function shouldReset(prevStage, nextStage) {
  // Renewal: was warned/expired, now back to NONE or less severe
  // Silently reset — no alert, just stage drop
  return getStageRank(nextStage) < getStageRank(prevStage) && nextStage === "NONE";
}
