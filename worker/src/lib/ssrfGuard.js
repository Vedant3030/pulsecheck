/**
 * SSRF guard for outbound test/check requests to user-supplied URLs.
 *
 * Pure ESM with no Express/Prisma imports — only node:dns, node:net and the
 * `undici` package — so this file can be mirrored byte-for-byte into
 * worker/src/lib/ later.
 *
 * Strategy (defense in depth):
 *  1. validateTargetUrl() — static checks (scheme, credentials, length) plus
 *     a resolving DNS check where EVERY resolved address must be public.
 *  2. createGuardedDispatcher() — an undici Agent whose connect.lookup
 *     re-validates at actual connect time, so the IP dialed is always an IP
 *     that passed validation (DNS-rebinding safe: undici performs this
 *     lookup per connection, with no cross-request DNS cache).
 *  3. guardedRequest() — validates, then sends with redirect following
 *     DISABLED (a public URL must not be allowed to bounce to an internal
 *     one) and returns the 3xx + Location as data instead.
 */

import dns from "node:dns";
import net from "node:net";
import { Agent, request as undiciRequest } from "undici";

export const MAX_URL_LENGTH = 2048;

export class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GuardError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// IPv4 helpers
// ---------------------------------------------------------------------------

function ipv4ToInt(bytes) {
  // Arithmetic (not bitwise) to stay unsigned past 2^31.
  return ((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3];
}

function inCidrV4(int, base, prefix) {
  if (prefix === 0) return true;
  const shift = 32 - prefix;
  return Math.floor(int / 2 ** shift) === Math.floor(base / 2 ** shift);
}

// [baseInt, prefix] — everything here is non-public (or non-routable).
const BLOCKED_V4 = [
  [0x00000000, 8], // 0.0.0.0/8 — software scope ("this network")
  [0x0a000000, 8], // 10.0.0.0/8 — private
  [0x64400000, 10], // 100.64.0.0/10 — CGNAT
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12 — private
  [0xc0000000, 24], // 192.0.0.0/24 — special (IETF protocol assignments)
  [0xc0000200, 24], // 192.0.2.0/24 — TEST-NET-1 (documentation)
  [0xc0586300, 24], // 192.88.99.0/24 — reserved (6to4 relay, deprecated)
  [0xc0a80000, 16], // 192.168.0.0/16 — private
  [0xc6120000, 15], // 198.18.0.0/15 — benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 — TEST-NET-2 (documentation)
  [0xcb007100, 24], // 203.0.113.0/24 — TEST-NET-3 (documentation)
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reserved
];

function isBlockedV4Int(int) {
  return BLOCKED_V4.some(([base, prefix]) => inCidrV4(int, base, prefix));
}

/**
 * Parse inet_aton-style numeric IPv4 forms that URL/DNS stacks may accept
 * but net.isIP() misses: single 32-bit decimal ("2130706433"), hex
 * ("0x7f000001"), octal ("037700000001"), and 1-4 dotted parts where each
 * part may be decimal, 0x-hex, or 0-octal. Returns 4 bytes or null.
 */
export function parseNumericIPv4(host) {
  const h = host.trim();
  if (h === "") return null;
  const partRe = /^(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*|0)$/;
  const parsePart = (p) => {
    if (!partRe.test(p)) return null;
    let n;
    if (/^0[xX]/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-9]+$/.test(p)) {
      if (/[89]/.test(p)) return null; // invalid octal
      n = parseInt(p, 8);
    } else n = parseInt(p, 10);
    return Number.isSafeInteger(n) ? n : null;
  };

  if (!h.includes(".")) {
    // Single number = full 32-bit address.
    const n = parsePart(h);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const p of parts) {
    const n = parsePart(p);
    if (n === null) return null;
    nums.push(n);
  }
  let bytes;
  if (nums.length === 2) {
    if (nums[0] > 0xff || nums[1] > 0xffffff) return null;
    bytes = [nums[0], (nums[1] >>> 16) & 0xff, (nums[1] >>> 8) & 0xff, nums[1] & 0xff];
  } else if (nums.length === 3) {
    if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null;
    bytes = [nums[0], nums[1], (nums[2] >>> 8) & 0xff, nums[2] & 0xff];
  } else if (nums.length === 4) {
    if (nums.some((n) => n > 0xff)) return null;
    bytes = nums;
  } else {
    // Single dotted part handled above; length 1 with dot impossible.
    return null;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// IPv6 helpers
// ---------------------------------------------------------------------------

function parseIPv6ToBigInt(ip) {
  // Strip scope/zone id — zones are rejected by the caller, this is just parsing.
  const addr = ip.split("%")[0].toLowerCase();
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parseGroup = (g) => {
    if (g.includes(".")) {
      // Embedded dotted quad.
      const q = g.split(".");
      if (q.length !== 4) return null;
      const b = q.map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
      if (b.some((n) => n < 0 || n > 255)) return null;
      return [(b[0] * 256 + b[1]).toString(16), (b[2] * 256 + b[3]).toString(16)];
    }
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    return [g];
  };

  let head = halves[0] === "" ? [] : halves[0].split(":");
  let tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  let headGroups = [];
  let tailGroups = [];
  for (const g of head) {
    const p = parseGroup(g);
    if (!p) return null;
    headGroups.push(...p);
  }
  for (const g of tail) {
    const p = parseGroup(g);
    if (!p) return null;
    tailGroups.push(...p);
  }
  let groups;
  if (halves.length === 2) {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = headGroups;
  }
  if (groups.length !== 8) return null;
  let out = 0n;
  for (const g of groups) {
    const v = BigInt(parseInt(g, 16));
    if (v < 0n || v > 0xffffn) return null;
    out = (out << 16n) | v;
  }
  return out;
}

function inCidrV6(int, base, prefix) {
  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return (int >> shift) === (base >> shift);
}

// [baseBigInt, prefix] — non-public IPv6 ranges (link-local, ULA and
// multicast are checked separately below for readability).
const BLOCKED_V6 = [
  [0n, 128], // ::/128 — unspecified
  [1n, 128], // ::1/128 — loopback
  [(64n << 120n) | (0xff9bn << 88n), 96], // 64:ff9b::/96 — NAT64 translation (embeds IPv4, checked separately)
  [(100n << 120n), 64], // 100::/64 — discard
  [(0x2001n << 112n), 32], // 2001::/32 — Teredo tunneling
  [(0x2001n << 112n) | (0xdb8n << 96n), 32], // 2001:db8::/32 — documentation
];
const FE80 = 0xfe80n << 112n; // fe80::/10
const FC00 = 0xfc00n << 112n; // fc00::/7
const FF00 = 0xff00n << 112n; // ff00::/8
const V4MAPPED_PREFIX = 0xffffn; // ::ffff:0:0/96 — low 96 bits zero + 0xffff at bits 32..47

function isBlockedV6Int(int) {
  if (BLOCKED_V6.some(([base, prefix]) => inCidrV6(int, base, prefix))) return true;
  if (inCidrV6(int, FE80, 10)) return true; // link-local
  if (inCidrV6(int, FC00, 7)) return true; // unique-local (private)
  if (inCidrV6(int, FF00, 8)) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d): classify the embedded IPv4.
  if ((int >> 32n) === V4MAPPED_PREFIX && (int >> 48n) === 0n) {
    const embedded = Number(int & 0xffffffffn);
    if (isBlockedV4Int(embedded)) return true;
    return false; // mapped public IPv4 — treat as its (public) self
  }
  // 6to4 2002::/16 embeds a full IPv4 in bits 16..47.
  if (inCidrV6(int, 0x2002n << 112n, 16)) {
    const embedded = Number((int >> 80n) & 0xffffffffn);
    if (isBlockedV4Int(embedded)) return true;
  }
  return false;
}

/**
 * True if the literal IP string is globally routable/public.
 * Handles dotted IPv4, inet_aton numeric forms, plain IPv6 and
 * IPv4-mapped/embedded IPv6. Anything unparseable is NOT public.
 */
export function isPublicIp(ip) {
  if (typeof ip !== "string" || ip === "") return false;
  const s = ip.trim();
  if (s.includes("%")) return false; // zone id — refuse
  if (net.isIP(s) === 4) {
    return !isBlockedV4Int(ipv4ToInt(s.split(".").map(Number)));
  }
  const numeric = parseNumericIPv4(s);
  if (numeric) {
    return !isBlockedV4Int(ipv4ToInt(numeric));
  }
  if (net.isIP(s) === 6 || s.includes(":")) {
    const int = parseIPv6ToBigInt(s);
    if (int === null) return false;
    return !isBlockedV6Int(int);
  }
  return false;
}

export function assertPublicIp(ip) {
  if (!isPublicIp(ip)) {
    throw new GuardError("blocked_target", "This address isn't allowed: it resolves to a private or internal IP.");
  }
}

// ---------------------------------------------------------------------------
// URL validation (static + resolving)
// ---------------------------------------------------------------------------

const LOCALHOST_RE = /^(localhost|.*\.localhost)$/i;

export async function validateTargetUrl(urlString) {
  if (typeof urlString !== "string" || urlString.trim() === "") {
    throw new GuardError("invalid_input", "A URL is required.");
  }
  const raw = urlString.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw new GuardError("invalid_input", `URL exceeds the ${MAX_URL_LENGTH} character limit.`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new GuardError("invalid_input", "That URL could not be parsed. Include the scheme, e.g. https://example.com/health.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GuardError("invalid_input", "Only http:// and https:// URLs can be tested.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new GuardError("invalid_input", "URLs with embedded credentials (user:password@host) are not allowed.");
  }
  let hostname = url.hostname.toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (hostname === "" || hostname.includes("%")) {
    throw new GuardError("invalid_input", "That hostname is not allowed.");
  }
  if (LOCALHOST_RE.test(hostname)) {
    throw new GuardError("blocked_target", "This address isn't allowed: private and internal addresses can't be tested.");
  }

  // Strip brackets for literal IPv6 (URL.hostname already strips them, but be safe).
  const hostForCheck = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  // Case 1: literal IP (dotted, numeric, or IPv6) — classify directly, no DNS.
  const numeric = !hostForCheck.includes(":") ? parseNumericIPv4(hostForCheck) : null;
  if (net.isIP(hostForCheck) === 4 || numeric) {
    const bytes = net.isIP(hostForCheck) === 4 ? hostForCheck.split(".").map(Number) : numeric;
    if (isBlockedV4Int(ipv4ToInt(bytes))) {
      throw new GuardError("blocked_target", "This address isn't allowed: private and internal addresses can't be tested.");
    }
    return url;
  }
  if (hostForCheck.includes(":")) {
    // Literal IPv6.
    if (!isPublicIp(hostForCheck)) {
      throw new GuardError("blocked_target", "This address isn't allowed: private and internal addresses can't be tested.");
    }
    return url;
  }

  // Case 2: hostname — resolve and require EVERY address to be public.
  let records;
  try {
    records = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new GuardError("dns_failure", "That hostname could not be resolved. Check the spelling and try again.");
  }
  if (!records || records.length === 0) {
    throw new GuardError("dns_failure", "That hostname could not be resolved. Check the spelling and try again.");
  }
  for (const r of records) {
    if (!isPublicIp(r.address)) {
      throw new GuardError("blocked_target", "This address isn't allowed: private and internal addresses can't be tested.");
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Connect-time validation (DNS-rebinding defense) + guarded request
// ---------------------------------------------------------------------------

/**
 * Drop-in `lookup` for undici connect options. Re-resolves and re-validates
 * on every connection and pins the socket to the first validated address,
 * so a hostname that flips answers between validation and connect (or
 * between connections) can only ever dial a public IP.
 */
export function validatingLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const family = options && typeof options.family === "number" ? options.family : 0;
  const wantAll = !!(options && options.all);
  let host = String(hostname).toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);

  const done = (err, address, fam) => callback(err, address, fam);

  if (LOCALHOST_RE.test(host)) {
    done(Object.assign(new Error("blocked"), { code: "EBLOCKED" }));
    return;
  }
  const numeric = !host.includes(":") ? parseNumericIPv4(host) : null;
  if (net.isIP(host) === 4 || numeric) {
    const bytes = net.isIP(host) === 4 ? host.split(".").map(Number) : numeric;
    if (isBlockedV4Int(ipv4ToInt(bytes))) {
      done(Object.assign(new Error("blocked"), { code: "EBLOCKED" }));
      return;
    }
    const dotted = net.isIP(host) === 4 ? host : bytes.join(".");
    if (wantAll) done(null, [{ address: dotted, family: 4 }]);
    else done(null, dotted, 4);
    return;
  }
  if (host.includes(":")) {
    if (!isPublicIp(host)) {
      done(Object.assign(new Error("blocked"), { code: "EBLOCKED" }));
      return;
    }
    if (wantAll) done(null, [{ address: host, family: 6 }]);
    else done(null, host, 6);
    return;
  }

  dns.promises
    .lookup(host, { all: true })
    .then((records) => {
      if (!records || records.length === 0) {
        done(Object.assign(new Error("no records"), { code: "ENOTFOUND" }));
        return;
      }
      const validated = records.filter((r) => isPublicIp(r.address));
      if (validated.length === 0) {
        done(Object.assign(new Error("blocked"), { code: "EBLOCKED" }));
        return;
      }
      if (wantAll) {
        // dns.lookup all:true contract: callback receives the address array.
        // Every entry here passed validation, so any connection opened from
        // this set dials a public IP.
        const list = family === 4 || family === 6 ? validated.filter((r) => r.family === family) : validated;
        done(null, list.length > 0 ? list : validated);
        return;
      }
      const pick = family === 4 || family === 6 ? validated.find((r) => r.family === family) || validated[0] : validated[0];
      done(null, pick.address, pick.family);
    })
    .catch((err) => done(err));
}

let cachedDispatcher = null;

/** Shared guarded undici dispatcher (redirects never followed by default). */
export function createGuardedDispatcher() {
  if (!cachedDispatcher) {
    cachedDispatcher = new Agent({
      connect: { lookup: validatingLookup },
    });
  }
  return cachedDispatcher;
}

/**
 * Attach a noop 'error' listener to a response body stream if it has none.
 * Call right after a response is received, before reading: errors raised
 * during for-await/break/destroy paths are then absorbed instead of thrown
 * as unhandled 'error' events (which kill the process). Never overrides an
 * existing handler and never stacks duplicates (listenerCount guard).
 */
export function silenceStreamErrors(body) {
  try {
    if (body && typeof body.listenerCount === "function" && body.listenerCount("error") === 0) {
      body.on("error", () => {});
    }
  } catch {}
}

/**
 * Destroy a response body stream without risking an unhandled 'error' event.
 * Undici's BodyReadable emits RequestAbortedError when destroyed with an
 * in-flight request; with no 'error' listener Node kills the process.
 */
export function safeDestroy(body) {
  if (!body || typeof body.destroy !== "function") return;
  silenceStreamErrors(body);
  try {
    body.destroy();
  } catch {}
}

/**
 * Read at most maxBytes from an undici response body, then destroy the
 * stream. Stops early (no full download) once the cap is exceeded.
 * Returns { text, truncated }. Throws on stream errors (stream still
 * destroyed via finally) so the caller can record a clean failure.
 */
export async function readCappedBody(response, maxBytes) {
  silenceStreamErrors(response.body);
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        truncated = true;
        break;
      }
      chunks.push(chunk);
    }
  } finally {
    safeDestroy(response.body);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

/**
 * Validate the URL, then send one request with redirects DISABLED.
 * Returns the undici response ({ statusCode, headers, body stream }).
 * Throws GuardError for blocked/unresolvable targets; underlying network
 * errors propagate for the caller to map to stable codes.
 *
 * NOTE: a blocked target can surface here as EBLOCKED (connect-time
 * re-validation) even if pre-validation passed — callers should map
 * EBLOCKED to blocked_target.
 */
export async function guardedRequest(urlString, { method = "GET", headers = {}, body, signal } = {}) {
  const url = await validateTargetUrl(urlString);
  return undiciRequest(url.toString(), {
    method,
    headers,
    body,
    signal,
    dispatcher: createGuardedDispatcher(),
    maxRedirections: 0,
  });
}

// ---------------------------------------------------------------------------
// Redirect-following guarded fetch (uptime-check semantics)
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isSameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

function dropContentHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "content-type" || lower === "content-length") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Strip query strings and fragments from any http(s) URLs embedded in a
 * free-text message (e.g. upstream error text). Those parts often carry
 * tokens/secrets and must never reach logs or stored results.
 */
export function sanitizeMessageUrls(message) {
  if (typeof message !== "string") return "";
  return message.replace(/https?:\/\/[^\s"'<>)\]]+/g, (m) => {
    let cut = m.length;
    const q = m.indexOf("?");
    const h = m.indexOf("#");
    if (q !== -1) cut = Math.min(cut, q);
    if (h !== -1) cut = Math.min(cut, h);
    return m.slice(0, cut);
  });
}

/**
 * Validate the URL, then fetch while following redirects (max maxHops hops),
 * with fetch-compatible semantics:
 * - 301/302 on POST (and 303 on any non-GET/HEAD) rewrite to GET with the
 *   body dropped; 307/308 preserve method and body.
 * - Every hop's final URL gets full validateTargetUrl() treatment (static +
 *   resolve-all-addresses), and every connection is pinned at connect time
 *   by the guarded dispatcher — a public entry URL can never bounce to an
 *   internal target.
 * - A hop that changes origin drops ALL caller-supplied headers and keeps
 *   only `keepHeaders` (worker/request defaults such as User-Agent).
 *   Same-origin hops keep all headers.
 * - A hop rejected by validation THROWS its GuardError (so the caller can
 *   record a clear DOWN with a reason); exhausting maxHops or hitting a
 *   non-http(s)/missing Location returns the last 3xx response as-is.
 * Returns the final undici response ({ statusCode, headers, body stream }).
 */
export async function requestWithRedirects(
  urlString,
  { method = "GET", headers = {}, keepHeaders = {}, body, signal } = {},
  maxHops = 5
) {
  const entry = await validateTargetUrl(urlString);
  let current = new URL(entry.toString());
  let currentMethod = String(method || "GET").toUpperCase();
  let currentHeaders = { ...headers };
  let currentBody = body;

  for (let hop = 0; ; hop++) {
    const res = await undiciRequest(current.toString(), {
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      signal,
      dispatcher: createGuardedDispatcher(),
      maxRedirections: 0,
    });

    let location = res.headers ? res.headers.location : undefined;
    if (Array.isArray(location)) location = location[0];
    const canFollow =
      REDIRECT_STATUSES.has(res.statusCode) &&
      typeof location === "string" &&
      location !== "" &&
      hop < maxHops;
    if (!canFollow) return res;

    // Hop bodies are irrelevant — destroy, don't drain. Draining would
    // download an unbounded redirect body (there is no worker timeout).
    safeDestroy(res.body);

    let next;
    try {
      next = new URL(location, current.toString());
    } catch {
      return res; // Unparseable Location — report the 3xx as-is.
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") return res;

    // Full per-hop validation. Throws GuardError on blocked targets so the
    // caller records DOWN with a clear reason instead of a bare 3xx.
    await validateTargetUrl(next.toString());

    if (!isSameOrigin(next, current)) {
      currentHeaders = { ...keepHeaders };
    }
    if (
      ((res.statusCode === 301 || res.statusCode === 302) && currentMethod === "POST") ||
      (res.statusCode === 303 && currentMethod !== "GET" && currentMethod !== "HEAD")
    ) {
      currentMethod = "GET";
      currentBody = undefined;
      currentHeaders = dropContentHeaders(currentHeaders);
    }
    current = next;
  }
}
