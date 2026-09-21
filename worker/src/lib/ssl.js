import tls from "node:tls";

/**
 * Fetch SSL certificate expiry via Node's built-in tls.
 * No new dependency.
 * Returns Date | null — null on failure (log, don't wipe existing data).
 */
export async function fetchCertExpiry(hostname, port = 443, timeoutMs = 8000) {
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
        host: hostname,
        port,
        servername: hostname, // SNI
        rejectUnauthorized: false, // we want expiry even for self-signed; don't crash
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            console.log(`[ssl] ${hostname} no cert valid_to`);
            finish(null);
            return;
          }
          const expiry = new Date(cert.valid_to);
          if (isNaN(expiry.getTime())) {
            console.log(`[ssl] ${hostname} invalid valid_to: ${cert.valid_to}`);
            finish(null);
            return;
          }
          console.log(`[ssl] ${hostname} cert expires ${expiry.toISOString()}`);
          finish(expiry);
        } catch (err) {
          console.log(`[ssl] ${hostname} cert parse failed: ${err.message}`);
          finish(null);
        }
      }
    );

    socket.setTimeout(timeoutMs, () => {
      console.log(`[ssl] ${hostname} TLS timeout after ${timeoutMs}ms`);
      finish(null);
    });

    socket.on("error", (err) => {
      console.log(`[ssl] ${hostname} TLS error: ${err.message}`);
      finish(null);
    });
  });
}
