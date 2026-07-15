import nodemailer from "nodemailer";
import dns from "dns";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "";  const PRACTICE_NAME = process.env.BRAND_PRACTICE_NAME?.trim() || "Ihre Praxis";


interface RecallLinks { medflex: string; medatixx: string }
interface RecallTemplate {
  title: string;
  buildBody: (brand: string, links: RecallLinks) => { text: string; html: string };
}

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

// ─── Send Consent Form Link ─────────────────────────────────────
export async function sendConsentFormLink(
  to: string,
  pvsPatientId: string,
  linkUrl: string,
  patientDob?: string,
  pin?: string | null,
  formTitle?: string,
  practiceName?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isValidEmailSyntax(to)) {
    return { success: false, error: "Invalid email" };
  }
  const brand = practiceName || PRACTICE_NAME;
  const title = formTitle || "Aufklärungs- und Einwilligungsbogen";
  const pinBlock = pin ? `\nSicherheit: Bitte geben Sie zusätzlich die folgende PIN ein: ${pin}\n` : "";

  const textBody = `Guten Tag,\n\nvor Ihrem Termin bitten wir Sie, den folgenden ${title} zur Kenntnis zu nehmen und digital zu unterschreiben.\n\n🔗 Link zum Aufklärungsbogen:\n${linkUrl}\n${pinBlock}\nDer Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.\n\nSie können den Bogen bequem auf Ihrem Smartphone lesen und unterschreiben.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.link-box{background:#eff6ff;border-left:4px solid #4477BB;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;word-break:break-all}
.link-box a{color:#4477BB;font-weight:600;text-decoration:none}
.meta{background:#f1f5f9;padding:12px 16px;border-radius:8px;margin:12px 0;font-size:.9rem}
.meta strong{color:#1e293b}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">${brand}</div><h1>${title}</h1>
<p>Guten Tag,</p><p>vor Ihrem Termin bitten wir Sie, den folgenden Aufklärungsbogen zur Kenntnis zu nehmen und digital zu unterschreiben.</p>
<div class="link-box"><a href="${linkUrl}">${linkUrl}</a></div>
${pin ? `<p>Bitte geben: Sie zusätzlich folgende PIN ein: <strong>${pin}</strong></p>` : ""}
<p>Der Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.</p>
<p>Sie können den Bogen bequem auf Ihrem Smartphone lesen und unterschreiben.</p>
<div class="footer"><p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p style="font-size:.75rem;color:#94a3b8">Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: ${REPLY_TO}</p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: `${title} – ${brand}`,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Send Anamnese Link ─────────────────────────────────────────
export async function sendAnamneseLink(
  to: string,
  pvsPatientId: string,
  linkUrl: string,
  patientDob: string,
  pin?: string | null,
  practiceName?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validate = await validateEmail(to);
  if (!validate.valid) {
    return { success: false, error: validate.error };
  }
  const brand = practiceName || PRACTICE_NAME;
  const dobFormatted = patientDob
    ? new Date(patientDob).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })
    : "nicht angegeben";

  const pinBlock = pin
    ? `\nSicherheit: Bitte geben Sie zusätzlich die folgende PIN ein: ${pin}\n`
    : "";

  const textBody = `Guten Tag,\n\nSie haben bei uns einen Termin vereinbart. Um Ihren Arztbesuch effizienter zu gestalten, bitten wir Sie, vorab unsere digitale Anamnese auszufüllen.\n\n🔗 Link zur digitalen Anamnese:\n${linkUrl}\n${pinBlock}\nDer Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.\n\nDie Anamnese können Sie bequem auf Ihrem Smartphone, Tablet oder Computer ausfüllen. Ihre Daten werden verschlüsselt übertragen und ausschließlich für Ihre Behandlung verwendet.\n\nBei Fragen erreichen Sie uns telefonisch oder per E-Mail.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.link-box{background:#eff6ff;border-left:4px solid #4477BB;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;word-break:break-all}
.link-box a{color:#4477BB;font-weight:600;text-decoration:none}
.meta{background:#f1f5f9;padding:12px 16px;border-radius:8px;margin:12px 0;font-size:.9rem}
.meta strong{color:#1e293b}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">${brand}</div><h1>Digitale Anamnese – Vor Ihrem Termin</h1>
<p>Guten Tag,</p><p>Sie haben bei uns einen Termin vereinbart. Um Ihren Arztbesuch effizienter zu gestalten, bitten wir Sie, vorab unsere digitale Anamnese auszufüllen.</p>
<div class="link-box"><a href="${linkUrl}">${linkUrl}</a></div>
${pin ? `<p>Bitte geben: Sie zusätzlich folgende PIN ein: <strong>${pin}</strong></p>` : ""}
<p>Der Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.</p>
<p>Die Anamnese können Sie bequem auf Ihrem Smartphone, Tablet oder Computer ausfüllen. Ihre Daten werden verschlüsselt übertragen und ausschließlich für Ihre Behandlung verwendet.</p>
<div class="footer"><p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p style="font-size:.75rem;color:#94a3b8">Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: ${REPLY_TO}</p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: `Vorab-Anamnese für Ihren Termin – ${brand}`,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Send Bloodpressure Link ────────────────────────────────────
export async function sendBloodpressureLink(
  to: string,
  pvsPatientId: string,
  linkUrl: string,
  patientDob: string,
  pin?: string | null,
  practiceName?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validate = await validateEmail(to);
  if (!validate.valid) {
    return { success: false, error: validate.error };
  }
  const brand = practiceName || PRACTICE_NAME;

  const textBody = `Guten Tag,\n\nDokumentieren Sie bitte Ihren Blutdruck!\n\nerhöhter Blutdruck ist ein bedeutender Risikofaktor für die Entstehung einer ganzen Reihe von Erkrankungen. Arterienverkalkung (Kann zu Herzinfarkt und Schlaganfall führen), Nierenerkrankungen, Augenerkrankungen und einiges mehr können Folgen eines dauerhaft hohen Blutdrucks sein.\n\nDamit wir gemeinsam Ihren Blutdruck optimieren können, in dem wir ggf. eine Therapie beginnen oder anpassen, müssen wir zunächst eine Bestandsaufnahme machen. Am aussagekräftigsten sind Werte, die Sie zuhause in Ihrer gewohnten Umgebung und, ganz wichtig, in Ruhe messen.\n\nJe mehr Messwerte Sie dabei erheben, um so genauer wird das Bild, das wir von Ihrem Blutdruck erhalten. Nutzen Sie unsere Online-Blutdruckdokumentation, um Ihre Messwerte komfortabel zu dokumentieren und direkt an uns zu übertragen.\n\nLink zur Blutdruckdokumentation:\n${linkUrl}\n\nLöschen Sie diese Mail während des vereinbarten Dokumentationsintervalles nicht. Sie können über den Link immer wieder zu Ihrer Dokumentation gelangen. Alternativ können Sie den Link als Lesezeichen in Ihrem Browser, oder als Web-App auf dem Homescreen Ihres Smartphones ablegen. (Die Eingabe des Körpergewichtes ist optional)\n\nLegen Sie gleich los!\n\nMit freundlichen Grüssen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.link-box{background:#eff6ff;border-left:4px solid #4477BB;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;word-break:break-all}
.link-box a{color:#4477BB;font-weight:600;text-decoration:none}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">${brand}</div><h1>Dokumentieren Sie bitte Ihren Blutdruck!</h1>
<p>Liebe Patientin, lieber Patient,</p>
<p>erhöhter Blutdruck ist ein bedeutender Risikofaktor für die Entstehung einer ganzen Reihe von Erkrankungen. Arterienverkalkung (Kann zu Herzinfarkt und Schlaganfall führen), Nierenerkrankungen, Augenerkrankungen und einiges mehr können Folgen eines dauerhaft hohen Blutdrucks sein.</p>
<p>Damit wir gemeinsam Ihren Blutdruck optimieren können, in dem wir ggf. eine Therapie beginnen oder anpassen, müssen wir zunächst eine Bestandsaufnahme machen. Am aussagekräftigsten sind Werte, die Sie zuhause in Ihrer gewohnten Umgebung und, ganz wichtig, in Ruhe messen.</p>
<p>Je mehr Messwerte Sie dabei erheben, um so genauer wird das Bild, das wir von Ihrem Blutdruck erhalten. Nutzen Sie unsere Online-Blutdruckdokumentation, um Ihre Messwerte komfortabel zu dokumentieren und direkt an uns zu übertragen.</p>
<div class="link-box"><a href="${linkUrl}">${linkUrl}</a></div>
<p>Löschen Sie diese Mail während des vereinbarten Dokumentationsintervalles nicht. Sie können über den Link immer wieder zu Ihrer Dokumentation gelangen. Alternativ können Sie den Link als Lesezeichen in Ihrem Browser, oder als Web-App auf dem Homescreen Ihres Smartphones ablegen. (Die Eingabe des Körpergewichtes ist optional)</p>
<p><strong>Legen Sie gleich los!</strong></p>
<div class="footer"><p>Mit freundlichen Grüssen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p style="font-size:.75rem;color:#94a3b8">Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: ${REPLY_TO}</p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: `Dokumentieren Sie bitte Ihren Blutdruck! – ${brand}`,
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
  code: string,
  practiceName?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validate = await validateEmail(to);
  if (!validate.valid) {
    return { success: false, error: validate.error };
  }
  const brand = practiceName || PRACTICE_NAME;

  const textBody = `Guten Tag,\n\nvielen Dank für die Angabe Ihrer E-Mail-Adresse im Rahmen Ihrer digitalen Anamnese.\n\nUm sicherzustellen, dass wir Sie korrekt erreichen können, bitten wir Sie, den folgenden Code einzugeben:\n\n🔢 Verifizierungscode: ${code}\n\nDieser Code ist 30 Minuten gültig.\n\nFalls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.code-box{background:#eff6ff;border:2px dashed #4477BB;padding:20px;border-radius:12px;margin:20px 0;text-align:center}
.code-box .code{font-size:2rem;font-weight:700;color:#4477BB;letter-spacing:8px;font-family:monospace}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">${brand}</div><h1>E-Mail-Adresse bestätigen</h1>
<p>Guten Tag,</p><p>vielen Dank für die Angabe Ihrer E-Mail-Adresse im Rahmen Ihrer digitalen Anamnese.</p>
<p>Um sicherzustellen, dass wir Sie korrekt erreichen können, bitten wir Sie, den folgenden Code einzugeben:</p>
<div class="code-box"><div class="code">${code}</div></div>
<p style="font-size:.85rem;color:#94a3b8">Dieser Code ist 30 Minuten gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p>
<div class="footer"><p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p></div></div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: "Ihr Verifizierungscode – " + brand,
      text: textBody,
      html: htmlBody,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}


export async function sendVerificationEmail(
  to: string,
  magicUrl: string,
  practiceName?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isValidEmailSyntax(to)) {
    return { success: false, error: "Invalid email syntax" };
  }
  const brand = practiceName || PRACTICE_NAME;

  const html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E-Mail-Adresse bestätigen</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; padding: 20px; margin: 0;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color: #1e293b; margin-top: 0;">E-Mail-Adresse bestätigen</h2>
    <p style="color: #475569; line-height: 1.6;">
      Sie haben eine E-Mail-Verifizierung für Ihre Anamnese bei <strong>myhistree</strong> angefordert.
    </p>
    <p style="color: #475569; line-height: 1.6;">
      Bitte tippen Sie auf den folgenden Button, um Ihre E-Mail-Adresse zu bestätigen:
    </p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${magicUrl}" style="display: inline-block; background: #4477BB; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600;">
        E-Mail-Adresse bestätigen
      </a>
    </div>
    <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
      Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br>
      <a href="${magicUrl}" style="color: #4477BB; word-break: break-all;">${magicUrl}</a>
    </p>
    <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
      Dieser Link ist 30 Minuten gültig. Wenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.
    </p>
  </div>
</body>
</html>`;

  const text = `E-Mail-Adresse bestätigen\n\nBitte öffnen Sie den folgenden Link, um Ihre E-Mail-Adresse zu bestätigen:\n\n${magicUrl}\n\nDieser Link ist 30 Minuten gültig.`;

  try {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO || undefined,
      subject: "E-Mail-Adresse bestätigen – " + brand,
      text,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("[EMAIL] Failed to send verification email:", err);
    return { success: false, error: String(err) };
  }
}
// ─── Deximed ─────────────────────────────────────────────────────
export async function sendDeximedInfo(to: string, url: string, title: string, practiceName?: string): Promise<{ success: boolean; error?: string }> {
  const brand = practiceName || PRACTICE_NAME;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
p{font-size:.95rem;line-height:1.6;color:#475569;margin:8px 0}
.btn{display:inline-block;background:#4477BB;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600}
.link-box{margin:16px 0;word-break:break-all}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}</style></head>
<body><div class="container"><div class="logo">${brand}</div><h1>Patienteninformation: ${title}</h1>
<p>Guten Tag,</p><p>Ihr Arzt hat Ihnen folgende Patienteninformationen empfohlen:</p>
<div style="text-align:center;margin:28px 0;"><a href="${url}" class="btn">Patienteninformation öffnen</a></div>
<p style="font-size:.85rem;color:#64748b;">Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br><a href="${url}" style="color:#4477BB;word-break:break-all;">${url}</a></p>
<div class="footer">
<p style="font-size:.85rem;color:#475569;">Diese E-Mail enthält keine Diagnose oder Therapieempfehlung. Bitte wenden Sie sich bei Fragen an Ihren Arzt.</p>
<p style="font-size:.75rem;color:#94a3b8;margin-top:12px;">Diese Nachricht wurde automatisch erstellt. Auf Antworten wird nicht gelesen.</p>
</div></div></body></html>`;
  try {
    await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: `Patienteninformation: ${title}`,
      html,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "E-Mail konnte nicht gesendet werden" };
  }
}

const RECALL_TEMPLATES = {
    "impfung": {
        title: "Impfung fällig — Bitte Termin vereinbaren",
        buildBody: (brand: string, links: RecallLinks) => {
            const textBody = `Liebe Patientin, lieber Patient,\n\nWie geht es Ihnen? Lange nichts von Ihnen gehört!\n\nnach unserer Dokumentation ist bei Ihnen eine Impfung fällig.\n\nEin aktueller Impfschutz ist ein wichtiger Bestandteil Ihrer Gesundheitsvorsorge. Er schützt Sie nicht nur selbst, sondern trägt auch dazu bei, Ihr persönliches Umfeld und unsere Gemeinschaft vor Krankheiten zu bewahren.\n\nWir laden Sie herzlich ein, sich mit uns in Verbindung zu setzen, um einen Termin für Ihre Impfung zu vereinbaren.\n\nAm einfachsten und komfortabelsten erreichen Sie uns über unsere Online-Rezeption:\n  ${links.medflex || ""}\n\nAlternativ können Sie auch direkt über unser Terminbuchungsportal einen Termin buchen:\n  ${links.medatixx || ""}\n\nBitte tragen Sie bei einer Buchung über das Portal den Grund (Impftermin) ins Anmerkungsfeld ein.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;
            const medflexBtn = links.medflex ? `<a href="${links.medflex}" style="display:inline-block;background:#4477BB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:8px 0;">Online-Rezeption öffnen</a><div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${links.medflex}</div>` : "";
            const medatixxBtn = links.medatixx ? `<a href="${links.medatixx}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:8px 0;">Terminbuchung öffnen</a><div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${links.medatixx}</div>` : "";
            const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
.preamble{font-size:0.95rem;line-height:1.6;color:#334155;margin-bottom:16px}
.action-box{background:#f1f5f9;border-radius:12px;padding:16px;margin:16px 0;text-align:center}
.footer{font-size:0.8rem;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}
.footer a{color:#4477BB;text-decoration:none}
.copy-hint{font-size:0.75rem;color:#94a3b8;margin-top:4px}</style></head>
<body><div class="container">
<div class="logo">${brand}</div>
<h1>${RECALL_TEMPLATES["impfung"].title}</h1>
<div class="preamble">
<p>Liebe Patientin, lieber Patient,</p>
<p>Wie geht es Ihnen? Lange nichts von Ihnen gehört!</p>
<p>nach unserer Dokumentation ist bei Ihnen eine <strong>Impfung fällig</strong>.</p>
<p>Ein aktueller Impfschutz ist ein wichtiger Bestandteil Ihrer Gesundheitsvorsorge. Er schützt Sie nicht nur selbst, sondern trägt auch dazu bei, Ihr persönliches Umfeld und unsere Gemeinschaft vor Krankheiten zu bewahren.</p>
<p>Wir laden Sie herzlich ein, sich mit uns in Verbindung zu setzen, um einen Termin für Ihre Impfung zu vereinbaren.</p>
</div>
<div class="action-box">
<p style="margin:0 0 8px 0;font-weight:600;">Online-Rezeption</p>
${medflexBtn}
</div>
<div class="action-box">
<p style="margin:0 0 8px 0;font-weight:600;">Terminbuchung</p>
${medatixxBtn}
<p class="copy-hint">Bitte Grund (Impftermin) im Anmerkungsfeld angeben.</p>
</div>
<div class="footer">
<p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p>--<br>Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: <a href="mailto:${REPLY_TO}">${REPLY_TO}</a></p>
</div>
</div></body></html>`;
            return { text: textBody, html: htmlBody };
        }
    },
    "medikament": {
        title: "Therapieüberprüfung — Bitte Termin vereinbaren",
        buildBody: (brand: string, links: RecallLinks) => {
            const textBody = `Liebe Patientin, lieber Patient,\n\nWie geht es Ihnen? Lange nichts von Ihnen gehört!\n\nwir möchten, dass Sie durch unsere Praxis stets die bestmögliche Versorgung erhalten. Egal ob Sie schwer erkrankt sind oder nur an hohem Blutdruck leiden. Ob wir mit unserer Behandlung bei Ihnen richtig liegen, ob zum Beispiel die Dosierung eines Medikamentes, die wir irgendwann einmal angesetzt haben, noch die für Sie richtige ist, oder Sie vielleicht Nebenwirkungen haben, die Sie selbst gar nicht als solche wahrnehmen. Ob es in Ihrem Fall mittlerweile einen besser geeigneten Wirkstoff gibt, oder eine Konstellation eingetreten ist, die eine grundsätzlich andere Therapie erforderlich macht — All das möchten und müssen wir in regelmäßigen Abständen gemeinsam mit Ihnen überprüfen. Nicht zuletzt stehen wir auch zurecht für die Richtigkeit jeder Verordnung gerade. Möglicherweise haben Sie gerade ein Rezept bestellt. Sie waren nach unseren Aufzeichnungen jedoch lange nicht mehr bei uns in der Sprechstunde. Wir bitten Sie daher, möglichst kurzfristig einen Sprechstundentermin zu vereinbaren. So bleibt auch Ihre Medikamentenversorgung sichergestellt.\n\nVielen Dank für Ihr Verständnis!\n\nAm einfachsten und komfortabelsten erreichen Sie uns über unsere Online-Rezeption:\n  ${links.medflex || ""}\n\nAlternativ können Sie auch direkt über unser Terminbuchungsportal einen Termin buchen:\n  ${links.medatixx || ""}\n\nBitte tragen Sie bei einer Buchung über das Portal den Grund (Therapieüberprüfung) ins Anmerkungsfeld ein.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;
            const medflexBtn = links.medflex ? `<a href="${links.medflex}" style="display:inline-block;background:#4477BB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:8px 0;">Online-Rezeption öffnen</a><div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${links.medflex}</div>` : "";
            const medatixxBtn = links.medatixx ? `<a href="${links.medatixx}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:8px 0;">Terminbuchung öffnen</a><div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${links.medatixx}</div>` : "";
            const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
.preamble{font-size:0.95rem;line-height:1.6;color:#334155;margin-bottom:16px}
.action-box{background:#f1f5f9;border-radius:12px;padding:16px;margin:16px 0;text-align:center}
.footer{font-size:0.8rem;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}
.footer a{color:#4477BB;text-decoration:none}
.copy-hint{font-size:0.75rem;color:#94a3b8;margin-top:4px}</style></head>
<body><div class="container">
<div class="logo">${brand}</div>
<h1>${RECALL_TEMPLATES["medikament"].title}</h1>
<div class="preamble">
<p>Liebe Patientin, lieber Patient,</p>
<p>Wie geht es Ihnen? Lange nichts von Ihnen gehört!</p>
<p>wir möchten, dass Sie durch unsere Praxis stets die bestmögliche Versorgung erhalten. Egal ob Sie schwer erkrankt sind oder &quot;nur&quot; an hohem Blutdruck leiden. Ob wir mit unserer Behandlung bei Ihnen richtig liegen, ob zum Beispiel die Dosierung eines Medikamentes, die wir irgendwann einmal angesetzt haben, noch die für Sie richtige ist, oder Sie vielleicht Nebenwirkungen haben, die Sie selbst gar nicht als solche wahrnehmen. Ob es in Ihrem Fall mittlerweile einen besser geeigneten Wirkstoff gibt, oder eine Konstellation eingetreten ist, die eine grundsätzlich andere Therapie erforderlich macht - All das möchten und müssen wir in regelmäßigen Abständen gemeinsam mit Ihnen überprüfen. Nicht zuletzt stehen wir auch zurecht für die Richtigkeit jeder Verordnung gerade. Möglicherweise haben Sie gerade ein Rezept bestellt. Sie waren nach unseren Aufzeichnungen jedoch lange nicht mehr bei uns in der Sprechstunde. Wir bitten Sie daher, möglichst kurzfristig einen Sprechstundentermin zu vereinbaren. So bleibt auch Ihre Medikamentenversorgung sichergestellt.</p>
<p>Vielen Dank für Ihr Verständnis!</p>
</div>
<div class="action-box">
<p style="margin:0 0 8px 0;font-weight:600;">Online-Rezeption</p>
${medflexBtn}
</div>
<div class="action-box">
<p style="margin:0 0 8px 0;font-weight:600;">Terminbuchung</p>
${medatixxBtn}
<p class="copy-hint">Bitte Grund (Therapieüberprüfung) im Anmerkungsfeld angeben.</p>
</div>
<div class="footer">
<p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p>--<br>Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: <a href="mailto:${REPLY_TO}">${REPLY_TO}</a></p>
</div>
</div></body></html>`;
            return { text: textBody, html: htmlBody };
        }
    },
    "versichertenkarte": {
        title: "Versichertenkarte fehlt / Ersatzbescheinigung erforderlich",
        buildBody: (brand: string, links: RecallLinks) => {
            const textBody = `Sehr geehrte Patientin, sehr geehrter Patient,\n\nwir haben festgestellt, dass Ihre Versichertenkarte im aktuellen Quartal noch nicht bei uns eingelesen wurde. Dies ist zwingend erforderlich, damit wir Sie behandeln, und Ihnen Verordnungen ausstellen dürfen. Bitte kommen Sie dazu kurzfristig mit Ihrer Karte vorbei! Das Einlesen selbst geht ganz schnell.\nAlternativ können Sie uns auch eine sogenannte elektronische Ersatzbescheinigung senden. Wie das geht, erfahren Sie auf unserer Website unter: https://www.hausaerzte-im-grillepark.de/eeb oder im Servicecenter Ihrer gesetzlichen Krankenversicherung (GKV). Bei der Installation der App Ihrer GKV und der Ertüchtigung zum Versand von elektronischen Ersatzbescheinigungen hilft Ihnen gerne das Servicecenter Ihrer GKV. Den benötigten QR-Code zum Versand der Bescheinigung an unsere Praxis finden Sie ebenfalls auf unserer Website.\n\nVielen Dank für Ihr Verständnis und Ihre Kooperation!\n\nMit freundlichen Grüßen.\n\nIhre Hausärzte im Grillepark\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;
            const eebBtn = `<a href="https://www.hausaerzte-im-grillepark.de/eeb" style="display:inline-block;background:#4477BB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:8px 0;">EEB-Information öffnen</a><div style="font-size:0.8rem;color:#64748b;margin-top:4px;">https://www.hausaerzte-im-grillepark.de/eeb</div>`;
            const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segue UI,Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
.preamble{font-size:0.95rem;line-height:1.6;color:#334155;margin-bottom:16px}
.action-box{background:#f1f5f9;border-radius:12px;padding:16px;margin:16px 0;text-align:center}
.footer{font-size:0.8rem;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}
.footer a{color:#4477BB;text-decoration:none}</style></head>
<body><div class="container">
<div class="logo">${brand}</div>
<h1>Versichertenkarte fehlt / Ersatzbescheinigung erforderlich</h1>
<div class="preamble">
<p>Sehr geehrte Patientin, sehr geehrter Patient,</p>
<p>wir haben festgestellt, dass <strong>Ihre Versichertenkarte im aktuellen Quartal noch nicht bei uns eingelesen wurde</strong>. Dies ist zwingend erforderlich, damit wir Sie behandeln, und Ihnen Verordnungen ausstellen dürfen. Bitte kommen Sie dazu kurzfristig mit Ihrer Karte vorbei! Das Einlesen selbst geht ganz schnell.</p>
<p>Alternativ können Sie uns auch eine sogenannte <strong>elektronische Ersatzbescheinigung</strong> senden. Wie das geht, erfahren Sie auf unserer Website unter: <a href="https://www.hausaerzte-im-grillepark.de/eeb">https://www.hausaerzte-im-grillepark.de/eeb</a> oder im Servicecenter Ihrer gesetzlichen Krankenversicherung (GKV). Bei der Installation der App Ihrer GKV und der Ertüchtigung zum Versand von elektronischen Ersatzbescheinigungen hilft Ihnen gerne das Servicecenter Ihrer GKV. Den benötigten QR-Code zum Versand der Bescheinigung an unsere Praxis finden Sie ebenfalls auf unserer Website.</p>
<p>Vielen Dank für Ihr Verständnis und Ihre Kooperation!</p>
</div>
<div class="action-box">
<p style="margin:0 0 8px 0;font-weight:600;">Ersatzbescheinigung</p>
${eebBtn}
</div>
<div class="footer">
<p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p>--<br>Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: <a href="mailto:${REPLY_TO}">${REPLY_TO}</a></p>
</div>
</div></body></html>`;
            return { text: textBody, html: htmlBody };
        }
    }
};

export function getRecallTemplates(): { key: string; title: string }[] {
  return Object.entries(RECALL_TEMPLATES).map(([key, tmpl]) => ({
    key,
    title: (tmpl as any).title,
  }));
}

export async function sendRecallEmail(
  to: string,
  recallType: string,
  practiceName?: string,
  medflexUrl?: string,
  medatixxUrl?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isValidEmailSyntax(to)) {
    return { success: false, error: "Ungültige E-Mail-Adresse." };
  }
  const emailCheck = await validateEmail(to);
  if (!emailCheck.valid) {
    return { success: false, error: emailCheck.error };
  }
  const tmpl = (RECALL_TEMPLATES as any)[recallType];
  if (!tmpl) {
    return { success: false, error: "Unbekannter Recall-Typ." };
  }
  const brand = practiceName || PRACTICE_NAME;
  const body = tmpl.buildBody(brand, { medflex: medflexUrl || "", medatixx: medatixxUrl || "" });
  try {
    const info = await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO || undefined,
      subject: tmpl.title,
      text: body.text,
      html: body.html,
    });
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error("[EMAIL] Recall send error:", err);
    return { success: false, error: err.message || "E-Mail konnte nicht gesendet werden." };
  }

}

export async function sendQuoteLinkEmail(to: string, patientName: string, quoteTitle: string, linkUrl: string, practiceName: string): Promise<{ success: boolean; error?: string }> {
  if (!isValidEmailSyntax(to)) {
    return { success: false, error: "Ungültige E-Mail-Adresse." };
  }
  const brand = practiceName || PRACTICE_NAME;
  const textBody = `Liebe Patientin, lieber Patient${patientName ? " " + patientName : ""},\n\nim Anhang finden Sie Ihren Kostenvoranschlag von ${brand}.\n\nSie können den Kostenvoranschlag unter folgendem Link einsehen und digital unterschreiben:\n\n${linkUrl}\n\nDer Link ist 7 Tage gültig.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\n${brand}\n\n--\nDiese Nachricht wurde automatisch erstellt.\nAntworten bitte an: ${REPLY_TO}`;
  const htmlBody = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b}
.container{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.logo{font-size:1.3rem;font-weight:700;color:#4477BB;margin-bottom:24px}
h1{font-size:1.1rem;color:#1e293b;margin-bottom:12px}
.preamble{font-size:0.95rem;line-height:1.6;color:#334155;margin-bottom:16px}
.action-box{background:#f1f5f9;border-radius:12px;padding:16px;margin:16px 0;text-align:center}
.footer{font-size:0.8rem;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}
.footer a{color:#4477BB;text-decoration:none}</style></head>
<body><div class="container">
<div class="logo">${brand}</div>
<h1>${quoteTitle}</h1>
<div class="preamble">
<p>Liebe Patientin, lieber Patient${patientName ? " " + patientName : ""},</p>
<p>im Anhang finden Sie Ihren Kostenvoranschlag von <strong>${brand}</strong>.</p>
<p>Sie können den Kostenvoranschlag unter folgendem Link einsehen und digital unterschreiben:</p>
</div>
<div class="action-box">
<a href="${linkUrl}" style="display:inline-block;background:#4477BB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Kostenvoranschlag öffnen</a>
<div style="font-size:0.8rem;color:#64748b;margin-top:8px;word-break:break-all;">${linkUrl}</div>
</div>
<div class="footer">
<p>Der Link ist 7 Tage gültig.</p>
<p>Mit freundlichen Grüßen<br>Ihr Praxis-Team<br><strong>${brand}</strong></p>
<p>--<br>Diese Nachricht wurde automatisch erstellt.<br>Antworten bitte an: <a href="mailto:${REPLY_TO}">${REPLY_TO}</a></p>
</div>
</div></body></html>`;
  try {
    await transporter.sendMail({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      replyTo: REPLY_TO,
      subject: `${quoteTitle} – ${brand}`,
      text: textBody,
      html: htmlBody,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "E-Mail konnte nicht gesendet werden" };
  }
}
