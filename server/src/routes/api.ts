import { FastifyInstance } from "fastify";
import { db, logAudit, getAuditLog, applyRetention } from "../db/index";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sendAnamneseLink, sendBloodpressureLink, sendConsentFormLink, sendVerificationCodeEmail, sendVerificationEmail, validateEmail, sendDeximedInfo, getRecallTemplates, sendRecallEmail } from "../email/sender";
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

    const linkPath = documentType === "consent_form" ? "aufklaerung" : (documentType === "behandlungsvertrag" ? "behandlungsvertrag" : (documentType === "bloodpressure" ? "blutdruck" : "anamnese"));
    return { token, expiresAt: expiresAt.toISOString(), link: `/${linkPath}/${token}`, pin: pin || null };
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
        delete link.patient_dob; return { ...link, resume: true, encounterId: encounter.id, currentScreen: encounter.current_screen, documentType: encounter.document_type };
      }
      return reply.status(410).send({ error: "Link already used" });
    }
    if (link.status !== "pending") return reply.status(410).send({ error: "Link already used or expired" });
    delete link.patient_dob; return link;
  });

  fastify.post("/link/start", async (request, reply) => {
    const body = request.body as any;
    const link = db.prepare("SELECT * FROM patient_links WHERE token = ?").get(body.token) as any;
    if (!link) return reply.status(400).send({ error: "Invalid or expired link" });

    const dobInput = (body.patientDob || "").trim();
    let dobNormalized = dobInput;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dobInput)) {
      const parts = dobInput.split('.');
      dobNormalized = `${parts[2]}-${parts[1]}-${parts[0]}`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput)) {
      return reply.status(400).send({ error: "Ungültiges Geburtsdatum. Format: TT.MM.JJJJ oder YYYY-MM-DD" });
    }
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
    db.prepare("INSERT INTO encounters (id, patient_id, practice_id, source_link_id, pvs_patient_id, status, document_type, consent_form_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(encounterId, patientId, link.practice_id, link.token, link.pvs_patient_id || null, "in-progress", link.document_type || "anamnese", link.consent_form_id || null);
    db.prepare("UPDATE patient_links SET status = 'used', linked_at = datetime('now') WHERE id = ?")
      .run(link.id);

    logAudit("START_ANAMNESE", link.token, `Encounter: ${encounterId}, Typ: ${link.document_type || "anamnese"}`, undefined, request.ip);
    return { encounterId, patientId, practiceId: link.practice_id, documentType: link.document_type || "anamnese" };
  });

  // ─── Email Send ─────────────────────────────────────────────────
  fastify.post("/link/send-email", { onRequest: requireAuth }, async (request, reply) => {
    const { to, pvsPatientId, linkUrl, patientDob, pin, documentType, consentFormId } = request.body as any;
    if (!to || !linkUrl) return reply.status(400).send({ error: "E-Mail und Link-URL sind erforderlich" });
    const emailCheck = await validateEmail(to);
    if (!emailCheck.valid) return reply.status(400).send({ error: emailCheck.error });
    let result;
    const practiceRow = db.prepare("SELECT name FROM practices ORDER BY id ASC LIMIT 1").get() as any;
    const practiceName = practiceRow?.name || "";
    if (documentType === "consent_form") {
      const template = consentFormId 
        ? db.prepare("SELECT title FROM consent_form_templates WHERE slug = ?").get(consentFormId) as any
        : null;
      result = await sendConsentFormLink(to, pvsPatientId, linkUrl, undefined, pin, template?.title, practiceName);
    } else if (documentType === "bloodpressure") {
      result = await sendBloodpressureLink(to, pvsPatientId, linkUrl, patientDob, pin, practiceName);
    } else if (documentType === "behandlungsvertrag") {
      result = await sendConsentFormLink(to, pvsPatientId, linkUrl, undefined, pin, "Behandlungsvertrag", practiceName);
    } else {
      result = await sendAnamneseLink(to, pvsPatientId, linkUrl, patientDob, pin, practiceName);
    }
    if (result.success) {
      logAudit("SEND_EMAIL", pvsPatientId, `to: ${to}, typ: ${documentType || "anamnese"}`, (request as any).user?.email, request.ip);
      return result;
    } else {
      return reply.status(500).send({ error: result.error || "E-Mail konnte nicht gesendet werden" });
    }
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

    const baseUrl = process.env.BASE_URL || `https://${request.hostname || request.headers.host || "localhost"}`;
    const magicUrl = `${baseUrl}/anamnese/${encounter.source_link_id || ""}?verify=email&verifyToken=${magicToken}`;
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
    db.prepare("UPDATE encounters SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(encounterId);
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
      (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = 'contact' LIMIT 1) as contact_json,
      t.title as consent_title
      FROM encounters e LEFT JOIN patient_links l ON e.source_link_id = l.token
      LEFT JOIN consent_form_templates t ON t.slug = e.consent_form_id
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
    return db.prepare("SELECT id, name, address, city, postal_code, phone, email, ki_provider_name, ki_product_name, ki_manufacturer, ki_model_provider, ki_processing_location, ki_third_country_transfer FROM practices").all();
  });

  fastify.get("/practice/:practiceId/settings", { onRequest: requireAuth }, async (request, reply) => {
    const { practiceId } = request.params as { practiceId: string };
    const row = db.prepare("SELECT name, address, city, postal_code, phone, email, ki_provider_name, ki_product_name, ki_manufacturer, ki_model_provider, ki_processing_location, ki_third_country_transfer, smtp_host, smtp_port, smtp_user, smtp_pass, email_from_name, email_reply_to FROM practices WHERE id = ?").get(practiceId) as any;
    if (!row) return reply.status(404).send({ error: "Practice not found" });
    return row;
  });

  fastify.post("/practice/:practiceId/settings", { onRequest: requireAuth }, async (request, reply) => {
    const { practiceId } = request.params as { practiceId: string };
    const { name, email, address, phone, postalCode, city, smtpHost, smtpPort, smtpUser, smtpPass, fromName, replyTo, kiProviderName, kiProductName, kiManufacturer, kiModelProvider, kiProcessingLocation, kiThirdCountryTransfer } = request.body as any;
    db.prepare(`UPDATE practices SET
      name = ?,
      email = ?,
      address = ?,
      phone = ?,
      postal_code = ?,
      city = ?,
      smtp_host = ?,
      smtp_port = ?,
      smtp_user = ?,
      smtp_pass = ?,
      email_from_name = ?,
      email_reply_to = ?,
      ki_provider_name = ?,
      ki_product_name = ?,
      ki_manufacturer = ?,
      ki_model_provider = ?,
      ki_processing_location = ?,
      ki_third_country_transfer = ?
      WHERE id = ?`)
    .run(name, email, address, phone, postalCode, city, smtpHost, smtpPort, smtpUser, smtpPass, fromName, replyTo, kiProviderName, kiProductName, kiManufacturer, kiModelProvider, kiProcessingLocation, kiThirdCountryTransfer, practiceId);
    logAudit("UPDATE_SETTINGS", practiceId, undefined, undefined, request.ip);
    return { success: true };
  });

  fastify.post("/practice/:practiceId/test-email", { onRequest: requireAuth }, async (request, reply) => {
    const { practiceId } = request.params as { practiceId: string };
    const { to } = request.body as { to?: string };
    if (!to) return reply.status(400).send({ error: "Recipient required" });
    const result = await sendConsentFormLink(to, "", "", "", "Test-E-Mail");
    if (result.success) {
      logAudit("TEST_EMAIL", practiceId, to, undefined, request.ip);
      return { success: true };
    }
    return reply.status(500).send({ error: result.error || "Failed to send email" });
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
      SELECT e.id, e.status, e.document_type, e.consent_form_id, l.pvs_patient_id, e.practice_id,
             t.title as consent_title, t.content_html as consent_html
      FROM encounters e
      JOIN patient_links l ON e.source_link_id = l.token
      LEFT JOIN consent_form_templates t ON t.slug = COALESCE(e.consent_form_id, 'standard-datenschutz')
      WHERE e.source_link_id = ?
    `).get(token) as any;
    if (!row) return reply.status(404).send({ error: "Not found" });
    const existing = db.prepare("SELECT patient_name, signed_at FROM consent_submissions WHERE encounter_id = ?").get(row.id) as any;
    if (row.consent_html && row.practice_id) {
      const practice = db.prepare("SELECT name, address, city, postal_code, phone, email, ki_provider_name, ki_product_name, ki_manufacturer, ki_model_provider, ki_processing_location, ki_third_country_transfer FROM practices WHERE id = ?").get(row.practice_id) as any;
      if (practice) {
        const fullAddr = [practice.address, ((practice.postal_code && practice.city) ? `${practice.postal_code} ${practice.city}` : practice.city || practice.postal_code)].filter(Boolean).join(', ');
        function esc(s: string | null | undefined): string {
          if (!s) return '';
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        function val(s: string | null | undefined): string {
          return esc(s && s.trim() ? s.trim() : 'Keine Angabe');
        }
        let kiTransfer = practice.ki_third_country_transfer;
        if (kiTransfer === "yes" || kiTransfer === "ja") kiTransfer = "Ja";
        else if (kiTransfer === "no" || kiTransfer === "nein") kiTransfer = "Nein";
        // KI-Daten (Abschnitt 2)
        row.consent_html = row.consent_html.replace(
          /Wir setzen das Produkt <strong>{{KI_PRODUKTNAME}}<\/strong> der {{KI_HERSTELLER}} ein/,
          `Wir setzen das Produkt <strong>${val(practice.ki_product_name)}</strong> der ${val(practice.ki_manufacturer)} ein`
        );
        // KI-Daten (Abschnitt 3)
        row.consent_html = row.consent_html.replace(
          /<li><strong>Produktname:<\/strong> {{KI_PRODUKTNAME}}<\/li>/,
          `<li><strong>Produktname:</strong> ${val(practice.ki_product_name)}</li>`
        );
        row.consent_html = row.consent_html.replace(
          /<li><strong>Hersteller \/ Anbieter:<\/strong> {{KI_HERSTELLER}}<\/li>/,
          `<li><strong>Hersteller / Anbieter:</strong> ${val(practice.ki_manufacturer)}</li>`
        );
        row.consent_html = row.consent_html.replace(
          /<li><strong>KI-Anbieter \(Speech-to-Text &(?:amp;)? KI-Modell\):<\/strong> {{KI_MODELL_ANBIETER}}<\/li>/,
          `<li><strong>KI-Anbieter (Speech-to-Text &amp; KI-Modell):</strong> ${val(practice.ki_model_provider)}</li>`
        );
        row.consent_html = row.consent_html.replace(
          /<li><strong>Verarbeitungsort:<\/strong> {{KI_VERARBEITUNGSORT}}<\/li>/,
          `<li><strong>Verarbeitungsort:</strong> ${val(practice.ki_processing_location)}</li>`
        );
        row.consent_html = row.consent_html.replace(
          /<li><strong>Drittlandübermittlung:<\/strong> {{KI_DRITTLANDUEBERMITTLUNG}}<\/li>/,
          `<li><strong>Drittlandübermittlung:</strong> ${val(kiTransfer)}</li>`
        );
      }
    }
    return { ...row, alreadySubmitted: !!existing, submittedAt: existing?.signed_at || null };
  });

  fastify.post("/consent/:encounterId/submit", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const body = request.body as any;
    const { patientName, signatureSvg, consentItems } = body;
    if (!patientName || patientName.trim().length < 2) return reply.status(400).send({ error: "Name required" });
    if (!signatureSvg || signatureSvg.length < 100) return reply.status(400).send({ error: "Signature required" });

    // Validate SVG format to prevent stored XSS from manipulated client payloads
    const trimmedSvg = signatureSvg.trim();
    if (!trimmedSvg.startsWith("<svg") || !trimmedSvg.includes("</svg>")) {
      return reply.status(400).send({ error: "Invalid SVG format" });
    }
    if (
      /<script\b/i.test(trimmedSvg) ||
      /\bon\w+\s*=/i.test(trimmedSvg) ||
      /javascript:/i.test(trimmedSvg)
    ) {
      return reply.status(400).send({ error: "Invalid SVG content" });
    }
    const hrefMatch = trimmedSvg.match(/href="([^"]+)"/i);
    if (!hrefMatch || !hrefMatch[1].startsWith("data:image/png;base64,")) {
      return reply.status(400).send({ error: "Invalid image source in SVG" });
    }

    const encounter = db.prepare("SELECT id, status, document_type FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });
    if (encounter.status === "completed") return reply.status(409).send({ error: "Already submitted" });
    if (encounter.document_type !== "consent_form") return reply.status(400).send({ error: "Not a consent form encounter" });

    const ip = request.ip;
    const ua = request.headers["user-agent"] || "";
    const now = new Date().toISOString();
    const consentItemsJson = consentItems ? JSON.stringify(consentItems) : null;

    db.prepare(`INSERT INTO consent_submissions (encounter_id, patient_name, signature_svg, signed_at, ip_address, user_agent, consent_items)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(encounter_id) DO UPDATE SET
                  patient_name = excluded.patient_name,
                  signature_svg = excluded.signature_svg,
                  signed_at = excluded.signed_at,
                  ip_address = excluded.ip_address,
                  user_agent = excluded.user_agent,
                  consent_items = excluded.consent_items`).run(encounterId, patientName.trim(), signatureSvg, now, ip, ua, consentItemsJson);

    db.prepare("UPDATE encounters SET status = 'completed', completed_at = ? WHERE id = ?").run(now, encounterId);
    logAudit("CONSENT_SUBMIT", encounterId, patientName.trim(), undefined, request.ip);
    return { success: true, signedAt: now };
  });

  fastify.post("/behandlungsvertrag/:encounterId/submit", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const body = request.body as any;
    const { patientName, signatureSvg, tariff, multiplier } = body;
    if (!patientName || patientName.trim().length < 2) return reply.status(400).send({ error: "Name required" });
    if (!signatureSvg || signatureSvg.length < 100) return reply.status(400).send({ error: "Signature required" });
    if (!tariff || !["regelsatz", "standardtarif", "basistarif"].includes(tariff)) return reply.status(400).send({ error: "Invalid tariff" });
    if (tariff === "standardtarif") {
      const m = parseFloat(multiplier);
      if (isNaN(m) || m < 1.0 || m > 3.5) return reply.status(400).send({ error: "Multiplier must be between 1.0 and 3.5" });
    }
    const trimmedSvg = signatureSvg.trim();
    if (!trimmedSvg.startsWith("<svg") || !trimmedSvg.includes("</svg>")) {
      return reply.status(400).send({ error: "Invalid SVG format" });
    }
    if (
      /<script\b/i.test(trimmedSvg) ||
      /\bon\w+\s*=/i.test(trimmedSvg) ||
      /javascript:/i.test(trimmedSvg)
    ) {
      return reply.status(400).send({ error: "Invalid SVG content" });
    }
    const hrefMatch = trimmedSvg.match(/href="([^"]+)"/i);
    if (!hrefMatch || !hrefMatch[1].startsWith("data:image/png;base64,")) {
      return reply.status(400).send({ error: "Invalid image source in SVG" });
    }
    const encounter = db.prepare("SELECT id, status, document_type FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });
    if (encounter.status === "completed") return reply.status(409).send({ error: "Already submitted" });
    if (encounter.document_type !== "behandlungsvertrag") return reply.status(400).send({ error: "Not a behandlungsvertrag encounter" });
    const ip = request.ip;
    const ua = request.headers["user-agent"] || "";
    const now = new Date().toISOString();
    const mult = tariff === "standardtarif" ? parseFloat(multiplier) : null;
    const contractHtml = body.contractHtml || null;
    db.prepare(`INSERT INTO behandlungsvertrag_submissions (encounter_id, patient_name, tariff, multiplier, signature_svg, contract_html, signed_at, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(encounter_id) DO UPDATE SET
                  patient_name = excluded.patient_name,
                  tariff = excluded.tariff,
                  multiplier = excluded.multiplier,
                  signature_svg = excluded.signature_svg,
                  contract_html = COALESCE(excluded.contract_html, behandlungsvertrag_submissions.contract_html),
                  signed_at = excluded.signed_at,
                  ip_address = excluded.ip_address,
                  user_agent = excluded.user_agent`).run(
      encounterId, patientName.trim(), tariff, mult, signatureSvg, contractHtml, now, ip, ua
    );
    db.prepare("UPDATE encounters SET status = 'completed', completed_at = ? WHERE id = ?").run(now, encounterId);
    logAudit("BV_SUBMIT", encounterId, patientName.trim(), undefined, request.ip);
    return { success: true, signedAt: now };
  });

  // ─── Blutdruckmessung (Patient) ──────────────────────────────────
  fastify.post("/bloodpressure/:encounterId/submit", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const body = request.body as any;
    const systolic = Number(body.systolic);
    const diastolic = Number(body.diastolic);
    const pulse = Number(body.pulse);
    const weight = body.weight != null ? Number(body.weight) : null;
    if (!Number.isInteger(systolic) || systolic < 40 || systolic > 300) return reply.status(400).send({ error: "Ungueltiger systolischer Wert" });
    if (!Number.isInteger(diastolic) || diastolic < 30 || diastolic > 200) return reply.status(400).send({ error: "Ungueltiger diastolischer Wert" });
    if (!Number.isInteger(pulse) || pulse < 30 || pulse > 300) return reply.status(400).send({ error: "Ungueltiger Puls" });
    if (weight != null && (isNaN(weight) || weight < 1 || weight > 500)) return reply.status(400).send({ error: "Ungueltiges Gewicht" });
    const encounter = db.prepare("SELECT id, status, document_type FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });
    if (encounter.document_type !== "bloodpressure") return reply.status(400).send({ error: "Not a bloodpressure encounter" });
    db.prepare("INSERT INTO bloodpressure_readings (encounter_id, systolic, diastolic, pulse, weight) VALUES (?, ?, ?, ?, ?)").run(encounterId, systolic, diastolic, pulse, weight);
    return { success: true };
  });

  fastify.get("/bloodpressure/:encounterId", async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT id, status, document_type FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Encounter not found" });
    if (encounter.document_type !== "bloodpressure") return reply.status(400).send({ error: "Not a bloodpressure encounter" });
    const rows = db.prepare("SELECT systolic, diastolic, pulse, weight, recorded_at FROM bloodpressure_readings WHERE encounter_id = ? ORDER BY recorded_at ASC").all(encounterId);
    return { readings: rows };
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
    if (template && template.content_html && encounter.practice_id) {
      const practice = db.prepare("SELECT ki_provider_name, ki_product_name, ki_manufacturer, ki_model_provider, ki_processing_location, ki_third_country_transfer FROM practices WHERE id = ?").get(encounter.practice_id) as any;
      function esc(s: string | null | undefined): string {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      function val(s: string | null | undefined): string {
        return esc(s && s.trim() ? s.trim() : 'Keine Angabe');
      }
      if (template.content_html) {
        let kiTransfer2 = practice?.ki_third_country_transfer;
        if (kiTransfer2 === "yes" || kiTransfer2 === "ja") kiTransfer2 = "Ja";
        else if (kiTransfer2 === "no" || kiTransfer2 === "nein") kiTransfer2 = "Nein";
        template.content_html = template.content_html.replace(
          /Wir setzen das Produkt <strong>{{KI_PRODUKTNAME}}<\/strong> der {{KI_HERSTELLER}} ein/,
          `Wir setzen das Produkt <strong>${val(practice?.ki_product_name)}</strong> der ${val(practice?.ki_manufacturer)} ein`
        );
        template.content_html = template.content_html.replace(
          /<li><strong>Produktname:<\/strong> {{KI_PRODUKTNAME}}<\/li>/,
          `<li><strong>Produktname:</strong> ${val(practice?.ki_product_name)}</li>`
        );
        template.content_html = template.content_html.replace(
          /<li><strong>Hersteller \/ Anbieter:<\/strong> {{KI_HERSTELLER}}<\/li>/,
          `<li><strong>Hersteller / Anbieter:</strong> ${val(practice?.ki_manufacturer)}</li>`
        );
        template.content_html = template.content_html.replace(
          /<li><strong>KI-Anbieter \(Speech-to-Text &(?:amp;)? KI-Modell\):<\/strong> {{KI_MODELL_ANBIETER}}<\/li>/,
          `<li><strong>KI-Anbieter (Speech-to-Text &amp; KI-Modell):</strong> ${val(practice?.ki_model_provider)}</li>`
        );
        template.content_html = template.content_html.replace(
          /<li><strong>Verarbeitungsort:<\/strong> {{KI_VERARBEITUNGSORT}}<\/li>/,
          `<li><strong>Verarbeitungsort:</strong> ${val(practice?.ki_processing_location)}</li>`
        );
        template.content_html = template.content_html.replace(
          /<li><strong>Drittlandübermittlung:<\/strong> {{KI_DRITTLANDUEBERMITTLUNG}}<\/li>/,
          `<li><strong>Drittlandübermittlung:</strong> ${val(kiTransfer2)}</li>`
        );
      }
    }
    return { encounter, template };
  });

  // ─── Admin: Behandlungsvertrag Detail ───────────────────────────
  fastify.get("/behandlungsvertrag/:encounterId", { onRequest: requireAuth }, async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare(`
      SELECT e.*, l.pvs_patient_id, bv.patient_name, bv.signature_svg, bv.contract_html, bv.signed_at, bv.ip_address, bv.user_agent, bv.tariff, bv.multiplier
      FROM encounters e
      LEFT JOIN patient_links l ON e.source_link_id = l.token
      LEFT JOIN behandlungsvertrag_submissions bv ON bv.encounter_id = e.id
      WHERE e.id = ? AND e.document_type = 'behandlungsvertrag'
    `).get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Not found" });
    const practice = db.prepare("SELECT name, address, city, postal_code, phone, email FROM practices WHERE id = ?").get(encounter.practice_id) as any;
    return { encounter, practice };
  });

  fastify.get("/admin/bloodpressure/:encounterId", { onRequest: requireAuth }, async (request, reply) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT id, status, document_type, created_at, pvs_patient_id FROM encounters WHERE id = ?").get(encounterId) as any;
    if (!encounter) return reply.status(404).send({ error: "Not found" });
    if (encounter.document_type !== "bloodpressure") return reply.status(400).send({ error: "Not a bloodpressure encounter" });
    const rows = db.prepare("SELECT systolic, diastolic, pulse, weight, recorded_at FROM bloodpressure_readings WHERE encounter_id = ? ORDER BY recorded_at ASC").all(encounterId);
    return { encounter, readings: rows };
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

  // ─── Deximed Patienteninformation ───────────────────────────────
  fastify.get("/deximed/search", { onRequest: requireAuth }, async (request, reply) => {
    const query = ((request.query as any).q || "").trim();
    if (!query || query.length < 2) return reply.status(400).send({ error: "Mindestens 2 Zeichen erforderlich" });
    const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
    const rows = db.prepare(
      `SELECT id, title, url, slug FROM deximed_articles WHERE title LIKE ? OR slug LIKE ? ORDER BY title LIMIT 20`
    ).all(like, like) as any[];
    logAudit("DEXIMED_SEARCH", undefined, query, (request as any).user?.email, request.ip);
    return { results: rows };
  });

  fastify.post("/deximed/send", { onRequest: requireAuth }, async (request, reply) => {
    const body = request.body as any;
    const { email, url, title } = body;
    if (!email || !url) return reply.status(400).send({ error: "E-Mail und URL erforderlich" });
    const emailCheck = await validateEmail(email);
    if (!emailCheck.valid) return reply.status(400).send({ error: emailCheck.error });
    const practiceRow = db.prepare("SELECT name FROM practices ORDER BY id ASC LIMIT 1").get() as any;
    const practiceName = practiceRow?.name || "";
    const result = await sendDeximedInfo(email, url, title, practiceName);
    if (result.success) {
      logAudit("DEXIMED_SEND", undefined, `${email} | ${url}`, (request as any).user?.email, request.ip);
      return { success: true };
    } else {
      return reply.status(500).send({ error: result.error || "E-Mail konnte nicht gesendet werden" });
    }
  });

  fastify.get("/deximed/count", { onRequest: requireAuth }, async () => {
    const { total } = db.prepare("SELECT COUNT(*) as total FROM deximed_articles").get() as any;
    return { total };
  });

  fastify.post("/deximed/reindex", { onRequest: requireAuth }, async (request, reply) => {
    const admin = (request as any).user;
    if (!["admin","superadmin"].includes(admin.role)) return reply.status(403).send({ error: "Forbidden" });
    const { spawn } = require("child_process");
    const scriptPath = require("path").join(process.cwd(), "server/dist/scripts/import-deximed.js");
    const child = spawn("node", [scriptPath], { detached: true, stdio: "ignore" });
    child.unref();
    logAudit("DEXIMED_REINDEX_START", undefined, "detached", admin.email, request.ip);
    return { success: true, message: "Reindex gestartet. Das kann ein paar Minuten dauern." };
  });


  // ─── Recall ─────────────────────────────────────────────────────
  fastify.get("/recall/templates", { onRequest: requireAuth }, async (_request, reply) => {
    return reply.send({ templates: getRecallTemplates() });
  });

  fastify.post("/recall/send", { onRequest: requireAuth }, async (request, reply) => {
    const body = request.body as any;
    const { email, recallType } = body;
    if (!email || !recallType) {
      return reply.status(400).send({ error: "E-Mail-Adresse und Recall-Typ sind erforderlich." });
    }
    const emailCheck = await validateEmail(email);
    if (!emailCheck.valid) {
      return reply.status(400).send({ error: emailCheck.error });
    }
    const admin = (request as any).user;
    const practiceRow = db.prepare("SELECT name, recall_medflex_url, recall_medatixx_url FROM practices ORDER BY id ASC LIMIT 1").get() as any;
    const practiceName = practiceRow?.name || "";
    const result = await sendRecallEmail(email, recallType, practiceName, practiceRow?.recall_medflex_url, practiceRow?.recall_medatixx_url);
    if (result.success) {
      logAudit("RECALL_SEND", recallType, `to: ${email}, type: ${recallType}`, admin?.email, request.ip);
      return reply.send({ success: true, messageId: result.messageId });
    }
    return reply.status(500).send({ error: result.error || "E-Mail konnte nicht gesendet werden." });
  });


}