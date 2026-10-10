import crypto from "crypto";

const GENERATE_CMD = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

function loadKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      `ENCRYPTION_KEY is missing — set a 64-character hex string in .env (generate with: ${GENERATE_CMD})`
    );
  }
  const key = String(raw).trim();
  if (key.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hex characters, got ${key.length} — generate with: ${GENERATE_CMD}`
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `ENCRYPTION_KEY must be hex-only (0-9, a-f), 64 characters — generate with: ${GENERATE_CMD}`
    );
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length} — generate with: ${GENERATE_CMD}`
    );
  }
  return buf;
}

/**
 * Fail fast at boot: call once at service startup so a missing/malformed
 * key throws a clear error naming exactly what's wrong, instead of failing
 * confusingly on the first encrypt/decrypt call.
 */
export function requireEncryptionKey() {
  loadKey();
}

/** AES-256-GCM encrypt. Returns "ivHex:authTagHex:ciphertextHex". */
export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encrypt requires a non-empty string");
  }
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Reverse of encrypt(). Throws on malformed input or wrong key. */
export function decrypt(ciphertext) {
  if (typeof ciphertext !== "string") {
    throw new Error("decrypt requires a string");
  }
  const key = loadKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("decrypt: malformed ciphertext (expected iv:tag:data)");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  if (iv.length !== 12 || tag.length !== 16 || data.length === 0) {
    throw new Error("decrypt: malformed ciphertext parts");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
