import * as psl from "psl";
import { whoisDomain } from "whoiser";

/**
 * Domain expiry via WHOIS (whoiser) + psl for registrable domain extraction.
 * Returns Date | null — null on failure (don't wipe existing data; WHOIS is flaky).
 */
export async function fetchDomainExpiry(hostname) {
  // Extract registrable domain via psl (e.g. api.mycompany.co.uk -> mycompany.co.uk)
  let lookupDomain = hostname;
  try {
    const parsed = psl.parse(hostname);
    if (parsed && !parsed.error && parsed.domain) {
      lookupDomain = parsed.domain;
    }
  } catch {}

  console.log(`[domain] WHOIS lookup for ${hostname} -> registrable ${lookupDomain}`);

  try {
    const result = await whoisDomain(lookupDomain, { timeout: 8000 });
    // Detect whoiser-level ENOTFOUND (e.g. whois.nic.google for .dev → { error: "getaddrinfo ENOTFOUND ..." })
    const resultStr = JSON.stringify(result);
    if (resultStr.includes("ENOTFOUND") || resultStr.includes("EAI_AGAIN")) {
      console.log(`[domain] ${lookupDomain} WHOIS unsupported (ENOTFOUND): ${resultStr.slice(0, 200)}`);
      throw new Error("UNSUPPORTED: ENOTFOUND");
    }
    // whoiser returns object keyed by domain, or flat with expiry fields
    // Try multiple common keys: "Expiry Date", "Registry Expiry Date", "Expiration Date", "Expires On"
    const expiryRaw = extractExpiry(result, lookupDomain);
    if (!expiryRaw) {
      console.log(`[domain] ${lookupDomain} no expiry found in WHOIS result`);
      throw new Error("UNSUPPORTED: no expiry found");
    }
    const expiry = new Date(expiryRaw);
    if (isNaN(expiry.getTime())) {
      console.log(`[domain] ${lookupDomain} invalid expiry: ${expiryRaw}`);
      throw new Error("UNSUPPORTED: invalid expiry");
    }
    console.log(`[domain] ${lookupDomain} expires ${expiry.toISOString()}`);
    return expiry;
  } catch (err) {
    if (err.message && err.message.startsWith("UNSUPPORTED:")) throw err;
    if (err.message && (err.message.includes("ENOTFOUND") || err.message.includes("EAI_AGAIN"))) {
      throw new Error("UNSUPPORTED: " + err.message);
    }
    // Transient: timeout, ECONNREFUSED, etc. — don't mark UNSUPPORTED, allow retry next 24h
    console.log(`[domain] ${lookupDomain} WHOIS transient error: ${err.message}`);
    return null;
  }
}

function extractExpiry(result, domain) {
  if (!result || typeof result !== "object") return null;

  // whoiser shape: { "example.com": { "Expiry Date": "..." }, ... } or flat
  const obj = result[domain] && typeof result[domain] === "object" ? result[domain] : result;

  const candidates = [
    "Expiry Date",
    "Registry Expiry Date",
    "Expiration Date",
    "Expiration Time",
    "Expires On",
    "Registry Expiry Date ",
    "Registrar Registration Expiration Date",
    "Expiry",
  ];

  for (const key of candidates) {
    if (obj[key]) {
      const val = Array.isArray(obj[key]) ? obj[key][0] : obj[key];
      if (val) return val;
    }
  }

  // Fallback: scan all keys case-insensitive for "expir"
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes("expir") && v) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val) return val;
    }
  }

  // whoiser sometimes nests under "whois" or first key
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const nested = extractExpiry(v, domain);
      if (nested) return nested;
    }
  }

  return null;
}
