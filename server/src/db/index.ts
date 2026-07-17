import Database from "better-sqlite3";
import { join } from "path";
import { readFileSync } from "fs";

// Consent form template seeds (inline to ensure availability in Docker)
const consentSeeds: { templates: Array<{ slug: string; title: string; content_html: string; version: string }> } = {
  templates: [
    {
      slug: "email-kommunikation",
      title: "Einwilligung zur E-Mail-Kommunikation",
      version: "1.0",
      content_html: `<h2>1. Allgemeines behandlungsbezogenes Anschreiben per E-Mail</h2>
<p>Im Rahmen meiner medizinischen Behandlung kann es erforderlich sein, mich schriftlich zu kontaktieren. Sofern ich der Praxis eine E-Mail-Adresse hinterlegt habe, willige ich ein, dass die Praxis mich im aktuellen und zukünftigen Behandlungskontext per E-Mail anschreibt.</p>
<div class="consent-check-wrap">
  <label><input type="checkbox" class="consent-check" data-item="anschreiben"> <strong>Ich willige ein</strong>, dass die Praxis mich im Behandlungskontext per E-Mail anschreibt, sofern ich eine E-Mail-Adresse hinterlegt habe.</label>
</div>

<h2>2. Terminbenachrichtigung, Terminerinnerung und Terminabsage per E-Mail</h2>
<p>Die Praxis kann mir E-Mails zur Organisation von Terminen senden. Dazu gehören:</p>
<ul>
<li>Benachrichtigungen über vereinbarte Termine</li>
<li>Erinnerungen an anstehende Termine</li>
<li>Mitteilungen über notwendige Terminverschiebungen oder -absagen</li>
</ul>
<div class="consent-check-wrap">
  <label><input type="checkbox" class="consent-check" data-item="termin"> <strong>Ich willige ein</strong>, dass die Praxis mich per E-Mail über Termine benachrichtigt, erinnert oder mir Absagen mitteilt.</label>
</div>

<h2>3. Recalls (Vorsorge, Impfungen, Wiedervorstellungen)</h2>
<p>Recalls dienen der Qualitätssicherung und der Erhaltung meiner Gesundheit. Sie umfassen Erinnerungen an:</p>
<ul>
<li>Anstehende Vorsorgeuntersuchungen</li>
<li>Fällige Impfungen und Auffrischimpfungen</li>
<li>Bereits vereinbarte oder nötig gewordene Wiedervorstellungen</li>
<li>Aktuelle Behandlungshinweise im bestehenden Kontext</li>
</ul>
<div class="consent-check-wrap">
  <label><input type="checkbox" class="consent-check" data-item="recall"> <strong>Ich willige ein</strong>, dass die Praxis mich per E-Mail an Vorsorgeuntersuchungen, Impfungen, Wiedervorstellungen oder Behandlungshinweise erinnert.</label>
</div>

<h2>4. Datenschutzhinweis und Übermittlungsrisiko</h2>
<p>Die Verarbeitung meiner personenbezogenen Daten erfolgt auf Grundlage meiner freiwilligen Einwilligung gemäß <strong>Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO</strong>. Mir ist bekannt, dass die Übertragung von E-Mails grundsätzlich unverschlüsselt erfolgen kann und dass eine absolute Vertraulichkeit im Internet nicht garantiert ist. Ich nehme dieses Risiko freiwillig in Kauf.</p>
<p>Ich kann diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass meine medizinische Versorgung beeinträchtigt wird. Ein Widerruf hat keine rückwirkende Kraft.</p>
<p>Meine Rechte aus der DSGVO (Auskunft, Berichtigung, Löschung, Einschränkung, Beschwerde bei der Aufsichtsbehörde) bleiben unberührt.</p>

<div class="consent-check-wrap">
  <label><input type="checkbox" class="consent-check" data-item="datenschutz"> <strong>Ich habe die Datenschutzhinweise gelesen</strong> und nehme das Übermittlungsrisiko bei der E-Mail-Kommunikation zur Kenntnis.</label>
</div>

<h2>5. Einwilligungserklärung</h2>
<p>Mit meiner Unterschrift bestätige ich:</p>
<ul>
<li>dass ich die vorstehenden Abschnitte gelesen und verstanden habe,</li>
<li>dass ich alle erforderlichen Checkboxen zu den Themenbereichen gesetzt habe,</li>
<li>dass ich diese Einwilligung freiwillig erteile und</li>
<li>dass ich die Einwilligung jederzeit widerrufen kann.</li>
</ul>`
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    admin_id TEXT REFERENCES admin_users(id),
    refresh_token_hash TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_consent_encounter ON consent_submissions(encounter_id);`,
  `CREATE TABLE IF NOT EXISTS consent_form_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content_html TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE consent_submissions ADD COLUMN consent_items TEXT;`,
  `CREATE TABLE IF NOT EXISTS behandlungsvertrag_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id TEXT UNIQUE NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    patient_name TEXT NOT NULL,
    tariff TEXT NOT NULL,
    multiplier REAL,
    signature_svg TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_bv_encounter ON behandlungsvertrag_submissions(encounter_id);`,
  `CREATE TABLE IF NOT EXISTS bloodpressure_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id TEXT NOT NULL,
    systolic INTEGER NOT NULL,
    diastolic INTEGER NOT NULL,
    pulse INTEGER NOT NULL,
    weight REAL,
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_bp_encounter ON bloodpressure_readings(encounter_id);`,
  `CREATE TABLE IF NOT EXISTS deximed_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    slug TEXT,
    keywords TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_deximed_title ON deximed_articles(title);`,
  `CREATE INDEX IF NOT EXISTS idx_deximed_slug ON deximed_articles(slug);`,
  // GOA tables & quote tables
  `CREATE TABLE IF NOT EXISTS goa_tarife (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ziffer TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    base_euro REAL NOT NULL DEFAULT 0,
    multiplier REAL DEFAULT 2.3,
    keywords TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE INDEX IF NOT EXISTS idx_goa_ziffer ON goa_tarife(ziffer);`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    practice_id TEXT REFERENCES practices(id),
    pvs_patient_id TEXT,
    patient_dob TEXT,
    patient_email TEXT,
    patient_name TEXT,
    title TEXT NOT NULL DEFAULT 'Kostenvoranschlag',
    status TEXT DEFAULT 'draft',
    multiplier REAL DEFAULT 2.3,
    total_euro REAL DEFAULT 0,
    notes TEXT,
    signature_svg TEXT,
    signature_name TEXT,
    signed_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS quote_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id TEXT REFERENCES quotes(id) ON DELETE CASCADE,
    ziffer TEXT,
    title TEXT NOT NULL,
    description TEXT,
    quantity INTEGER DEFAULT 1,
    unit_euro REAL DEFAULT 0,
    line_euro REAL DEFAULT 0,
    base_euro REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS quote_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    items_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`,
  `ALTER TABLE practices ADD COLUMN recall_medflex_url TEXT;`,
  `ALTER TABLE practices ADD COLUMN recall_medatixx_url TEXT;`
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      linked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      pvs_patient_id TEXT,
      first_name TEXT,
      last_name TEXT,
      date_of_birth TEXT,
      gender TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
                VALUES ('demo-practice', 'Musterpraxis',
                        'Musterstraße 1', 'Musterstadt', '12345',
                        '01234 567890', 'praxis@example.com')`).run();
  }
  ensureConsentTemplates();
  ensureGoaeDefaults();
}

function ensureConsentTemplates() {
  for (const tpl of (consentSeeds.templates || [])) {
    db.prepare(`INSERT OR IGNORE INTO consent_form_templates (slug, title, content_html, version) VALUES (?, ?, ?, ?)`).run(
      tpl.slug, tpl.title, tpl.content_html, tpl.version
    );
  }
}

function ensureGoaeDefaults() {
  const count = db.prepare("SELECT COUNT(*) as n FROM goa_tarife").get() as { n: number };
  if (count && count.n > 0) return;
  const jsonPaths = [
    join(process.cwd(), "web", "goae-2013-ziffern-full.json"),
    join(process.cwd(), "web", "goae-2013-ziffern.json")
  ];
  let records: any[] = [];
  for (const p of jsonPaths) {
    try {
      const raw = readFileSync(p, "utf-8");
      records = JSON.parse(raw);
      if (records.length) break;
    } catch (e) { /* try next */ }
  }
  if (!records.length) {
    console.warn("GOAE default import: no JSON source found. Tabelle goa_tarife bleibt leer — bitte manuell befuellen.");
    return;
  }
  const insert = db.prepare("INSERT INTO goa_tarife (ziffer, title, description, base_euro, multiplier, keywords) VALUES (?, ?, ?, ?, ?, ?)");
  for (const rec of records) {
    const ziffer = String(rec.ziffer || "") .trim();
    const title = rec.bezeichnung || "";
    const description = rec.hinweis || rec.bemerkung || "";
    const keywords = [ziffer, title, description].join(" ").toLowerCase();
    const regStr = String(rec.regelsatz_2_3 || "0").replace(",", ".").trim();
    const baseEuro = parseFloat(regStr) || 0;
    insert.run(ziffer, title, description, baseEuro, 2.3, keywords);
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
