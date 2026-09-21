import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY missing");
  }
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Reusable alert sender — used by URL, heartbeat, and SSL/domain expiry paths.
 * Do not duplicate Resend logic elsewhere; import this.
 *
 * @param {object} target - { name, url?, slug?, user: { email } }
 * @param {"up"|"down"|string} newStatus — for expiry, pass stage name (WARNED_30D etc.) or "down"/"up"
 * @param {"monitor"|"heartbeat"|"ssl"|"domain"} kind
 */
export async function sendAlertEmail(target, newStatus, kind = "monitor") {
  const status = String(newStatus).toLowerCase();

  // Expiry kinds use stage names directly — map to subject/body below
  if (kind === "ssl" || kind === "domain") {
    const isExpired = status === "expired";
    const label = kind === "ssl" ? "SSL certificate" : "Domain";
    const stageLabel = String(newStatus);
    const subject = isExpired
      ? `🔴 ${target.name} ${label} EXPIRED`
      : `⚠️ ${target.name} ${label} expiring — ${stageLabel}`;
    const expiryDate = kind === "ssl" ? target.certExpiresAt : target.domainExpiresAt;
    const expiryStr = expiryDate ? new Date(expiryDate).toISOString().split("T")[0] : "unknown date";
    const body = isExpired
      ? `Your ${label.toLowerCase()} for "${target.name}" (${target.url}) has EXPIRED on ${expiryStr}. Renew immediately.`
      : `Your ${label.toLowerCase()} for "${target.name}" (${target.url}) is expiring on ${expiryStr} (stage: ${stageLabel}). Days remaining: ${target._daysRemaining ?? "?"}.`;
    try {
      const resend = getResend();
      await resend.emails.send({
        from: "PulseCheck <alerts@mail.bhosalevedant.dev>",
        to: target.user.email,
        subject,
        text: body,
      });
      console.log(`  → Alert email sent to ${target.user.email} [${kind} ${target.name} -> ${stageLabel}]`);
    } catch (err) {
      console.error(`  → Failed to send alert email:`, err.message);
    }
    return;
  }

  const isDown = status === "down";

  const identifier = target.url || (target.slug ? `slug:${target.slug}` : target.name);
  const subject = isDown ? `🔴 ${target.name} is DOWN` : `🟢 ${target.name} is back UP`;

  let body;
  if (kind === "heartbeat") {
    body = isDown
      ? `Your heartbeat monitor "${target.name}" (slug: ${target.slug}) missed its expected ping and is now marked DOWN.`
      : `Your heartbeat monitor "${target.name}" (slug: ${target.slug}) has recovered.`;
  } else {
    body = isDown
      ? `Your monitor "${target.name}" (${target.url}) just went down.`
      : `Your monitor "${target.name}" (${target.url}) has recovered.`;
  }

  try {
    const resend = getResend();
    await resend.emails.send({
      from: "PulseCheck <alerts@mail.bhosalevedant.dev>",
      to: target.user.email,
      subject,
      text: body,
    });
    console.log(`  → Alert email sent to ${target.user.email} [${kind} ${target.name} -> ${status}]`);
  } catch (err) {
    console.error(`  → Failed to send alert email:`, err.message);
  }
}
