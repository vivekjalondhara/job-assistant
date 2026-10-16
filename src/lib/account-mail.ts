import nodemailer from "nodemailer";
export function accountMailConfigured() {
  return !!(process.env.ACCOUNT_SMTP_HOST && process.env.ACCOUNT_MAIL_FROM);
}
export async function sendAccountLink(email: string, link: string, purpose: "invite" | "reset") {
  if (!accountMailConfigured()) return false;
  const transport = nodemailer.createTransport({
    host: process.env.ACCOUNT_SMTP_HOST,
    port: Number(process.env.ACCOUNT_SMTP_PORT || 587),
    secure: process.env.ACCOUNT_SMTP_SECURE === "true",
    ...(process.env.ACCOUNT_SMTP_USER
      ? { auth: { user: process.env.ACCOUNT_SMTP_USER, pass: process.env.ACCOUNT_SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  await transport.sendMail({
    from: process.env.ACCOUNT_MAIL_FROM,
    to: email,
    subject: purpose === "invite" ? "Your Folio workspace invitation" : "Reset your Folio password",
    text: `${purpose === "invite" ? "Your administrator invited you to Folio." : "A password reset was requested for your Folio account."}\n\nOpen this link to set your password:\n${link}\n\nThis link expires in 24 hours and can only be used once. If you did not expect this message, ignore it.`,
  });
  return true;
}
