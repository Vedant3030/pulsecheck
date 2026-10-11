/**
 * Multi-step chained checks — shared runner (backend + worker, byte-identical).
 *
 * Pure ESM: no Express/Prisma imports. The only sibling import is
 * sanitizeMessageUrls from ./ssrfGuard.js. All I/O is injected via deps so
 * unit tests can use a local mock HTTP server with no guard bypass:
 *   runChain(steps, { request, evaluate })
 * where request({ method, url, headers, body, timeoutMs }) performs one
 * guarded HTTP call and evaluate(assertions, ctx) scores it. No env flags,
 * no user-controllable options — the mock lives in test code, not here.
 */

import { sanitizeMessageUrls } from "./ssrfGuard.js";

export const MAX_STEPS = 5;
export const STEP_TIMEOUT_MS = 10000;
export const CHAIN_TIMEOUT_MS = 30000;
export const MAX_VALUE_BYTES = 8 * 1024;
export const MAX_PATH_DEPTH = 20;

export const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const VAR_REF_RE = /\{\{([A-Za-z_][A-Za-z0-9_]{0,31})\}\}/g;
// $.a.b[0].c — dot segments plus non-negative bracket indices, nothing else.
const PATH_RE = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const URL_SENTINEL = "__PULSECHECK_VAR__";

/** Save-time whitelist check for extract body paths ($.a.b[0].c, or bare $). */
export function isValidExtractPath(path) {
  if (path === "$") return true;
  if (typeof path !== "string" || !PATH_RE.test(path)) return false;
  const tokenRe = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let m;
  while ((m = tokenRe.exec(path.slice(1))) !== null) {
    if (m[1] !== undefined && FORBIDDEN_SEGMENTS.has(m[1])) return false;
  }
  return true;
}

export class ChainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChainError";
    this.code = code;
  }
}

/**
 * Hand-written dot/bracket path walker. No eval, no jsonpath library.
 * Returns { found: true, value } or { found: false }.
 * Prototype-safe: own-properties only, __proto__/constructor/prototype
 * segments rejected, depth-capped.
 */
export function walkPath(root, path) {
  if (path === "$") return { found: true, value: root };
  if (typeof path !== "string" || !PATH_RE.test(path)) {
    return { found: false };
  }
  // Tokenize: .name or [digits], left to right.
  const tokens = [];
  const tokenRe = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let m;
  while ((m = tokenRe.exec(path.slice(1))) !== null) {
    tokens.push(m[1] !== undefined ? { key: m[1] } : { index: Number(m[2]) });
    if (tokens.length > MAX_PATH_DEPTH) return { found: false };
  }
  if (tokens.length === 0) return { found: false };
  let cur = root;
  for (const t of tokens) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return { found: false };
    }
    if (t.key !== undefined) {
      if (FORBIDDEN_SEGMENTS.has(t.key)) return { found: false };
      if (!Object.hasOwn(cur, t.key)) return { found: false };
      cur = cur[t.key];
    } else {
      if (!Array.isArray(cur) || t.index >= cur.length) return { found: false };
      cur = cur[t.index];
    }
  }
  return { found: true, value: cur };
}

/** Names referenced as {{name}} in a template string. */
export function referencedVars(template) {
  if (typeof template !== "string") return [];
  const out = [];
  VAR_REF_RE.lastIndex = 0;
  let m;
  while ((m = VAR_REF_RE.exec(template)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Substitute {{name}} from vars. Unknown names throw (never silently
 * empty-string — that would turn typos into confusing downstream 401s).
 */
export function substituteVars(template, vars) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]{0,31})\}\}/g, (match, name) => {
    if (!Object.hasOwn(vars, name)) {
      throw new ChainError("undefined_variable", `Variable '{{${name}}}' is not defined by an earlier step.`);
    }
    return vars[name];
  });
}

/**
 * Validate a URL template at save time: substitute every {{var}} with a
 * sentinel, then require a parseable http(s) URL whose scheme and host
 * contain no sentinel (placeholders allowed in path/query only).
 * Returns { scheme, host } of the template shape.
 */
export function validateUrlTemplate(template) {
  if (typeof template !== "string" || template.trim() === "") {
    throw new ChainError("invalid_input", "URL is required.");
  }
  const masked = template.replace(/\{\{[A-Za-z_][A-Za-z0-9_]{0,31}\}\}/g, URL_SENTINEL);
  let url;
  try {
    url = new URL(masked);
  } catch {
    throw new ChainError("invalid_input", "URL could not be parsed.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ChainError("invalid_input", "Only http:// and https:// URLs are allowed.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ChainError("invalid_input", "URLs with embedded credentials are not allowed.");
  }
  // Note: URL.host is lowercased by the parser, so match case-insensitively.
  if (url.host.toLowerCase().includes(URL_SENTINEL.toLowerCase())) {
    throw new ChainError("invalid_input", "Variables may only appear in the URL path or query, never scheme or host.");
  }
  return { scheme: url.protocol, host: url.host };
}

function toStorableValue(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Run one extract rule against a completed step response.
 * Returns the string value (capped at MAX_VALUE_BYTES) or throws ChainError.
 */
export function extractValue(rule, { statusCode, headers, bodyText }) {
  const { variable, source, path } = rule;
  if (!VAR_NAME_RE.test(variable || "")) {
    throw new ChainError("invalid_input", "Extract variable names must match /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.");
  }
  let raw;
  if (source === "status") {
    if (path !== null && path !== undefined && String(path).trim() !== "") {
      throw new ChainError("invalid_input", `Extract '${variable}': status source takes no path.`);
    }
    raw = String(statusCode);
  } else if (source === "header") {
    if (typeof path !== "string" || path.trim() === "") {
      throw new ChainError("invalid_input", `Extract '${variable}': header source needs a header name.`);
    }
    const want = path.trim().toLowerCase();
    const entry = Object.entries(headers || {}).find(([k]) => String(k).toLowerCase() === want);
    if (!entry) {
      throw new ChainError("extraction_failed", `Extract '${variable}': header '${path}' not present.`);
    }
    raw = Array.isArray(entry[1]) ? entry[1][0] : entry[1];
  } else if (source === "body") {
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new ChainError("extraction_failed", `Extract '${variable}': response body is not valid JSON.`);
    }
    const { found, value } = walkPath(parsed, path);
    if (!found) {
      throw new ChainError("extraction_failed", `Extract '${variable}': path '${path}' not found.`);
    }
    raw = value;
  } else {
    throw new ChainError("invalid_input", `Extract '${variable}': source must be body, header, or status.`);
  }
  const str = toStorableValue(raw);
  if (Buffer.byteLength(str, "utf8") > MAX_VALUE_BYTES) {
    throw new ChainError("extraction_failed", `Extract '${variable}': value exceeds the 8KB cap.`);
  }
  return str;
}

function sanitizedStepError(err) {
  if (err instanceof ChainError) return err.message;
  const msg = err && err.message ? String(err.message) : "request failed";
  return sanitizeMessageUrls(msg);
}

/**
 * Run ordered chain steps sequentially, stopping at the first failure.
 *
 * steps: [{ order, name, method, url, requestBody, requestHeaders,
 *           authType, authHeaderName, secret (plaintext, resolved by caller),
 *           extracts: [{ variable, source, path }], assertions: [...] }]
 * deps: { request({ method, url, headers, body, timeoutMs }), evaluate(assertions, ctx) }
 *
 * Secrets and extracted values live only in memory for the duration of the
 * run — never stored, logged, or included in the returned stepResults.
 * Returns { status: "up"|"down", failedStepIndex, stepResults }.
 */
export async function runChain(steps, deps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    throw new ChainError("invalid_input", `Chains need 1 to ${MAX_STEPS} steps.`);
  }
  if (!deps || typeof deps.request !== "function" || typeof deps.evaluate !== "function") {
    throw new ChainError("invalid_input", "runChain needs request and evaluate dependencies.");
  }
  const chainStart = Date.now();
  const vars = {};
  const stepResults = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const startedAt = Date.now();
    if (startedAt - chainStart > CHAIN_TIMEOUT_MS) {
      stepResults.push({
        stepIndex: i, name: step.name || `Step ${i + 1}`, status: "down",
        statusCode: null, responseTimeMs: 0, assertions: [],
        error: "Chain exceeded the 30s whole-chain timeout.",
      });
      return { status: "down", failedStepIndex: i, stepResults };
    }

    const finishDown = (statusCode, responseTimeMs, error, assertions = []) => {
      stepResults.push({
        stepIndex: i, name: step.name || `Step ${i + 1}`, status: "down",
        statusCode, responseTimeMs, assertions, error,
      });
      return { status: "down", failedStepIndex: i, stepResults };
    };

    // 1. Substitute variables into a fresh request shape.
    let finalUrl, finalHeaders, finalBody, finalSecret;
    try {
      const shape = validateUrlTemplate(step.url);
      finalUrl = substituteVars(step.url, vars);
      // Runtime guard: substitution must not move scheme or host.
      const after = new URL(finalUrl);
      if (after.protocol !== shape.scheme || after.host !== shape.host) {
        throw new ChainError("invalid_input", "Variable substitution must not change URL scheme or host.");
      }
      finalHeaders = {};
      for (const [k, v] of Object.entries(step.requestHeaders || {})) {
        finalHeaders[k] = substituteVars(v, vars);
      }
      finalBody = step.requestBody ? substituteVars(step.requestBody, vars) : step.requestBody;
      finalSecret = step.secret ? substituteVars(step.secret, vars) : step.secret;
      if (finalSecret) {
        if (step.authType === "bearer") finalHeaders["Authorization"] = `Bearer ${finalSecret}`;
        else if (step.authType === "apiKey") finalHeaders[step.authHeaderName || "X-API-Key"] = finalSecret;
      }
      if (finalBody && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === "content-type")) {
        finalHeaders["Content-Type"] = "application/json";
      }
    } catch (err) {
      return finishDown(null, Date.now() - startedAt, sanitizedStepError(err));
    }

    // 2. Send with per-step timeout.
    let res;
    try {
      res = await deps.request(
        { method: step.method || "GET", url: finalUrl, headers: finalHeaders, body: finalBody },
        STEP_TIMEOUT_MS
      );
    } catch (err) {
      return finishDown(null, Date.now() - startedAt, sanitizedStepError(err));
    }

    // 3. Assertions (a step with none passes on 2xx).
    let verdicts = [];
    let assertionsPass = res.statusCode >= 200 && res.statusCode < 300;
    try {
      if (Array.isArray(step.assertions) && step.assertions.length > 0) {
        verdicts = deps.evaluate(step.assertions, {
          statusCode: res.statusCode,
          responseTimeMs: res.responseTimeMs,
          bodyText: res.bodyText,
          wasTruncated: !!res.wasTruncated,
        }) || [];
        assertionsPass = verdicts.every((v) => v.pass);
      }
    } catch (err) {
      return finishDown(res.statusCode, res.responseTimeMs, sanitizedStepError(err), verdicts);
    }
    if (!assertionsPass) {
      const failed = verdicts.find((v) => !v.pass);
      return finishDown(
        res.statusCode, res.responseTimeMs,
        failed && failed.message ? String(failed.message) : `Step '${step.name || `Step ${i + 1}`}' assertions failed.`,
        verdicts
      );
    }

    // 4. Extract variables for later steps.
    const extractedNames = [];
    try {
      for (const rule of step.extracts || []) {
        vars[rule.variable] = extractValue(rule, {
          statusCode: res.statusCode, headers: res.headers || {}, bodyText: res.bodyText || "",
        });
        extractedNames.push(rule.variable);
      }
    } catch (err) {
      return finishDown(res.statusCode, res.responseTimeMs, sanitizedStepError(err), verdicts);
    }

    stepResults.push({
      stepIndex: i, name: step.name || `Step ${i + 1}`, status: "up",
      statusCode: res.statusCode, responseTimeMs: res.responseTimeMs,
      assertions: verdicts, error: null,
      // Names only — values stay in memory for later steps, never stored.
      extracts: extractedNames.map((variable) => ({ variable, extracted: true })),
    });
  }

  return { status: "up", failedStepIndex: null, stepResults };
}
