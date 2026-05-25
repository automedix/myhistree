"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initSchema = initSchema;
exports.ensurePracticeDefaults = ensurePracticeDefaults;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = require("path");
const dbPath = process.env.DB_PATH || (0, path_1.join)(__dirname, '../../../data/myhistoree.db');
const db = new better_sqlite3_1.default(dbPath);
exports.db = db;
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
function initSchema() {
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
      patient_name TEXT,
      patient_email TEXT,
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
function ensurePracticeDefaults() {
    const stmt = db.prepare('SELECT id FROM practices WHERE id = ?');
    if (!stmt.get('demo-practice')) {
        const insert = db.prepare('INSERT INTO practices (id, name, location_id) VALUES (?, ?, ?)');
        insert.run('demo-practice', 'Hausärzte im Grillepark', 'grillepark-owl');
    }
}
//# sourceMappingURL=index.js.map