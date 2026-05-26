import { FastifyInstance } from "fastify";
import { db } from "../db/index";
import { randomUUID } from "crypto";
import { z } from "zod";

const anamneseBody = z.record(z.any());

export default async function apiRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => ({ status: "ok", version: "0.4.0" }));

  // ─── PATIENT LINK SYSTEM ────────────────────────────────────────

  fastify.post("/link/create", async (request, reply) => {
    const body = request.body as { practiceId: string; pvsPatientId?: string; patientDob?: string; patientEmail?: string; pin?: string; requiresPin?: boolean; expiresHours?: number };
    const practiceId = body.practiceId || "demo-practice";
    const expiresHours = body.expiresHours || 72;
    const token = randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + expiresHours * 3600_000).toISOString();

    const practice = db.prepare("SELECT id FROM practices WHERE id = ?").get(practiceId) as { id: string } | undefined;
    if (!practice) { reply.code(404); return { error: "Practice not found" }; }

    let pin = body.pin || null;
    if (body.requiresPin && !pin) {
      pin = Math.floor(1000 + Math.random() * 9000).toString();
    }

    db.prepare(`
      INSERT INTO patient_links (id, token, practice_id, pvs_patient_id, patient_dob, patient_email, pin, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), token, practiceId, body.pvsPatientId || null, body.patientDob || null, body.patientEmail || null, pin, "pending", expiresAt);

    return { token, expiresAt, link: `/anamnese/${token}`, pin };
  });

  fastify.get("/link/list/:practiceId", async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`
      SELECT token, pvs_patient_id, patient_dob, status, created_at, expires_at,
             CASE WHEN pin IS NOT NULL AND pin != "" THEN 1 ELSE 0 END as has_pin
      FROM patient_links WHERE practice_id = ? ORDER BY created_at DESC
    `).all(practiceId);
    return rows;
  });

  fastify.get("/link/validate/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = db.prepare(`
      SELECT l.*, p.name as practice_name, p.location_id
      FROM patient_links l
      JOIN practices p ON l.practice_id = p.id
      WHERE l.token = ?
    `).get(token) as any;

    if (!link) { reply.code(404); return { error: "Link not found" }; }
    if (link.status === "expired" || new Date(link.expires_at) < new Date()) {
      db.prepare("UPDATE patient_links SET status = ? WHERE id = ?").run("expired", link.id);
      reply.code(410); return { error: "Link expired" };
    }
    if (link.status === "used") {
      reply.code(409); return { error: "Link already used" };
    }

    return {
      practiceId: link.practice_id,
      practiceName: link.practice_name,
      pvsPatientId: link.pvs_patient_id,
      patientDob: link.patient_dob,
      requiresPin: !!link.pin,
      patientEmail: link.patient_email,
      status: link.status,
      expiresAt: link.expires_at
    };
  });

  fastify.post("/link/start", async (request, reply) => {
    const body = request.body as { token: string; patientDob: string; pin?: string };
    if (!body.token || !body.patientDob) {
      reply.code(400); return { error: "token and patientDob required" };
    }

    const link = db.prepare("SELECT * FROM patient_links WHERE token = ?").get(body.token) as any;
    if (!link) { reply.code(404); return { error: "Link not found" }; }
    if (link.status === "expired" || new Date(link.expires_at) < new Date()) {
      reply.code(410); return { error: "Link expired" };
    }
    if (link.status === "used") {
      reply.code(409); return { error: "Link already used" };
    }

    if (link.patient_dob && link.patient_dob !== body.patientDob) {
      reply.code(403); return { error: "Invalid date of birth" };
    }
    if (link.pin && link.pin !== body.pin) {
      reply.code(403); return { error: "Invalid PIN" };
    }

    const patientId = randomUUID();
    db.prepare("INSERT INTO patients (id) VALUES (?)").run(patientId);

    const encounterId = randomUUID();
    db.prepare("INSERT INTO encounters (id, patient_id, practice_id, source_link_id, status) VALUES (?, ?, ?, ?, ?)")
      .run(encounterId, patientId, link.practice_id, body.token, "in-progress");

    db.prepare("UPDATE patient_links SET status = ?, linked_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run("used", link.id);

    return { encounterId, patientId, practiceId: link.practice_id, pvsPatientId: link.pvs_patient_id };
  });

  // ─── ENCOUNTERS ─────────────────────────────────────────────────

  fastify.get("/encounter/:encounterId", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare("SELECT * FROM encounters WHERE id = ?").get(encounterId);
    if (!encounter) throw new Error("Encounter not found");
    const responses = db.prepare("SELECT category, status, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId);
    return { ...encounter, responses };
  });

  fastify.post("/encounter/:encounterId/complete", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    db.prepare("UPDATE encounters SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run("completed", encounterId);
    return { completed: true };
  });

  fastify.get("/encounters/list/:practiceId", async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`
      SELECT e.id, e.status, e.source_link_id, e.created_at, l.pvs_patient_id
      FROM encounters e
      LEFT JOIN patient_links l ON e.source_link_id = l.token
      WHERE e.practice_id = ?
      ORDER BY e.created_at DESC
    `).all(practiceId);
    return rows;
  });

  // ─── ANAMNESE ───────────────────────────────────────────────────

  fastify.post("/anamnese/:encounterId/:category", async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const data = anamneseBody.parse(request.body);
    const existing = db.prepare("SELECT id FROM questionnaire_responses WHERE encounter_id = ? AND category = ?").get(encounterId, category) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE questionnaire_responses SET data = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(JSON.stringify(data), data.__completed ? "completed" : "in-progress", existing.id);
      return { id: existing.id, updated: true };
    } else {
      const encounter = db.prepare("SELECT patient_id FROM encounters WHERE id = ?").get(encounterId) as any;
      if (!encounter) throw new Error("Encounter not found");
      const id = randomUUID();
      db.prepare("INSERT INTO questionnaire_responses (id, encounter_id, patient_id, category, status, data) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, encounterId, encounter.patient_id, category, data.__completed ? "completed" : "in-progress", JSON.stringify(data));
      return { id, created: true };
    }
  });

  fastify.get("/anamnese/:encounterId/:category", async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const row = db.prepare("SELECT data FROM questionnaire_responses WHERE encounter_id = ? AND category = ?").get(encounterId, category) as { data: string } | undefined;
    if (!row) return {};
    return JSON.parse(row.data);
  });

  fastify.get("/anamnese/:encounterId/fhir", async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    const rows = db.prepare("SELECT category, data FROM questionnaire_responses WHERE encounter_id = ?").all(encounterId) as { category: string; data: string }[];
    const items = rows.flatMap((row: any) => {
      const data = JSON.parse(row.data);
      delete data.__completed;
      return Object.entries(data).map(([linkId, answer]) => ({
        linkId: `${row.category}.${linkId}`,
        answer: [{ valueString: String(answer) }]
      }));
    });
    return {
      resourceType: "QuestionnaireResponse",
      id: encounterId,
      status: "completed",
      authored: new Date().toISOString(),
      item: items
    };
  });

  // ─── PATIENTS & PRACTICES ───────────────────────────────────────

  fastify.get("/patients", async () => {
    const rows = db.prepare(`
      SELECT p.id, p.created_at,
        (SELECT COUNT(*) FROM encounters WHERE patient_id = p.id) as encounter_count,
        (SELECT MAX(created_at) FROM encounters WHERE patient_id = p.id) as last_activity
      FROM patients p
      ORDER BY p.created_at DESC
      LIMIT 50
    `).all();
    return rows;
  });

  fastify.get("/practices", async () => {
    return db.prepare("SELECT id, name, location_id, fhir_endpoint FROM practices").all();
  });

  fastify.get("/checkin/today/:practiceId", async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const rows = db.prepare(`
      SELECT e.id, e.status, e.source_link_id, e.created_at,
        (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = "checkin" LIMIT 1) as checkin_data,
        (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = "symptoms" LIMIT 1) as symptoms_data,
        l.pvs_patient_id
      FROM encounters e
      LEFT JOIN patient_links l ON e.source_link_id = l.token
      WHERE e.practice_id = ? AND e.created_at LIKE ?
      ORDER BY e.created_at DESC
    `).all(practiceId, todayStr + "%");
    return rows.map((r: any) => {
      const checkinData = r.checkin_data ? JSON.parse(r.checkin_data) : null;
      const symptomsData = r.symptoms_data ? JSON.parse(r.symptoms_data) : null;
      const merged = {
        ...symptomsData,
        ...checkinData,
        complaints: checkinData?.complaints || symptomsData?.symptoms || symptomsData?.complaints || null,
        freitext: checkinData?.freitext || symptomsData?.freitext || null,
      };
      return { ...r, checkin_data: merged };
    });
  });
}
