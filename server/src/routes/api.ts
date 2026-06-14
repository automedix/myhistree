import { FastifyInstance } from "fastify";
import { db, logAudit, getAuditLog, applyRetention } from "../db/index";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sendAnamneseLink, sendConsentFormLink, sendVerificationCodeEmail, sendVerificationEmail, validateEmail } from "../email/sender";
import { isValidEmailSyntax } from "../email/sender";

const anamneseBody = z.record(z.any());
const auditQuery = z.object({ limit: z.string().optional(), offset: z.string().optional() });

async function requireAuth(request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

export default async function apiRoutes(fastify: FastifyInstance) {
  // ────────────────────────────────────────────────────────────────
  // Health
  fastify.get("/health", async () => ({ status: "ok", version: "0.6.7" }));

  // ─── Links ──────────────────────────────────────────────────────
  fastify.post("/link/create", { onRequest: requireAuth }, async (request, reply) => {
    const body = request.body as any;
    const { practiceId, pvsPatientId, patientDob, patientEmail, mobileNumber, expiresHours = 24, pin, documentType = "anamnese", consentFormId } = body;

    const practice = db.prepare("SELECT id FROM practices WHERE id = ?").get(practiceId) as { id: string } | undefined;
    if (!practice) return reply.status(404).send({ error: "Practice not found" });

    const token = randomUUID().replace(/-/g, "");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (parseInt(expiresHours) || 24));
    const pinHash = pin ? Buffer.from(pin).toString("base64") : null;

    db.prepare(`INSERT INTO patient_links (id, token, practice_id, pvs_patient_id, patient_dob, patient_email, mobile_number, pin, status, expires_at, document_type, consent_form_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), token, practiceId, pvsPatientId || null, patientDob || null, patientEmail || null, mobileNumber || null, pinHash, "pending", expiresAt.toISOString(), documentType, consentFormId || null);

    logAudit("CREATE_LINK", token, `PVS-ID: ${pvsPatientId}, Typ: ${documentType}, Email: ${patientEmail || "-"}`, undefined, request.ip);

    return { token, expiresAt: expiresAt.toISOString(), link: `/${documentType === "consent_form" ? "auffklaerung" : "anamnese"}/${token}`, pin: pin || null };
  });

  fastify.get("/link/list/:practiceId", { onRequest: requireAuth }, async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    return db.prepare(`SELECT token, pvs_patient_id, patient_dob, patient_email, mobile_number, status, document_type, consent_form_id, created_at, expires_at,
             CASE WHEN pin IS NOT NULL AND pin != '' THEN 1 ELSE 0 END as has_pin
      FROM patient_links WHERE practice_id = ? ORDER BY created_at DESC`).all(practiceId);
  });

  fastify.get("/link/validate/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = db.prepare(`SELECT l.*, p.name as practice_name, p.address, p.city, p.postal_code, p.phone, p.email as practice_email
      FROM patient_links l JOIN practices p ON l.practice_id = p.id WHERE l.token = ?`).get(token) as any;
    if (!link) return reply.status(404).send({ error: "Link not found" });
    if (new Date(link.expires_at) < new Date()) {
      db.prepare("UPDATE patient_links SET status = 'expired' WHERE id = ?").run(link.id);
      return reply.status(410).send({ error: "Link expired" });
    }
    if (link.status === "used") {
      const encounter = db.prepare("SELECT id, current_screen, document_type FROM encounters WHERE source_link_id = ? AND status = 'in-progress'").get(token) as any;
      if (encounter) {
        return { ...link, resume: true, encounterId: encounter.id, currentScreen: encounter.current_screen, documentType: encounter.document_type };
      }
      return reply.status(410).send({ error: "Link already used" });
    }
    if (link.status !== "pending") return reply.status(410).send({ error: "Link already used or expired" });
    return link;
  });

  fastify.post("/link/start", async (request, reply) => {
    const body = request.body as any;
    const link = db.prepare("SELECT * FROM patient_links WHERE token = ?").get(body.token) as any;
    if (!link) return reply.status(400).send({ error: "Invalid or expired link" });

    const dobInput = body.patientDob || "";
    const dobNormalized = dobInput.replace(/\./g, "-");
    if (link.patient_dob && link.patient_dob !== dobNormalized) {
      return reply.status(403).send({ error: "Date of birth does not match" });
    }
    if (link.pin) {
      const decodedPin = Buffer.from(link.pin, "base64").toString("utf8");
      if (decodedPin !== body.pin) return reply.status(403).send({ error: "Incorrect PIN" });
    }

    if (link.status === "used") {
      const encounter = db.prepare("SELECT id, patient_id, practice_id FROM encounters WHERE source_link_id = ? AND status = 'in-progress'").get(body.token) as any;
      if (encounter) {
        return { encounterId: encounter.id, patientId: encounter.patient_id, practiceId: encounter.practice_id, resume: true };
      }
      return reply.status(400).send({ error: "Invalid or expired link" });
    }

    if (link.status !== "pending") return reply.status(400).send({ error: "Invalid or expired link" });

    const patientId = randomUUID();
    db.prepare("INSERT INTO patients (id, pvs_patient_id, date_of_birth) VALUES (?, ?, ?)").run(patientId, link.pvs_patient_id, link.patient_dob);

    const encounterId = randomUUID();
    db.prepare("INSERT INTO encounters (id, patient_id, practice_id, source_link_id, status, document_type, consent_form_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(encounterId, patientId, link.practice_id, link.token, "in-progress", link.document_type || "anamnese", link.consent_form_id || null);
    db.prepare("UPDATE patient_links SET status = 'used', linked_at = datetime('now') WHERE id = ?")
      .run(link.id);

    logAudit("START_ANAMNESE", link.token, `Encounter: ${encounterId}, Typ: ${link.document_type || "anamnese"}`, undefined, request.ip);
    return { encounterId, patientId, practiceId: link.practice_id, documentType: link.document_type || "anamnese" };
  });

  // ─── Email Send ─────────────────────────────────────────────────
  fastify.post("/link/send-email", { onRequest: requireAuth }, async (request) => {
    const { to, pvsPatientId, linkUrl, patientDob, pin, documentType, consentFormId } = request.body as any;
    let result;
    if (documentType === "consent_form") {
      const template = consentFormId 
        ? db.prepare("SELECT title FROM consent_form_templates WHERE slug = ?").get(consentFormId) as any
        : null;
      result = await sendConsentFormLink(to, pvsPatientId, linkUrl, pin, template?.title);
    } else {
      result = await sendAnamneseLink(to, pvsPatientId, linkUrl, pin);
    }
    if (result.success) {
      logAudit("SEND_EMAIL", pvsPatientId, `to: ${to}, typ: ${documentType || "anamnese"}`, undefined, request.ip);
    }
    return result;
  });

  fastify.post("/email/send-code", async (request, reply) => {
    const body = request.body as any;
    const { encounterId, email } = body;
    if (!encounterId || !email) return reply.status(400).send({ error: "encounterId and email required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.status(400).send({ error: "Invalid email format" });

    const encounter = db.prepare("SELECT id, source_link_id FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });

    // Delete old unverified codes for this encounter+email
    db.prepare("DELETE FROM email_verifications WHERE encounter_id = ? AND email = ? AND verified = 0").run(encounterId, email);

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const magicToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    db.prepare(`INSERT INTO email_verifications (id, encounter_id, email, code, verified, attempts, expires_at, magic_token, link_token)
                VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`)
      .run(randomUUID(), encounterId, email, code, expiresAt.toISOString(), magicToken, encounter.source_link_id || null);

    const magicUrl = `https://myhistree-staging.example.com/anamnese/${encounter.source_link_id || ""}?verify=email&verifyToken=${magicToken}`;
    const result = await sendVerificationEmail(email, magicUrl);
    if (!result.success) {
      return reply.status(500).send({ error: result.error || "Failed to send email" });
    }

    logAudit("SEND_CODE", encounterId, `to: ${email}`, undefined, request.ip);
    return { success: true, message: "Verification link sent" };
  });

  fastify.post("/email/verify-code", async (request, reply) => {
    const body = request.body as any;
    const { encounterId, email, code } = body;
    if (!encounterId || !email || !code) return reply.status(400).send({ error: "encounterId, email and code required" });

    const row = db.prepare("SELECT * FROM email_verifications WHERE encounter_id = ? AND email = ? ORDER BY created_at DESC LIMIT 1").get(encounterId, email) as any;
    if (!row) return reply.status(404).send({ error: "No verification found" });
    if (row.verified) return reply.status(400).send({ error: "Already verified" });
    if (new Date(row.expires_at) < new Date()) return reply.status(410).send({ error: "Code expired" });

    const attempts = (row.attempts || 0) + 1;
    db.prepare("UPDATE email_verifications SET attempts = ? WHERE id = ?").run(attempts, row.id);

    if (attempts > 5) return reply.status(403).send({ error: "Too many attempts" });
    if (row.code !== code) return reply.status(400).send({ error: "Invalid code" });

    db.prepare("UPDATE email_verifications SET verified = 1 WHERE id = ?").run(row.id);
    logAudit("VERIFY_EMAIL", encounterId, email, undefined, request.ip);
    return { success: true, message: "Email verified" };
  });

  fastify.get("/email/verify-magic", async (request, reply) => {
    const { token } = request.query as any;
    if (!token) return reply.status(400).send({ error: "Token required" });

    const row = db.prepare("SELECT * FROM email_verifications WHERE magic_token = ?").get(token) as any;
    if (!row) return reply.status(404).send({ error: "Invalid or expired token" });
    if (row.verified) return reply.status(400).send({ error: "Already verified" });
    if (new Date(row.expires_at) < new Date()) return reply.status(410).send({ error: "Token expired" });

    db.prepare("UPDATE email_verifications SET verified = 1 WHERE id = ?").run(row.id);

    const encounter = db.prepare("SELECT id, source_link_id FROM encounters WHERE id = ?").get(row.encounter_id) as any;

    logAudit("VERIFY_EMAIL_MAGIC", row.encounter_id, row.email, undefined, request.ip);
    return { verified: true, encounterId: row.encounter_id, linkToken: encounter?.source_link_id || null };
  });

  fastify.post("/email/validate", async (request) => {
    const { email } = request.body as any;
    return await validateEmail(email);
  });

  // ─── Anamnese CRUD ──────────────────────────────────────────────
  fastify.get("/anamnese/:encounterId", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT * FROM encounters WHERE id = ?").get(encounterId);
    if (!encounter) return reply.status(404).send({ error: "Not found" });
    const responses = db.prepare("SELECT category, status, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId);
    return { encounter, responses };
  });

  fastify.post("/anamnese/:encounterId/complete", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    db.prepare("UPDATE encounters SET status = 'submitted', completed_at = datetime('now') WHERE id = ?").run(encounterId);
    logAudit("COMPLETE_ANAMNESE", encounterId, undefined, undefined, request.ip);
    return { success: true };
  });

  fastify.put("/anamnese/:encounterId/:category", async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const data = anamneseBody.parse(request.body);
    const existing = db.prepare("SELECT id FROM questionnaire_responses WHERE encounter_id = ? AND category = ?").get(encounterId, category) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE questionnaire_responses SET data = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(data), data.__completed ? "completed" : "draft", existing.id);
    } else {
      const encounter = db.prepare("SELECT patient_id FROM encounters WHERE id = ?").get(encounterId) as any;
      db.prepare("INSERT INTO questionnaire_responses (id, encounter_id, patient_id, category, status, data) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), encounterId, encounter.patient_id, category, data.__completed ? "completed" : "draft", JSON.stringify(data));
    }
    return { success: true };
  });

  fastify.get("/anamnese/:encounterId/:category", async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const row = db.prepare("SELECT data FROM questionnaire_responses WHERE encounter_id = ? AND category = ?").get(encounterId, category) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : {};
  });

  fastify.get("/anamnese/:encounterId/responses", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    const rows = db.prepare("SELECT category, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId) as { category: string; data: string }[];
    const result: Record<string, any> = {};
    for (const row of rows) result[row.category] = JSON.parse(row.data);
    return result;
  });

  // ─── Encounters ─────────────────────────────────────────────────
  fastify.get("/encounter/:encounterId", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    logAudit("VIEW_ENCOUNTER", encounterId, undefined, undefined, request.ip);
    const encounter = db.prepare("SELECT * FROM encounters WHERE id = ?").get(encounterId);
    if (!encounter) return { error: "Not found" };
    const responses = db.prepare("SELECT category, status, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId);
    return { encounter, responses: responses.map((r: any) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })) };
  });

  fastify.get("/encounters/:practiceId", async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    return db.prepare(`SELECT id, status, source_link_id, pvs_patient_id, document_type, consent_form_id, created_at, completed_at, processed_at
      FROM encounters WHERE practice_id = ? ORDER BY created_at DESC`).all(practiceId);
  });

  // ─── Admin ──────────────────────────────────────────────────────
  fastify.get("/admin/encounters/list/:practiceId", { onRequest: requireAuth }, async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`SELECT e.id, e.status, e.document_type, e.consent_form_id, e.source_link_id, e.created_at, e.updated_at, e.completed_at, e.processed_at, l.pvs_patient_id, l.patient_email, l.mobile_number,
      (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = 'contact' LIMIT 1) as contact_json
      FROM encounters e LEFT JOIN patient_links l ON e.source_link_id = l.token
      WHERE e.practice_id = ? ORDER BY e.created_at DESC`).all(practiceId);
    return rows;
  });

  fastify.get("/patients/list/:practiceId", { onRequest: requireAuth }, async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`SELECT p.id, p.pvs_patient_id, p.date_of_birth, p.created_at,
      (SELECT COUNT(*) FROM encounters WHERE patient_id = p.id) as encounter_count
      FROM patients p WHERE EXISTS (SELECT 1 FROM encounters WHERE patient_id = p.id AND practice_id = ?)
      ORDER BY p.created_at DESC`).all(practiceId);
    return rows;
  });

  fastify.get("/practices/list", { onRequest: requireAuth }, async () => {
    return db.prepare("SELECT id, name, address, city, postal_code, phone, email FROM practices").all();
  });

  // ─── Audit & Retention ──────────────────────────────────────────
  fastify.get("/audit/log", { onRequest: requireAuth }, async (request) => {
    const q = auditQuery.parse(request.query);
    return getAuditLog(parseInt(q.limit || "100"), parseInt(q.offset || "0"));
  });

  fastify.post("/admin/apply-retention", { onRequest: requireAuth }, async (request) => {
    const result = applyRetention();
    logAudit("APPLY_RETENTION", undefined, JSON.stringify(result), undefined, request.ip);
    return result;
  });

  // ─── Patient Rejection / Data Deletion ──────────────────────────
  fastify.post("/anamnese/:encounterId/reject", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT patient_id, source_link_id FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });

    // Delete all related data
    db.prepare("DELETE FROM questionnaire_responses WHERE encounter_id = ?").run(encounterId);
    db.prepare("DELETE FROM email_verifications WHERE encounter_id = ?").run(encounterId);
    db.prepare("DELETE FROM encounters WHERE id = ?").run(encounterId);
    db.prepare("DELETE FROM patients WHERE id = ?").run(encounter.patient_id);
    // Reset link to pending so patient can start fresh if needed
    if (encounter.source_link_id) {
      db.prepare("UPDATE patient_links SET status = 'pending', linked_at = NULL WHERE token = ?").run(encounter.source_link_id);
    }

    logAudit("REJECT_ANAMNESE", encounterId, `Patient: ${encounter.patient_id}`, undefined, request.ip);
    return { success: true, message: "All data deleted" };
  });

  // ─── Admin: Mark encounter as processed ─────────────────────────
  fastify.post("/admin/encounter/:encounterId/process", { onRequest: requireAuth }, async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT id FROM encounters WHERE id = ?").get(encounterId);
    if (!encounter) return reply.status(404).send({ error: "Not found" });
    db.prepare("UPDATE encounters SET status = 'processed', processed_at = datetime('now') WHERE id = ?").run(encounterId);
    logAudit("PROCESS_ENCOUNTER", encounterId, undefined, undefined, request.ip);
    return { success: true };
  });

  // ─── Patient Progress (Resume) ──────────────────────────────────
  fastify.get("/anamnese/:encounterId/progress", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT current_screen FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Not found" });
    const responses = db.prepare("SELECT category, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId) as any[];
    const data: Record<string, any> = {};
    for (const r of responses) data[r.category] = JSON.parse(r.data);
    return { currentScreen: encounter.current_screen, data };
  });

  fastify.post("/anamnese/:encounterId/progress", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const body = request.body as any;
    const { currentScreen } = body;
    const validScreens = [
      "language","origin","family_status","children","job","insurance",
      "symptoms","duration","conditions","operations","meds_bloodthin",
      "meds_bp","meds_asthma","meds_diabetes","meds_neuro","meds_pain",
      "meds_gynuro","meds_chol","meds_other","allergies","family",
      "lifestyle","lifestyle2","emergency","bodymetrics","contact",
      "notes","review","done"
    ];
    if (currentScreen && !validScreens.includes(currentScreen)) {
      return reply.status(400).send({ error: "Invalid screen identifier" });
    }
    db.prepare("UPDATE encounters SET current_screen = ? WHERE id = ?").run(currentScreen || null, encounterId);
    return { success: true };
  });

  // ─── Consent Forms ───────────────────────────────────────────────
  fastify.get("/consent-forms", async () => {
    const templates = db.prepare("SELECT id, slug, title, version FROM consent_form_templates ORDER BY title").all();
    return { templates };
  });

  fastify.get("/encounter-by-token/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const row = db.prepare(`
      SELECT e.id, e.status, e.document_type, e.consent_form_id, l.pvs_patient_id,
             t.title as consent_title, t.content_html as consent_html
      FROM encounters e
      JOIN patient_links l ON e.source_link_id = l.token
      LEFT JOIN consent_form_templates t ON t.slug = COALESCE(e.consent_form_id, 'standard-datenschutz')
      WHERE e.source_link_id = ?
    `).get(token) as any;
    if (!row) return reply.status(404).send({ error: "Not found" });
    const existing = db.prepare("SELECT patient_name, signed_at FROM consent_submissions WHERE encounter_id = ?").get(row.id) as any;
    return { ...row, alreadySubmitted: !!existing, submittedAt: existing?.signed_at || null };
  });

  fastify.post("/consent/:encounterId/submit", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const body = request.body as any;
    const { patientName, signatureSvg } = body;
    if (!patientName || patientName.trim().length < 2) return reply.status(400).send({ error: "Name required" });
    if (!signatureSvg || signatureSvg.length < 100) return reply.status(400).send({ error: "Signature required" });

    const encounter = db.prepare("SELECT id, status, document_type FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });
    if (encounter.status === "completed") return reply.status(409).send({ error: "Already submitted" });
    if (encounter.document_type !== "consent_form") return reply.status(400).send({ error: "Not a consent form encounter" });

    const ip = request.ip;
    const ua = request.headers["user-agent"] || "";
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO consent_submissions (encounter_id, patient_name, signature_svg, signed_at, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(encounter_id) DO UPDATE SET
                  patient_name = excluded.patient_name,
                  signature_svg = excluded.signature_svg,
                  signed_at = excluded.signed_at,
                  ip_address = excluded.ip_address,
                  user_agent = excluded.user_agent`).run(encounterId, patientName.trim(), signatureSvg, now, ip, ua);

    db.prepare("UPDATE encounters SET status = 'completed', completed_at = ? WHERE id = ?").run(now, encounterId);
    logAudit("CONSENT_SUBMIT", encounterId, patientName.trim(), undefined, request.ip);
    return { success: true, signedAt: now };
  });

  fastify.get("/consent/:encounterId", { onRequest: requireAuth }, async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare(`
      SELECT e.*, l.pvs_patient_id, c.patient_name, c.signature_svg, c.signed_at, c.ip_address, c.user_agent
      FROM encounters e
      LEFT JOIN patient_links l ON e.source_link_id = l.token
      LEFT JOIN consent_submissions c ON c.encounter_id = e.id
      WHERE e.id = ? AND e.document_type = 'consent_form'
    `).get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Not found" });

    const template = db.prepare("SELECT * FROM consent_form_templates WHERE slug = ?")
      .get(encounter.consent_form_id || "standard-datenschutz") as any;
    return { encounter, template };
  });

  // ─── Admin: User Management ─────────────────────────────────────
  fastify.get("/admin/users", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    return db.prepare("SELECT id, email, role, practice_id, totp_enabled, active, created_at FROM admin_users ORDER BY created_at DESC").all();
  });

  fastify.post("/admin/users", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as any;
    const { email, password, role = "user", practiceId = "demo-practice" } = body;
    if (!email || !password || password.length < 8) return reply.status(400).send({ error: "Email and password (min 8 chars) required" });
    const existing = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email);
    if (existing) return reply.status(409).send({ error: "Email already exists" });
    const bcrypt = require("bcrypt");
    const pepper = process.env.PASSWORD_PEPPER || (() => { throw new Error("PASSWORD_PEPPER environment variable is required"); })();
    const hash = await bcrypt.hash(password + pepper, 12);
    const id = randomUUID();
    db.prepare("INSERT INTO admin_users (id, email, password_hash, role, practice_id) VALUES (?, ?, ?, ?, ?)").run(id, email, hash, role, practiceId);
    logAudit("CREATE_USER", id, email, undefined, request.ip);
    return { id, email, role };
  });

  fastify.delete("/admin/users/:id", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const target = db.prepare("SELECT id, email FROM admin_users WHERE id = ?").get(id) as any;
    if (!target) return reply.status(404).send({ error: "Not found" });
    if (target.email === admin.email) return reply.status(400).send({ error: "Cannot delete yourself" });
    db.prepare("DELETE FROM admin_users WHERE id = ?").run(id);
    db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(id);
    logAudit("DELETE_USER", id, target.email, undefined, request.ip);
    return { success: true };
  });

  fastify.post("/admin/users/:id/reset-password", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const { newPassword } = body;
    if (!newPassword || newPassword.length < 8) return reply.status(400).send({ error: "Password min 8 chars" });
    const target = db.prepare("SELECT id FROM admin_users WHERE id = ?").get(id);
    if (!target) return reply.status(404).send({ error: "Not found" });
    const bcrypt = require("bcrypt");
    const pepper = process.env.PASSWORD_PEPPER || (() => { throw new Error("PASSWORD_PEPPER environment variable is required"); })();
    const hash = await bcrypt.hash(newPassword + pepper, 12);
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hash, id);
    db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(id);
    logAudit("RESET_PASSWORD", id, undefined, undefined, request.ip);
    return { success: true };
  });

  fastify.post("/admin/users/:id/toggle-active", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const target = db.prepare("SELECT id, email, active FROM admin_users WHERE id = ?").get(id) as any;
    if (!target) return reply.status(404).send({ error: "Not found" });
    if (target.email === admin.email) return reply.status(400).send({ error: "Cannot deactivate yourself" });
    const newActive = target.active === 0 ? 1 : 0;
    db.prepare("UPDATE admin_users SET active = ? WHERE id = ?").run(newActive, id);
    db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(id);
    logAudit(newActive === 1 ? "ACTIVATE_USER" : "DEACTIVATE_USER", id, target.email, undefined, request.ip);
    return { success: true, active: newActive };
  });

}