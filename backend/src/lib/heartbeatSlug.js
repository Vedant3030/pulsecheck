import crypto from "crypto";

/**
 * Generate a unique heartbeat slug — 24 hex chars (12 bytes).
 * Lowercase alphanumeric, matches public slug safety but shorter than UUID.
 * Caller must verify uniqueness via DB lookup loop.
 */
export function generateHeartbeatSlug() {
  return crypto.randomBytes(12).toString("hex"); // 24 chars, 96-bit entropy
}
