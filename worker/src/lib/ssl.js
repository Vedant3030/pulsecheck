import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { isPublicIp } from "./ssrfGuard.js";

/**
 * Fetch SSL certificate expiry via Node's built-in tls.
 * No new dependency.
 * Returns Date | null — null on failure (log, don't wipe existing data).
 *
 * SSRF-hardened: the host is resolved and every address must be public
 * before connecting, and the socket dials the validated IP (not the
 * hostname, which could re-resolve to something else). SNI still carries
 * the hostname so expiry reads work as before — except for literal-IP
 * hosts, where servername is omitted (SNI with an IP literal is invalid).
 */
export async function fetchCertExpiry(hostname, port = 443, timeoutMs = 8000) {
  let host = String(hostname || "").trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "") {
    console.log(`[ssl] empty hostname`);
    return null;
  }

  const isLiteralIp = net.isIP(host) !== 0;
  let connectHost = host;
  if (isLiteralIp) {
    if (!isPublicIp(host)) {
      console.log(`[ssl] ${host} blocked: non-public address`);
      return null;
    }
  } else {
    let records;
    try {
      records = await dns.promises.lookup(host, { all: true });
    } catch {
      console.log(`[ssl] ${host} DNS lookup failed`);
      return null;
    }
    if (!records || records.length === 0 || records.some((r) => !isPublicIp(r.address))) {
      console.log(`[ssl] ${host} blocked: non-public address`);
      return null;
    }
    connectHost = records[0].address;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };

    const socket = tls.connect(
      {
        host: connectHost,
        port,
        // SNI carries the DNS name so virtual-hosted certs resolve as
        // before. Omitted for literal-IP hosts (SNI with an IP is invalid).
        ...(isLiteralIp ? {} : { servername: host }),
        rejectUnauthorized: false, // we want expiry even for self-signed; don't crash
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            console.log(`[ssl] ${host} no cert valid_to`);
            finish(null);
            return;
          }
          const expiry = new Date(cert.valid_to);
          if (isNaN(expiry.getTime())) {
            console.log(`[ssl] ${host} invalid valid_to: ${cert.valid_to}`);
            finish(null);
            return;
          }
          console.log(`[ssl] ${host} cert expires ${expiry.toISOString()}`);
          finish(expiry);
        } catch (err) {
          console.log(`[ssl] ${host} cert parse failed: ${err.message}`);
          finish(null);
        }
      }
    );

    socket.setTimeout(timeoutMs, () => {
      console.log(`[ssl] ${host} TLS timeout after ${timeoutMs}ms`);
      finish(null);
    });

    socket.on("error", (err) => {
      console.log(`[ssl] ${host} TLS error: ${err.message}`);
      finish(null);
    });
  });
}
