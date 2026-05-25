"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = apiRoutes;
const index_1 = require("../db/index");
const crypto_1 = require("crypto");
const zod_1 = require("zod");
const checkinBody = zod_1.z.object({
    npub: zod_1.z.string().min(10),
    practiceId: zod_1.z.string().default('demo-practice'),
    locationId: zod_1.z.string().optional()
});
const anamneseBody = zod_1.z.record(zod_1.z.any());
async function apiRoutes(fastify) {
    // Health check
    fastify.get('/health', async () => ({ status: 'ok', version: '0.2.0' }));
    // ─── PATIENT LINK SYSTEM ────────────────────────────────────────
    fastify.post('/link/create', async (request, reply) => {
        const body = request.body;
        const practiceId = body.practiceId || 'demo-practice';
        const expiresHours = body.expiresHours || 72;
        const token = (0, crypto_1.randomUUID)().replace(/-/g, '');
        const expiresAt = new Date(Date.now() + expiresHours * 3600_000).toISOString();
        const practice = index_1.db.prepare('SELECT id FROM practices WHERE id = ?').get(practiceId);
        if (!practice) {
            reply.code(404);
            return { error: 'Practice not found' };
        }
        index_1.db.prepare(`
      INSERT INTO patient_links (id, token, practice_id, patient_name, patient_email, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run((0, crypto_1.randomUUID)(), token, practiceId, body.patientName || null, body.patientEmail || null, 'pending', expiresAt);
        return { token, expiresAt, link: `/anamnese/${token}` };
    });
    fastify.get('/link/list/:practiceId', async (request) => {
        const { practiceId } = request.params;
        const rows = index_1.db.prepare(`
      SELECT token, patient_name, linked_npub, status, created_at, expires_at, linked_at
      FROM patient_links WHERE practice_id = ? ORDER BY created_at DESC
    `).all(practiceId);
        return rows;
    });
    fastify.get('/link/validate/:token', async (request, reply) => {
        const { token } = request.params;
        const link = index_1.db.prepare(`
      SELECT l.*, p.name as practice_name, p.location_id
      FROM patient_links l
      JOIN practices p ON l.practice_id = p.id
      WHERE l.token = ?
    `).get(token);
        if (!link) {
            reply.code(404);
            return { error: 'Link not found' };
        }
        if (link.status === 'expired' || new Date(link.expires_at) < new Date()) {
            index_1.db.prepare('UPDATE patient_links SET status = ? WHERE id = ?').run('expired', link.id);
            reply.code(410);
            return { error: 'Link expired' };
        }
        return {
            practiceId: link.practice_id,
            practiceName: link.practice_name,
            patientName: link.patient_name,
            patientEmail: link.patient_email,
            linkedNpub: link.linked_npub,
            status: link.status,
            expiresAt: link.expires_at
        };
    });
    fastify.post('/link/checkin', async (request, reply) => {
        const body = request.body;
        if (!body.token || !body.npub) {
            reply.code(400);
            return { error: 'token and npub required' };
        }
        const link = index_1.db.prepare('SELECT * FROM patient_links WHERE token = ?').get(body.token);
        if (!link) {
            reply.code(404);
            return { error: 'Link not found' };
        }
        if (link.status === 'expired' || new Date(link.expires_at) < new Date()) {
            reply.code(410);
            return { error: 'Link expired' };
        }
        let patient = index_1.db.prepare('SELECT id FROM patients WHERE npub = ?').get(body.npub);
        let isNew = false;
        if (!patient) {
            const id = (0, crypto_1.randomUUID)();
            index_1.db.prepare('INSERT INTO patients (id, npub) VALUES (?, ?)').run(id, body.npub);
            patient = { id };
            isNew = true;
        }
        const encounterId = (0, crypto_1.randomUUID)();
        index_1.db.prepare('INSERT INTO encounters (id, patient_id, practice_id, source_link_id, status) VALUES (?, ?, ?, ?, ?)')
            .run(encounterId, patient.id, link.practice_id, body.token, 'in-progress');
        if (!link.linked_npub) {
            index_1.db.prepare(`UPDATE patient_links SET linked_npub = ?, status = ?, linked_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .run(body.npub, 'linked', link.id);
        }
        return { encounterId, patientId: patient.id, isNew, practiceId: link.practice_id };
    });
    // ─── NOSTR ──────────────────────────────────────────────────────
    fastify.post('/nostr/event', async (request, reply) => {
        const event = request.body;
        if (!event.id || !event.pubkey || !event.kind || !event.sig) {
            reply.code(400);
            return { error: 'Invalid event' };
        }
        try {
            index_1.db.prepare(`
        INSERT INTO nostr_events (id, event_id, pubkey, kind, content, tags, sig, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `).run((0, crypto_1.randomUUID)(), event.id, event.pubkey, event.kind, JSON.stringify(event.content || ''), JSON.stringify(event.tags || []), event.sig, event.created_at);
            return { saved: true };
        }
        catch (e) {
            reply.code(409);
            return { error: 'Duplicate or invalid event' };
        }
    });
    fastify.get('/nostr/events/:pubkey', async (request) => {
        const { pubkey } = request.params;
        const rows = index_1.db.prepare('SELECT event_id, kind, content, tags, sig, created_at FROM nostr_events WHERE pubkey = ? ORDER BY created_at DESC').all(pubkey);
        return rows.map((r) => ({
            ...r,
            content: JSON.parse(r.content),
            tags: JSON.parse(r.tags)
        }));
    });
    // ─── CLASSIC CHECKIN ────────────────────────────────────────────
    fastify.post('/checkin', async (request, reply) => {
        const body = checkinBody.parse(request.body);
        let patient = index_1.db.prepare('SELECT id FROM patients WHERE npub = ?').get(body.npub);
        let isNew = false;
        if (!patient) {
            const id = (0, crypto_1.randomUUID)();
            index_1.db.prepare('INSERT INTO patients (id, npub) VALUES (?, ?)').run(id, body.npub);
            patient = { id };
            isNew = true;
        }
        const encounterId = (0, crypto_1.randomUUID)();
        index_1.db.prepare('INSERT INTO encounters (id, patient_id, practice_id, status) VALUES (?, ?, ?, ?)')
            .run(encounterId, patient.id, body.practiceId, 'in-progress');
        return { encounterId, patientId: patient.id, isNew };
    });
    fastify.get('/encounter/:encounterId', async (request) => {
        const { encounterId } = request.params;
        const encounter = index_1.db.prepare('SELECT * FROM encounters WHERE id = ?').get(encounterId);
        if (!encounter)
            throw new Error('Encounter not found');
        const responses = index_1.db.prepare('SELECT category, status, data FROM questionnaire_responses WHERE encounter_id = ?').all(encounterId);
        return { ...encounter, responses };
    });
    fastify.get('/encounters/list/:practiceId', async (request) => {
        const { practiceId } = request.params;
        const rows = index_1.db.prepare(`
      SELECT e.id, e.status, e.source_link_id, e.created_at, p.npub
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      WHERE e.practice_id = ?
      ORDER BY e.created_at DESC
    `).all(practiceId);
        return rows;
    });
    // Anamnese speichern
    fastify.post('/anamnese/:encounterId/:category', async (request) => {
        const { encounterId, category } = request.params;
        const data = anamneseBody.parse(request.body);
        const existing = index_1.db.prepare('SELECT id FROM questionnaire_responses WHERE encounter_id = ? AND category = ?').get(encounterId, category);
        if (existing) {
            index_1.db.prepare('UPDATE questionnaire_responses SET data = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(JSON.stringify(data), data.__completed ? 'completed' : 'in-progress', existing.id);
            return { id: existing.id, updated: true };
        }
        else {
            const encounter = index_1.db.prepare('SELECT patient_id FROM encounters WHERE id = ?').get(encounterId);
            if (!encounter)
                throw new Error('Encounter not found');
            const id = (0, crypto_1.randomUUID)();
            index_1.db.prepare('INSERT INTO questionnaire_responses (id, encounter_id, patient_id, category, status, data) VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, encounterId, encounter.patient_id, category, data.__completed ? 'completed' : 'in-progress', JSON.stringify(data));
            return { id, created: true };
        }
    });
    fastify.get('/anamnese/:encounterId/:category', async (request) => {
        const { encounterId, category } = request.params;
        const row = index_1.db.prepare('SELECT data FROM questionnaire_responses WHERE encounter_id = ? AND category = ?').get(encounterId, category);
        if (!row)
            return {};
        return JSON.parse(row.data);
    });
    // FHIR QuestionnaireResponse
    fastify.get('/anamnese/:encounterId/fhir', async (request) => {
        const { encounterId } = request.params;
        const encounter = index_1.db.prepare('SELECT * FROM encounters WHERE id = ?').get(encounterId);
        const patient = index_1.db.prepare('SELECT npub FROM patients WHERE id = ?').get(encounter.patient_id);
        const rows = index_1.db.prepare('SELECT category, data FROM questionnaire_responses WHERE encounter_id = ?').all(encounterId);
        const items = rows.flatMap((row) => {
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
        const { npub } = request.params;
        const patient = index_1.db.prepare('SELECT id, npub FROM patients WHERE npub = ?').get(npub);
        if (!patient)
            throw new Error('Patient not found');
        return {
            resourceType: 'Patient',
            id: patient.id,
            identifier: [{ system: 'urn:nostr', value: patient.npub }]
        };
    });
    // Patients list (Admin) - mit encounter_count
    fastify.get('/patients', async () => {
        const rows = index_1.db.prepare(`
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
        return index_1.db.prepare('SELECT id, name, location_id, fhir_endpoint FROM practices').all();
    });
}
//# sourceMappingURL=api.js.map