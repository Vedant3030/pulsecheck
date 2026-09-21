import crypto from "crypto";

export function generateRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
