import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data", "myhistoree.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user TEXT,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);`,
  `ALTER TABLE encounters ADD COLUMN processed_at TEXT;`,
  `ALTER TABLE encounters ADD COLUMN current_screen TEXT;`,
  `CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status);`,
];

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS practices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      postal_code TEXT,
      phone TEXT,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      linked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      pvs_patient_id TEXT,
      first_name TEXT,
      last_name TEXT,
      date_of_birth TEXT,
      gender TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      linked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT REFERENCES patients(id),
      practice_id TEXT REFERENCES practices(id),
      source_link_id TEXT,
      source TEXT,
      status TEXT DEFAULT 'in-progress',
      pvs_patient_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      processed_at TEXT,
      current_screen TEXT
    );
    CREATE TABLE IF NOT EXISTS questionnaire_responses (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      encounter_id TEXT REFERENCES encounters(id),
      patient_id TEXT REFERENCES patients(id),
      category TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS patient_links (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      token TEXT NOT NULL UNIQUE,
      practice_id TEXT REFERENCES practices(id),
      pvs_patient_id TEXT,
      patient_dob TEXT,
      patient_email TEXT,
      mobile_number TEXT,
      email_verified INTEGER DEFAULT 0,
      email_verification_token TEXT,
      has_pin INTEGER DEFAULT 0,
      pin TEXT,
      status TEXT DEFAULT 'pending',
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      linked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      encounter_id TEXT REFERENCES encounters(id),
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_links_token ON patient_links(token);
    CREATE INDEX IF NOT EXISTS idx_links_practice ON patient_links(practice_id);
    CREATE INDEX IF NOT EXISTS idx_encounters_practice ON encounters(practice_id);
    CREATE INDEX IF NOT EXISTS idx_responses_encounter ON questionnaire_responses(encounter_id);
    CREATE INDEX IF NOT EXISTS idx_patients_pvs ON patients(pvs_patient_id);
    CREATE INDEX IF NOT EXISTS idx_email_verif_encounter ON email_verifications(encounter_id);
    CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status);
  `);

  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch (e: any) {
      if (!e.message.includes("duplicate column") && !e.message.includes("already exists")) {
        throw e;
      }
    }
  }
}

export function ensurePracticeDefaults() {
  const stmt = db.prepare("SELECT id FROM practices WHERE id = 'demo-practice'");
  if (!stmt.get()) {
    db.prepare(`INSERT INTO practices (id, name, address, city, postal_code, phone, email)
                VALUES ('demo-practice', 'Haus\u00e4rzte im Grillepark',
                        'Musterstraße 1', 'Musterstadt', '12345',
                        '01234 567890', 'praxis@example.com')`).run();
  }
}

export function logAudit(action: string, target?: string, details?: string, adminUser?: string, ip?: string) {
  db.prepare(`INSERT INTO audit_log (admin_user, action, target, details, ip)
              VALUES (?, ?, ?, ?, ?)`)
    .run(adminUser || null, action, target || null, details || null, ip || null);
}

export function getAuditLog(limit: number = 100, offset: number = 0) {
  return db.prepare(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
}

export function applyRetention() {
  const now = new Date().toISOString();

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const r1 = db.prepare(`UPDATE encounters SET pvs_patient_id = '[ANONYMIZED]' WHERE status = 'completed' AND completed_at < ? AND pvs_patient_id != '[ANONYMIZED]'`)
    .run(twoYearsAgo.toISOString());

  db.prepare(`DELETE FROM questionnaire_responses WHERE encounter_id IN (SELECT id FROM encounters WHERE pvs_patient_id = '[ANONYMIZED]')`).run();

  const r2 = db.prepare(`UPDATE patient_links SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`).run(now);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const r3 = db.prepare(`DELETE FROM patient_links WHERE status = 'used' AND created_at < ?`).run(thirtyDaysAgo.toISOString());

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const r4 = db.prepare(`DELETE FROM patient_links WHERE status = 'expired' AND created_at < ?`).run(sevenDaysAgo.toISOString());

  return {
    anonymized: r1.changes,
    expired: r2.changes,
    deletedUsed: r3.changes,
    deletedExpired: r4.changes
  };
}
