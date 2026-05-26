import { FastifyInstance } from 'fastify';
import { db } from '../db/index';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const checkinBody = z.object({
  npub: z.string().min(10),
  practiceId: z.string().default('demo-practice'),
  locationId: z.string().optional()
});

const anamneseBody = z.record(z.any());

export default async function apiRoutes(fastify: FastifyInstance) {
  // Health check
  fastify.get('/health', async () => ({ status: 'ok', version: '0.2.0' }));

  // ─── PATIENT LINK SYSTEM ────────────────────────────────────────

  fastify.post('/link/create', async (request, reply) => {
    const body = request.body as { practiceId: string; pvsPatientId?: string; patientDob?: string; patientEmail?: string; pin?: string; requiresPin?: boolean; expiresHours?: number };
    const practiceId = body.practiceId || 'demo-practice';
    const expiresHours = body.expiresHours || 72;
    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + expiresHours * 3600_000).toISOString();

    const practice = db.prepare('SELECT id FROM practices WHERE id = ?').get(practiceId) as { id: string } | undefined;
    if (!practice) { reply.code(404); return { error: 'Practice not found' }; }

    // PIN-Logik: wenn requiresPin=true aber keine pin angegeben, generiere zufällige 4-stellige PIN
    let pin = body.pin || null;
    if (body.requiresPin && !pin) {
      pin = Math.floor(1000 + Math.random() * 9000).toString();
    }

    db.prepare(`
      INSERT INTO patient_links (id, token, practice_id, pvs_patient_id, patient_dob, patient_email, pin, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), token, practiceId, body.pvsPatientId || null, body.patientDob || null, body.patientEmail || null, pin, 'pending', expiresAt);

    return { token, expiresAt, link: `/anamnese/${token}`, pin };
  });

  fastify.get('/link/list/:practiceId', async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`
      SELECT token, pvs_patient_id, patient_dob, linked_npub, status, created_at, expires_at, linked_at,
             CASE WHEN pin IS NOT NULL AND pin != '' THEN 1 ELSE 0 END as has_pin
      FROM patient_links WHERE practice_id = ? ORDER BY created_at DESC
    `).all(practiceId);
    return rows;
  });

  fastify.get('/link/validate/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const link = db.prepare(`
      SELECT l.*, p.name as practice_name, p.location_id
      FROM patient_links l
      JOIN practices p ON l.practice_id = p.id
      WHERE l.token = ?
    `).get(token) as any;

    if (!link) { reply.code(404); return { error: 'Link not found' }; }
    if (link.status === 'expired' || new Date(link.expires_at) < new Date()) {
      db.prepare('UPDATE patient_links SET status = ? WHERE id = ?').run('expired', link.id);
      reply.code(410); return { error: 'Link expired' };
    }

    return {
      practiceId: link.practice_id,
      practiceName: link.practice_name,
      pvsPatientId: link.pvs_patient_id,
      patientDob: link.patient_dob,
      requiresPin: !!link.pin,
      patientEmail: link.patient_email,
      linkedNpub: link.linked_npub,
      status: link.status,
      expiresAt: link.expires_at
    };
  });

  fastify.post('/link/checkin', async (request, reply) => {
    const body = request.body as { token: string; npub: string; patientDob: string; pin?: string };
    if (!body.token || !body.npub || !body.patientDob) { reply.code(400); return { error: 'token, npub and patientDob required' }; }

    const link = db.prepare('SELECT * FROM patient_links WHERE token = ?').get(body.token) as any;
    if (!link) { reply.code(404); return { error: 'Link not found' }; }
    if (link.status === 'expired' || new Date(link.expires_at) < new Date()) {
      reply.code(410); return { error: 'Link expired' };
    }

    // Harte Blockade: Link bereits verwendet
    if (link.linked_npub) {
      reply.code(409); return { error: 'Link already used. Please contact your practice for a new link.' };
    }

    // Verifizierung: Geburtsdatum
    if (link.patient_dob && link.patient_dob !== body.patientDob) {
      reply.code(403); return { error: 'Invalid date of birth. Please check and try again.' };
    }

    // Verifizierung: PIN (falls gesetzt)
    if (link.pin && link.pin !== body.pin) {
      reply.code(403); return { error: 'Invalid PIN. Please check and try again.' };
    }

    let patient = db.prepare('SELECT id FROM patients WHERE npub = ?').get(body.npub) as { id: string } | undefined;
    let isNew = false;
    if (!patient) {
      const id = randomUUID();
      db.prepare('INSERT INTO patients (id, npub) VALUES (?, ?)').run(id, body.npub);
      patient = { id };
      isNew = true;
    }

    const encounterId = randomUUID();
    db.prepare('INSERT INTO encounters (id, patient_id, practice_id, source_link_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(encounterId, patient.id, link.practice_id, body.token, 'in-progress');

    db.prepare(`UPDATE patient_links SET linked_npub = ?, status = ?, linked_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(body.npub, 'linked', link.id);

    return { encounterId, patientId: patient.id, isNew, practiceId: link.practice_id };
  });

  // ─── NOSTR ──────────────────────────────────────────────────────
  fastify.post('/nostr/event', async (request, reply) => {
    const event = request.body as any;
    if (!event.id || !event.pubkey || !event.kind || !event.sig) {
      reply.code(400); return { error: 'Invalid event' };
    }
    try {
      db.prepare(`
        INSERT INTO nostr_events (id, event_id, pubkey, kind, content, tags, sig, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `).run(
        randomUUID(), event.id, event.pubkey, event.kind,
        JSON.stringify(event.content || ''),
        JSON.stringify(event.tags || []),
        event.sig,
        event.created_at
      );
      return { saved: true };
    } catch (e) {
      reply.code(409); return { error: 'Duplicate or invalid event' };
    }
  });

  fastify.get('/nostr/events/:pubkey', async (request) => {
    const { pubkey } = request.params as { pubkey: string };
    const rows = db.prepare('SELECT event_id, kind, content, tags, sig, created_at FROM nostr_events WHERE pubkey = ? ORDER BY created_at DESC').all(pubkey);
    return rows.map((r: any) => ({
      ...r,
      content: JSON.parse(r.content),
      tags: JSON.parse(r.tags)
    }));
  });

  // ─── CLASSIC CHECKIN ────────────────────────────────────────────
  fastify.post('/checkin', async (request, reply) => {
    const body = checkinBody.parse(request.body);
    let patient = db.prepare('SELECT id FROM patients WHERE npub = ?').get(body.npub) as { id: string } | undefined;
    let isNew = false;
    if (!patient) {
      const id = randomUUID();
      db.prepare('INSERT INTO patients (id, npub) VALUES (?, ?)').run(id, body.npub);
      patient = { id };
      isNew = true;
    }
    const encounterId = randomUUID();
    db.prepare('INSERT INTO encounters (id, patient_id, practice_id, status) VALUES (?, ?, ?, ?)')
      .run(encounterId, patient.id, body.practiceId, 'in-progress');
    return { encounterId, patientId: patient.id, isNew };
  });

  fastify.get('/encounter/:encounterId', async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare('SELECT * FROM encounters WHERE id = ?').get(encounterId);
    if (!encounter) throw new Error('Encounter not found');
    const responses = db.prepare('SELECT category, status, data FROM questionnaire_responses WHERE encounter_id = ?').all(encounterId);
    return { ...encounter, responses };
  });

  fastify.get('/encounters/list/:practiceId', async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const rows = db.prepare(`
      SELECT e.id, e.status, e.source_link_id, e.created_at, p.npub, l.pvs_patient_id
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      LEFT JOIN patient_links l ON e.source_link_id = l.token
      WHERE e.practice_id = ?
      ORDER BY e.created_at DESC
    `).all(practiceId);
    return rows;
  });

  // Anamnese speichern
  fastify.post('/anamnese/:encounterId/:category', async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const data = anamneseBody.parse(request.body);
    const existing = db.prepare('SELECT id FROM questionnaire_responses WHERE encounter_id = ? AND category = ?').get(encounterId, category) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE questionnaire_responses SET data = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(data), data.__completed ? 'completed' : 'in-progress', existing.id);
      return { id: existing.id, updated: true };
    } else {
      const encounter = db.prepare('SELECT patient_id FROM encounters WHERE id = ?').get(encounterId) as any;
      if (!encounter) throw new Error('Encounter not found');
      const id = randomUUID();
      db.prepare('INSERT INTO questionnaire_responses (id, encounter_id, patient_id, category, status, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, encounterId, encounter.patient_id, category, data.__completed ? 'completed' : 'in-progress', JSON.stringify(data));
      return { id, created: true };
    }
  });

  fastify.get('/anamnese/:encounterId/:category', async (request) => {
    const { encounterId, category } = request.params as { encounterId: string; category: string };
    const row = db.prepare('SELECT data FROM questionnaire_responses WHERE encounter_id = ? AND category = ?').get(encounterId, category) as { data: string } | undefined;
    if (!row) return {};
    return JSON.parse(row.data);
  });

  // FHIR QuestionnaireResponse
  fastify.get('/anamnese/:encounterId/fhir', async (request) => {
    const { encounterId } = request.params as { encounterId: string };
    const encounter = db.prepare('SELECT * FROM encounters WHERE id = ?').get(encounterId) as any;
    const patient = db.prepare('SELECT npub FROM patients WHERE id = ?').get(encounter.patient_id) as { npub: string };
    const rows = db.prepare('SELECT category, data FROM questionnaire_responses WHERE encounter_id = ?').all(encounterId) as { category: string; data: string }[];
    const items = rows.flatMap((row: any) => {
      const data = JSON.parse(row.data);
      delete data.__completed;
      return Object.entries(data).map(([linkId, answer]) => ({
        linkId: `${row.category}.${linkId}`,
        answer: [{ valueString: String(answer) }]
      }));
    });
    return {
      resourceType: 'QuestionnaireResponse',
      id: encounterId,
      status: 'completed',
      subject: { identifier: { system: 'urn:nostr', value: patient.npub } },
      authored: new Date().toISOString(),
      item: items
    };
  });

  // FHIR Patient
  fastify.get('/fhir/patient/:npub', async (request) => {
    const { npub } = request.params as { npub: string };
    const patient = db.prepare('SELECT id, npub FROM patients WHERE npub = ?').get(npub) as any;
    if (!patient) throw new Error('Patient not found');
    return {
      resourceType: 'Patient',
      id: patient.id,
      identifier: [{ system: 'urn:nostr', value: patient.npub }]
    };
  });

  // Patients list (Admin) - mit encounter_count
  fastify.get('/patients', async () => {
    const rows = db.prepare(`
      SELECT p.id, p.npub, p.created_at,
        (SELECT COUNT(*) FROM encounters WHERE patient_id = p.id) as encounter_count,
        (SELECT MAX(created_at) FROM encounters WHERE patient_id = p.id) as last_activity
      FROM patients p
      ORDER BY p.created_at DESC
    `).all();
    return rows;
  });

  // Praxis-Liste
  fastify.get('/practices', async () => {
    return db.prepare('SELECT id, name, location_id, fhir_endpoint FROM practices').all();
  });

  // ─── SELF CHECKIN (Public QR-Code) ──────────────────────────────

  // Public checkin für bekannte Patienten (Self-Checkin an Praxistür)
  fastify.post('/checkin/public', async (request, reply) => {
    const body = request.body as { npub: string; practiceId: string; complaints?: string; hasAppointment?: boolean; appointmentTime?: string; freitext?: string };
    const practiceId = body.practiceId || 'demo-practice';

    if (!body.npub) { reply.code(400); return { error: 'npub required' }; }

    // Patient finden oder erstellen
    let patient = db.prepare('SELECT id FROM patients WHERE npub = ?').get(body.npub) as { id: string } | undefined;
    let isNew = false;
    if (!patient) {
      const id = randomUUID();
      db.prepare('INSERT INTO patients (id, npub) VALUES (?, ?)').run(id, body.npub);
      patient = { id };
      isNew = true;
    }

    const encounterId = randomUUID();
    db.prepare('INSERT INTO encounters (id, patient_id, practice_id, status, source_link_id) VALUES (?, ?, ?, ?, ?)')
      .run(encounterId, patient.id, practiceId, 'checked-in', 'self-checkin');

    // Beschwerden speichern
    if (body.complaints || body.freitext) {
      db.prepare('INSERT INTO questionnaire_responses (id, encounter_id, patient_id, category, status, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), encounterId, patient.id, 'checkin', 'completed', JSON.stringify({
          complaints: body.complaints || '',
          hasAppointment: body.hasAppointment || false,
          appointmentTime: body.appointmentTime || '',
          freitext: body.freitext || '',
          __completed: true
        }));
    }

    return { encounterId, patientId: patient.id, isNew, practiceId, status: 'checked-in' };
  });

  // Heutige Checkins für Admin-Dashboard
  fastify.get('/checkin/today/:practiceId', async (request) => {
    const { practiceId } = request.params as { practiceId: string };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const rows = db.prepare(`
      SELECT e.id, e.status, e.source_link_id, e.created_at, p.npub,
        (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = 'checkin' LIMIT 1) as checkin_data,
        (SELECT data FROM questionnaire_responses WHERE encounter_id = e.id AND category = 'symptoms' LIMIT 1) as symptoms_data,
        (SELECT pvs_patient_id FROM patient_links WHERE linked_npub = p.npub ORDER BY linked_at DESC LIMIT 1) as pvs_patient_id
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      WHERE e.practice_id = ? AND e.created_at LIKE ?
      ORDER BY e.created_at DESC
    `).all(practiceId, todayStr + '%');
    return rows.map((r: any) => {
      const checkinData = r.checkin_data ? JSON.parse(r.checkin_data) : null;
      const symptomsData = r.symptoms_data ? JSON.parse(r.symptoms_data) : null;
      // Merge: checkin_data hat Vorrang, symptoms_data als Fallback für Beschwerden
      const merged = {
        ...symptomsData,
        ...checkinData,
        // Wenn symptoms als String gespeichert sind (z.B. "Husten, Fieber"), nutze sie als complaints
        complaints: checkinData?.complaints || symptomsData?.symptoms || symptomsData?.complaints || null,
        freitext: checkinData?.freitext || symptomsData?.freitext || null,
        hasAppointment: checkinData?.hasAppointment || symptomsData?.hasAppointment || false,
        appointmentTime: checkinData?.appointmentTime || symptomsData?.appointmentTime || null,
      };
      return {
        ...r,
        checkin_data: merged
      };
    });
  });
}
