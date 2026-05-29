import nodemailer from "nodemailer";
import dns from "dns";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "";

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.warn("[EMAIL] SMTP credentials not configured. Email sending will fail.");
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: true },
});

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmailSyntax(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export async function hasValidMxRecord(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const mx = await resolveMx(domain);
    return mx.length > 0;
  } catch {
    return false;
  }
}

export async function validateEmail(email: string): Promise<{ valid: boolean; error?: string }> {
  if (!email || !email.includes("@")) {
    return { valid: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }
  if (!isValidEmailSyntax(email)) {
    return { valid: false, error: "Die E-Mail-Adresse enthält ungültige Zeichen." };
  }
  const hasMx = await hasValidMxRecord(email);
  if (!hasMx) {
    return { valid: false, error: "Die Domain der E-Mail-Adresse existiert nicht oder akzeptiert keine E-Mails." };
  }
  return { valid: true };
}

// ─── Send Anamnese Link ─────────────────────────────────────────
export async function sendAnamneseLink(
  to: string,
  pvsPatientId: string,
  linkUrl: string,
  patientDob: string,
  pin?: string | null
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validate = await validateEmail(to);
  if (!validate.valid) {
    return { success: false, error: validate.error };
  }

  const dobFormatted = patientDob
    ? new Date(patientDob).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })
    : "nicht angegeben";

  const pinBlock = pin
    ? `\n🔐 Sicherheit: Bitte geben Sie zusätzlich die folgende PIN ein: ${pin}\n`
    : "";

  const textBody = `Guten Tag,\n\nSie haben bei uns einen Termin vereinbart. Um Ihren Arztbesuch effizienter zu gestalten, bitten wir Sie, vorab unsere digitale Anamnese auszufüllen.\n\nIhre Praxis-Patienten-ID: ${pvsPatientId}\nGeburtsdatum: ${dobFormatted}\n\n🔗 Link zur digitalen Anamnese:\n${linkUrl}\n${pinBlock}\nDer Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.\n\nDie Anamnese können Sie bequem auf Ihrem Smartphone, Tablet oder Computer ausfüllen. Ihre Daten werden verschlüsselt übertragen und ausschließlich für Ihre Behandlung verwendet.\n\nBei Fragen erreichen Sie uns telefonisch oder per E-Mail.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\nHausärzte im Grillepark\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#1E3A5F;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.link-box{background:#eff6ff;border-left:4px solid #1E3A5F;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;word-break:break-all}
.link-box a{color:#1E3A5F;font-weight:600;text-decoration:none}
.meta{background:#f1f5f9;padding:12px 16px;border-radius:8px;margin:12px 0;font-size:.9rem}
.meta strong{color:#1e293b}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">🏥 Hausärzte im Grillepark</div><h1>Digitale Anamnese – Vor Ihrem Termin</h1>
<p>Guten Tag,</p><p>Sie haben bei uns einen Termin vereinbart. Um Ihren Arztbesuch effizienter zu gestalten, bitten wir Sie, vorab unsere digitale Anamnese auszufüllen.</p>
<div class="meta"><div><strong>Praxis-Patienten-ID:</strong> ${pvsPatientId}</div><div><strong>Geburtsdatum:</strong> ${dobFormatted}</div></div>
<div class="link-box"><a href="${linkUrl}">${linkUrl}</a></div>
${pin ? `<p>🔐 Bitte geben Sie zusätzlich folgende PIN ein: <strong>${pin}</strong></p>` : ""}
<p>Der Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.</p>
<p>Die Anamnese können Sie bequem auf Ihrem Smartphone, Tablet oder Computer ausfüllen. Ihre Daten werden verschlüsselt übertragen und ausschließlich für Ihre Behandlung verwendet.</p>
<div class="footer"><p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>Hausärzte im Grillepark</strong></p>
<p style="font-size:.75rem;color:#94a3b8">Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: ${REPLY_TO}</p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: "Vorab-Anamnese für Ihren Termin – Hausärzte im Grillepark",
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Send Verification Code Email ───────────────────────────────
export async function sendVerificationCodeEmail(
  to: string,
  code: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validate = await validateEmail(to);
  if (!validate.valid) {
    return { success: false, error: validate.error };
  }

  const textBody = `Guten Tag,\n\nvielen Dank für die Angabe Ihrer E-Mail-Adresse im Rahmen Ihrer digitalen Anamnese.\n\nUm sicherzustellen, dass wir Sie korrekt erreichen können, bitten wir Sie, den folgenden Code einzugeben:\n\n🔢 Verifizierungscode: ${code}\n\nDieser Code ist 30 Minuten gültig.\n\nFalls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\nHausärzte im Grillepark\n\n--\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#1E3A5F;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.code-box{background:#eff6ff;border:2px dashed #1E3A5F;padding:20px;border-radius:12px;margin:20px 0;text-align:center}
.code-box .code{font-size:2rem;font-weight:700;color:#1E3A5F;letter-spacing:8px;font-family:monospace}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">🏥 Hausärzte im Grillepark</div><h1>E-Mail-Adresse bestätigen</h1>
<p>Guten Tag,</p><p>vielen Dank für die Angabe Ihrer E-Mail-Adresse im Rahmen Ihrer digitalen Anamnese.</p>
<p>Um sicherzustellen, dass wir Sie korrekt erreichen können, bitten wir Sie, den folgenden Code einzugeben:</p>
<div class="code-box"><div class="code">${code}</div></div>
<p style="font-size:.85rem;color:#94a3b8">Dieser Code ist 30 Minuten gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>
<div class="footer"><p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>Hausärzte im Grillepark</strong></p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: "Ihr Verifizierungscode – Hausärzte im Grillepark",
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
