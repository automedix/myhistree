import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = process.env.DB_PATH || join(__dirname, '../../../data/myhistoree.db');
const db: Database.Database = new Database(dbPath);
export { db };
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      npub TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS practices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      fhir_endpoint TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS encounters (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      practice_id TEXT NOT NULL REFERENCES practices(id),
      status TEXT DEFAULT 'in-progress',
      class TEXT DEFAULT 'AMB',
      source_link_id TEXT,
      fhir_encounter_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS questionnaire_responses (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id),
      patient_id TEXT NOT NULL REFERENCES patients(id),
      category TEXT NOT NULL,
      status TEXT DEFAULT 'in-progress',
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patient_links (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      practice_id TEXT NOT NULL REFERENCES practices(id),
      pvs_patient_id TEXT,
      patient_dob TEXT,
      patient_email TEXT,
      pin TEXT,
      linked_npub TEXT,
      status TEXT DEFAULT 'pending',
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      linked_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS nostr_events (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      pubkey TEXT NOT NULL,
      kind INTEGER NOT NULL,
      content TEXT,
      tags TEXT,
      sig TEXT,
      created_at INTEGER,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_patients_npub ON patients(npub);
    CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id);
    CREATE INDEX IF NOT EXISTS idx_qr_encounter ON questionnaire_responses(encounter_id);
    CREATE INDEX IF NOT EXISTS idx_qr_category ON questionnaire_responses(category);
    CREATE INDEX IF NOT EXISTS idx_links_token ON patient_links(token);
    CREATE INDEX IF NOT EXISTS idx_links_practice ON patient_links(practice_id);
    CREATE INDEX IF NOT EXISTS idx_nostr_pubkey ON nostr_events(pubkey);
  `);
}

export function ensurePracticeDefaults(): void {
  const stmt = db.prepare('SELECT id FROM practices WHERE id = ?');
  if (!stmt.get('demo-practice')) {
    const insert = db.prepare('INSERT INTO practices (id, name, location_id) VALUES (?, ?, ?)');
    insert.run('demo-practice', 'Hausärzte im Grillepark', 'grillepark-owl');
  }
}
