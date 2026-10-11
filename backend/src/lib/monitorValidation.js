import {
  MAX_STEPS, VAR_NAME_RE, isValidExtractPath, referencedVars, validateUrlTemplate,
} from "./chainRunner.js";

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const VALID_AUTH_TYPES = ["bearer", "apiKey"];
const VALID_TYPES = ["single", "chain"];
const MAX_BODY_BYTES = 100 * 1024;
const MAX_HEADERS = 20;
const MAX_HEADER_KEY = 100;
const MAX_HEADER_VALUE = 2000;
const MAX_STEP_NAME = 100;
export const MIN_CHAIN_INTERVAL_MINS = 5;
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

/** Normalize + validate Monitor.type ("single" default). */
export function validateMonitorType(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { clean: "single" };
  }
  const t = String(value).trim().toLowerCase();
  if (!VALID_TYPES.includes(t)) {
    return { error: 'type must be "single" or "chain"' };
  }
  return { clean: t };
}

function cleanHeadersObject(requestHeaders, label) {
  if (requestHeaders === undefined || requestHeaders === null || requestHeaders === "") {
    return { clean: null };
  }
  if (typeof requestHeaders !== "object" || Array.isArray(requestHeaders)) {
    return { error: `${label} must be a flat object of string keys to string values` };
  }
  const entries = Object.entries(requestHeaders);
  if (entries.length > MAX_HEADERS) {
    return { error: `${label} limited to 20 entries` };
  }
  const clean = {};
  for (const [k, v] of entries) {
    if (typeof k !== "string" || k.trim() === "") {
      return { error: `${label} keys must be non-empty strings` };
    }
    if (k.length > MAX_HEADER_KEY) {
      return { error: `${label} key "${k.slice(0, 50)}" exceeds 100 chars` };
    }
    if (typeof v !== "string") {
      return { error: `${label} value for "${k}" must be a string (nested objects/arrays not allowed)` };
    }
    if (v.length > MAX_HEADER_VALUE) {
      return { error: `${label} value for "${k}" exceeds 2000 chars` };
    }
    const lower = k.trim().toLowerCase();
    if (ALWAYS_BLOCKED.has(lower)) {
      return { error: `${label} must not include '${k}' — it is managed automatically` };
    }
    clean[k.trim()] = v;
  }
  return { clean };
}

function validateExtracts(extracts, label) {
  if (extracts === undefined || extracts === null) return { clean: [] };
  if (!Array.isArray(extracts)) {
    return { error: `${label} must be an array of { variable, source, path }` };
  }
  const seen = new Set();
  const clean = [];
  for (const rule of extracts) {
    if (!rule || typeof rule !== "object") {
      return { error: `${label} entries must be objects` };
    }
    const { variable, source, path } = rule;
    if (typeof variable !== "string" || !VAR_NAME_RE.test(variable)) {
      return { error: `${label} variable names must match /^[A-Za-z_][A-Za-z0-9_]{0,31}$/` };
    }
    if (seen.has(variable)) {
      return { error: `${label} has duplicate variable '${variable}'` };
    }
    seen.add(variable);
    if (!["body", "header", "status"].includes(source)) {
      return { error: `${label} source must be body, header, or status` };
    }
    if (source === "body") {
      if (path !== "$" && !isValidExtractPath(path)) {
        return { error: `${label} path '${String(path).slice(0, 80)}' must look like $.data.token or $.items[0].id` };
      }
    } else if (source === "header") {
      if (typeof path !== "string" || path.trim() === "" || path.length > MAX_HEADER_KEY) {
        return { error: `${label} header source needs a header name` };
      }
    } else if (path !== null && path !== undefined && String(path).trim() !== "") {
      return { error: `${label} status source takes no path` };
    }
    clean.push({
      variable,
      source,
      path: source === "header" ? String(path).trim() : (path === undefined ? null : path),
    });
  }
  return { clean };
}

/**
 * Validate a full chain definition (steps array from POST/PUT body).
 * Returns { clean: { steps: [normalized...] } } with order = array position.
 * Auth secrets are NOT handled here — routes resolve authValue per step
 * (explicit wins, id-matched stored secret kept on empty, None clears).
 */
export function validateChainDefinition(steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    return { error: `Chains need 1 to ${MAX_STEPS} steps` };
  }
  const cleanSteps = [];
  const definedVars = new Set();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] || {};
    const label = `Step ${i + 1}`;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (name === "" || name.length > MAX_STEP_NAME) {
      return { error: `${label} needs a name (1-100 chars)` };
    }
    const method = s.method === undefined || s.method === null || String(s.method).trim() === ""
      ? "GET"
      : String(s.method).trim().toUpperCase();
    if (!VALID_METHODS.includes(method)) {
      return { error: `${label}: method must be one of GET, POST, PUT, PATCH, DELETE` };
    }
    // URL template: parseable, http(s), no credentials, vars in path/query only.
    try {
      validateUrlTemplate(s.url);
    } catch (err) {
      return { error: `${label}: ${err.message}` };
    }
    let requestBody = null;
    if (s.requestBody !== undefined && s.requestBody !== null && String(s.requestBody).trim() !== "") {
      const raw = String(s.requestBody);
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
        return { error: `${label}: requestBody exceeds 100KB limit` };
      }
      // Bodies may contain {{vars}} — validate JSON shape only when no
      // placeholders are present; the worker re-checks after substitution.
      if (!/\{\{[A-Za-z_][A-Za-z0-9_]{0,31}\}\}/.test(raw)) {
        try {
          JSON.parse(raw);
        } catch (err) {
          return { error: `${label}: requestBody must be valid JSON: ${err.message}` };
        }
      }
      requestBody = raw;
    }
    const h = cleanHeadersObject(s.requestHeaders, `${label} requestHeaders`);
    if (h.error) return { error: h.error };
    // Auth shape (secret itself resolved by the route).
    let authType = null;
    if (s.authType !== undefined && s.authType !== null && String(s.authType).trim() !== "" && String(s.authType).toLowerCase() !== "none") {
      authType = String(s.authType).trim();
      if (authType.toLowerCase() === "bearer") authType = "bearer";
      else if (authType.toLowerCase() === "apikey" || authType === "apiKey") authType = "apiKey";
      if (!VALID_AUTH_TYPES.includes(authType)) {
        return { error: `${label}: authType must be null (None), "bearer", or "apiKey"` };
      }
    }
    let authHeaderName = null;
    if (authType === "apiKey") {
      if (s.authHeaderName === undefined || s.authHeaderName === null || String(s.authHeaderName).trim() === "") {
        return { error: `${label}: authHeaderName is required when authType is "apiKey"` };
      }
      authHeaderName = String(s.authHeaderName).trim();
      if (authHeaderName.length > MAX_HEADER_KEY) {
        return { error: `${label}: authHeaderName exceeds 100 chars` };
      }
    }
    if (authType && h.clean) {
      const hasAuthHeader = Object.keys(h.clean).some((k) => k.toLowerCase() === "authorization");
      if (hasAuthHeader) {
        return { error: `${label}: requestHeaders must not include 'Authorization' when auth is configured` };
      }
    }
    const ex = validateExtracts(s.extracts, `${label} extracts`);
    if (ex.error) return { error: ex.error };

    // Forward-only variable references across url/headers/body/authValue.
    const templates = [String(s.url)];
    for (const v of Object.values(h.clean || {})) templates.push(v);
    if (requestBody) templates.push(requestBody);
    if (typeof s.authValue === "string" && s.authValue !== "") templates.push(s.authValue);
    for (const t of templates) {
      for (const ref of referencedVars(t)) {
        if (!definedVars.has(ref)) {
          return { error: `${label}: variable '{{${ref}}}' is not defined by an earlier step` };
        }
      }
    }
    for (const rule of ex.clean) definedVars.add(rule.variable);

    cleanSteps.push({      id: typeof s.id === "string" ? s.id : undefined,
      order: i, name, method, url: String(s.url),
      requestBody, requestHeaders: h.clean,
      authType, authHeaderName,
      authValue: typeof s.authValue === "string" ? s.authValue : undefined,
      extracts: ex.clean,
      assertions: Array.isArray(s.assertions) ? s.assertions : [],
    });
  }
  return { clean: { steps: cleanSteps } };
}
