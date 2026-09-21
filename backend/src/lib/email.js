import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  return new Resend(process.env.RESEND_API_KEY);
}

function frontendBase() {
  const raw = process.env.FRONTEND_URL || "http://localhost:3000";
  return raw.split(",")[0].trim().replace(/\/$/, "");
}

export async function sendPasswordResetEmail(to, rawToken) {
  const link = `${frontendBase()}/reset-password?token=${rawToken}`;
  const resend = getResend();
  await resend.emails.send({
    from: "PulseCheck <alerts@mail.bhosalevedant.dev>",
    to,
    subject: "Reset your PulseCheck password",
    text: `You requested a password reset for PulseCheck.\n\nReset your password here (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>You requested a password reset for PulseCheck.</p><p><a href="${link}">Reset your password</a> — this link is valid for 1 hour.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

export async function sendVerificationEmail(to, rawToken) {
  const link = `${frontendBase()}/verify-email?token=${rawToken}`;
  const resend = getResend();
  await resend.emails.send({
    from: "PulseCheck <alerts@mail.bhosalevedant.dev>",
    to,
    subject: "Verify your PulseCheck email",
    text: `Welcome to PulseCheck! Please verify your email:\n${link}\n\nThis link is valid for 24 hours.`,
    html: `<p>Welcome to PulseCheck!</p><p><a href="${link}">Verify your email</a> — this link is valid for 24 hours.</p>`,
  });
}
