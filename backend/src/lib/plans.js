/**
 * Free vs Pro plan limits. Server-side source of truth — the frontend gates
 * UI for convenience, but every limit below is enforced in main.js routes.
 * Unknown/missing plans fall back to free (secure default).
 */

export const PLAN_LIMITS = {
  free: {
    maxMonitors: 5,
    minIntervalMins: 30,
    allowChain: false,
    maxAssertionsPerMonitor: 2,
  },
  pro: {
    maxMonitors: 50,
    minIntervalMins: 1,
    allowChain: true,
    maxAssertionsPerMonitor: 50,
  },
};

export function planLimits(plan) {
  const key = typeof plan === "string" ? plan.toLowerCase() : "free";
  return PLAN_LIMITS[key] || PLAN_LIMITS.free;
}

export function upgradeMessage(feature) {
  return `${feature} is a Pro feature. Upgrade to unlock it.`;
}
