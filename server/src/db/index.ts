import Database from "better-sqlite3";
import { join } from "path";

// Consent form template seeds (inline to ensure availability in Docker)
const consentSeeds: { templates: Array<{ slug: string; title: string; content_html: string; version: string }> } = {
  templates: [
    {
      slug: "standard-datenschutz",
      title: "Datenschutz- und Behandlungseinwilligung",
      version: "1.0",
      content_html: `<h2>1. Datenschutzerklärung</h2>
<p>Ich wurde darüber aufgeklärt, dass meine personenbezogenen Daten gemäß der Datenschutz-Grundverordnung (DSGVO) und dem Bundesdatenschutzgesetz (BDSG) verarbeitet werden. Die Verarbeitung erfolgt zum Zweck der Diagnose, Behandlung und Pflege im Rahmen der ärztlichen Versorgung.</p>
<p>Die Arztpraxis ist berechtigt, meine Daten an:</p>
<ul>
<li>weitere behandelnde Ärzte (bei Überweisung)</li>
<li>Krankenkassen bzw. Kostenträger (zur Abrechnung)</li>
<li>im gesetzlich vorgeschriebenen Rahmen an Behörden</li>
</ul>
<p>weiterzugeben. Eine Weitergabe an sonstige Dritte erfolgt nur mit meiner ausdrücklichen Einwilligung.</p>
<p>Ich habe das Recht auf Auskunft über die zu meiner Person gespeicherten Daten, deren Berichtigung, Löschung oder Einschränkung der Verarbeitung. Weiterhin habe ich ein Beschwerderecht bei der zuständigen Datenschutzaufsichtsbehörde.</p>
<h2>2. Behandlungseinwilligung</h2>
<p>Ich willige hiermit ein, dass die o.g. Praxis mich ärztlich behandelt und dazu erforderliche medizinische Maßnahmen durchführt. Mir wurden die vorgeschlagenen diagnostischen und therapeutischen Maßnahmen sowie deren Risiken und mögliche Alternativen erklärt. Ich habe die Möglichkeit gehabt, Fragen zu stellen, und mir ist bewusst, dass ich diese Einwilligung jederzeit widerrufen kann.</p>
<h2>3. Einwilligung zur elektronischen Datenverarbeitung</h2>
<p>Ich erkläre mich mit der elektronischen Speicherung und Verarbeitung meiner Gesundheitsdaten in der Praxis-Software einverstanden. Die Daten werden ausschließlich verschlüsselt übertragen und auf sicheren Servern innerhalb der EU gespeichert.</p>
<h2>4. Widerspruchsrecht</h2>
<p>Ich weiß, dass ich dieser Einwilligung jederzeit ohne Angabe von Gründen widersprechen kann. Ein Widerruf hat keine Auswirkungen auf die bis dahin erfolgte rechtmäßige Verarbeitung.</p>
<h2>5. Impfaufklärung</h2>
<p>Bei Impfungen wurde mir über Indikation, Wirkungsweise, mögliche Nebenwirkungen und Kontraindikationen aufgeklärt. Ich habe die Gelegenheit erhalten, alle Fragen zu stellen, und ich bin mit der Durchführung der Impfung einverstanden.</p>`
    }
  ]
};

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
  `CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    backup_codes TEXT,
    role TEXT DEFAULT 'praxis',
    practice_id TEXT REFERENCES practices(id),
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    admin_id TEXT REFERENCES admin_users(id),
    refresh_token_hash TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(refresh_token_hash);`,
  `CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);`,
  `ALTER TABLE email_verifications ADD COLUMN magic_token TEXT;`,
  `ALTER TABLE email_verifications ADD COLUMN link_token TEXT;`,
  `CREATE INDEX IF NOT EXISTS idx_email_magic ON email_verifications(magic_token);`,
  `ALTER TABLE patient_links ADD COLUMN document_type TEXT DEFAULT 'anamnese';`,
  `ALTER TABLE patient_links ADD COLUMN consent_form_id TEXT;`,
  `ALTER TABLE encounters ADD COLUMN document_type TEXT DEFAULT 'anamnese';`,
  `ALTER TABLE encounters ADD COLUMN consent_form_id TEXT;`,
  `CREATE TABLE IF NOT EXISTS consent_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id TEXT UNIQUE NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    patient_name TEXT NOT NULL,
    signature_svg TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );`,
  `CREATE INDEX IF NOT EXISTS idx_consent_encounter ON consent_submissions(encounter_id);`,
  `CREATE TABLE IF NOT EXISTS consent_form_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content_html TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`
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
  ensureConsentTemplates();
}

function ensureConsentTemplates() {
  for (const tpl of (consentSeeds.templates || [])) {
    db.prepare(`INSERT OR IGNORE INTO consent_form_templates (slug, title, content_html, version) VALUES (?, ?, ?, ?)`).run(
      tpl.slug, tpl.title, tpl.content_html, tpl.version
    );
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
