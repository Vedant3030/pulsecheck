const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const VALID_AUTH_TYPES = ["bearer", "apiKey"];
const MAX_BODY_BYTES = 100 * 1024;
const MAX_HEADERS = 20;
const MAX_HEADER_KEY = 100;
const MAX_HEADER_VALUE = 2000;
// Headers the worker/fetch stack manages itself — never user-settable.
const ALWAYS_BLOCKED = new Set(["host", "content-length"]);

/**
 * Shared strict validation for POST /monitors and PUT /monitors/:id.
 * Returns { error } on failure, or { clean } with normalized fields.
 * `authValue` (plaintext secret) is passed through for the route to encrypt;
 * it is never logged or echoed.
 */
export function validateMonitorRequestFields(body = {}) {
  const { method, requestBody, requestHeaders, authType, authHeaderName } = body;

  // --- method ---
  let cleanMethod;
  if (method === undefined || method === null || String(method).trim() === "") {
    cleanMethod = undefined; // absent → route keeps default/existing
  } else {
    cleanMethod = String(method).trim().toUpperCase();
    if (!VALID_METHODS.includes(cleanMethod)) {
      return { error: "method must be one of GET, POST, PUT, PATCH, DELETE" };
    }
  }

  // --- requestBody ---
  let cleanBody;
  if (requestBody === undefined || requestBody === null || String(requestBody).trim() === "") {
    cleanBody = undefined; // absent/empty → route clears to null on explicit empty, keeps on absent (handled by caller via key presence)
  } else {
    const raw = String(requestBody);
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return { error: "requestBody exceeds 100KB limit" };
    }
    try {
      JSON.parse(raw);
    } catch (err) {
      return { error: `requestBody must be valid JSON: ${err.message}` };
    }
    cleanBody = raw;
  }

  // --- requestHeaders ---
  let cleanHeaders;
  if (requestHeaders === undefined || requestHeaders === null || requestHeaders === "") {
    cleanHeaders = undefined;
  } else {
    if (typeof requestHeaders !== "object" || Array.isArray(requestHeaders)) {
      return { error: "requestHeaders must be a flat object of string keys to string values" };
    }
    const entries = Object.entries(requestHeaders);
    if (entries.length > MAX_HEADERS) {
      return { error: "requestHeaders limited to 20 entries" };
    }
    cleanHeaders = {};
    for (const [k, v] of entries) {
      if (typeof k !== "string" || k.trim() === "") {
        return { error: "requestHeaders keys must be non-empty strings" };
      }
      if (k.length > MAX_HEADER_KEY) {
        return { error: `requestHeaders key "${k.slice(0, 50)}" exceeds 100 chars` };
      }
      if (typeof v !== "string") {
        return { error: `requestHeaders value for "${k}" must be a string (nested objects/arrays not allowed)` };
      }
      if (v.length > MAX_HEADER_VALUE) {
        return { error: `requestHeaders value for "${k}" exceeds 2000 chars` };
      }
      const lower = k.trim().toLowerCase();
      if (ALWAYS_BLOCKED.has(lower)) {
        return { error: `requestHeaders must not include '${k}' — it is managed automatically` };
      }
      cleanHeaders[k.trim()] = v;
    }
  }

  // --- authType / authHeaderName ---
  let cleanAuthType;
  if (authType === undefined || authType === null || String(authType).trim() === "" || String(authType).toLowerCase() === "none") {
    cleanAuthType = null; // None → clear
  } else {
    cleanAuthType = String(authType).trim();
    // normalize common variants
    if (cleanAuthType.toLowerCase() === "bearer") cleanAuthType = "bearer";
    else if (cleanAuthType.toLowerCase() === "apikey" || cleanAuthType === "apiKey") cleanAuthType = "apiKey";
    if (!VALID_AUTH_TYPES.includes(cleanAuthType)) {
      return { error: 'authType must be null (None), "bearer", or "apiKey"' };
    }
  }

  let cleanAuthHeaderName;
  if (cleanAuthType === "apiKey") {
    if (authHeaderName === undefined || authHeaderName === null || String(authHeaderName).trim() === "") {
      return { error: 'authHeaderName is required when authType is "apiKey" (e.g. "X-API-Key")' };
    }
    cleanAuthHeaderName = String(authHeaderName).trim();
    if (cleanAuthHeaderName.length > MAX_HEADER_KEY) {
      return { error: "authHeaderName exceeds 100 chars" };
    }
  } else if (authHeaderName !== undefined && authHeaderName !== null && String(authHeaderName).trim() !== "") {
    // Header name supplied but not an apiKey monitor — only meaningful for apiKey.
    if (cleanAuthType === null) {
      cleanAuthHeaderName = null;
    } else {
      cleanAuthHeaderName = null; // bearer ignores header name
    }
  } else {
    cleanAuthHeaderName = cleanAuthType === null ? null : undefined;
  }

  // --- reserved collision: user Authorization header + configured auth ---
  if (cleanAuthType && cleanHeaders) {
    const hasAuthHeader = Object.keys(cleanHeaders).some((k) => k.toLowerCase() === "authorization");
    if (hasAuthHeader) {
      return { error: "requestHeaders must not include 'Authorization' when auth is configured — it is set automatically from the stored credential" };
    }
  }

  return { clean: { method: cleanMethod, requestBody: cleanBody, requestHeaders: cleanHeaders, authType: cleanAuthType, authHeaderName: cleanAuthHeaderName } };
}
