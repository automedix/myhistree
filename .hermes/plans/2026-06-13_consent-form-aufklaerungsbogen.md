# myhistree Aufklärungsbogen / Consent-Form Feature – Implementierungsplan

> **For Hermes:** Erst auf Staging (.190) testen, dann nach Go auf Prod (.237). Bevorzugte Branch: `feature/consent-form`

**Ziel:** MFA kann im Admin-Panel wählen, ob ein Patient eine Anamnese erhält (bestehend) oder einen Aufklärungsbogen (neu). Der Patient erhält einen E-Mail-Link mit PVS-Patienten-ID, öffnet eine mobile-first Webseite, liest den Bogen, gibt unten seinen Namen ein und unterschreibet digital (Touch/Canvas). Das unterschriebene Dokument erscheint im Dashboard, analog zur Anamnese-Detailansicht, und kann gedruckt/in die Akte/Archiv übernommen werden.

**Architektur:** Erweiterung des bestehenden Encounter- und Token-Systems. Jede Anfrage wird als `encounter` mit Typ `document_type` abgelegt (anamnese | consent_form). Patienten-Seite prüft unter `/auffklaerung/:token` den Token, zeigt den Inhalt, erfasst Name + Canvas-Unterschrift, speichert als JSON-Blob. Admin-API liefert consent-Daten unter `/api/consent/:encounterId`. Dashboard-Anzeige wiederverwendet bestehende Detail-Panel-Struktur (linke Spalte: Info, rechte Spalte: Dokument). Druck via `window.print()` mit `@media print`-Styles.

**Tech-Stack:** Fastify (TS), SQLite (betsqlite3), vanilla JS, Tailwind-ähnliches Utility-CSS (bestehend), Canvas 2D API.

**Akzeptanzkriterien:**
1. MFA sieht im Senden-Dialog ein Dropdown: "Dokumententyp: Anamnese | Aufklärungsbogen [NAME]"
2. Patient erhält E-Mail mit eindeutigem Link
3. Patient öffnet Link auf Handy, Bogen ist lesbar (mobile-first, große Schrift, guter Kontrast)
4. Patient muss bis ganz unten scrollen, gibt Namen ein, unterschreibet
5. Nach Absenden erscheint Erfolgsseite
6. Im Dashboard erscheint der Bogen mit Status "unterschrieben" + Name + Datum
7. Drucken des Bogens ist möglich (nur Inhalt + Unterschrift, keine UI)
8. Keine Regression bei Anamnese-Flow

---

## Phase 0: Infrastruktur & Scoping

### Task 0.1: Branch anlegen & Staging-Check

**Objective:** Sauberer Arbeitsbranch für das Feature

**Files:**
- Keine Code-Änderungen

**Step 1: Branch erstellen**

```bash
cd /root/myhistoree
git checkout -b feature/consent-form
git push -u origin feature/consent-form
```

**Step 2: Versionsnummer inkrementieren**

In `web/sw.js`, `web/js/app.js`, `web/admin/js/admin-*.js` sowie `package.json` die Patch-Version um 1 erhöhen (z.B. v0.6.6 → v0.6.7-consent.1).

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: bump version to v0.6.7-consent.1 for consent-form feature"
```

---

## Phase 1: Datenbank & Backend-API

### Task 1.1: DB-Schema erweitern

**Objective:** `encounters` Tabelle um `document_type` erweitern + neue `consent_submissions` Tabelle

**Files:**
- Modify: `server/src/db/init.ts`

**Step 1: Read existing init.ts**

Lese `server/src/db/init.ts` und finde die `encounters` CREATE TABLE Definition. Am Ende der Spaltenliste hinzufügen:

```sql
ALTER TABLE encounters ADD COLUMN document_type TEXT DEFAULT 'anamnese';
ALTER TABLE encounters ADD COLUMN consent_form_id TEXT DEFAULT NULL;
```

**Step 2: Neue Tabelle `consent_submissions`**

Füge nach den bestehenden CREATE TABLE Befehlen ein:

```sql
CREATE TABLE IF NOT EXISTS consent_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id INTEGER UNIQUE NOT NULL,
  patient_name TEXT NOT NULL,
  signature_svg TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);
```

**Step 3: Neue Tabelle `consent_form_templates`**

```sql
CREATE TABLE IF NOT EXISTS consent_form_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 4: Seed-Daten einfügen**

```sql
INSERT OR IGNORE INTO consent_form_templates (slug, title, content_html, version) VALUES
(
  'standard-datenschutz',
  'Datenschutz- und Behandlungseinwillingung',
  '<h2>1. Datenschutzerklärung</h2><p>…</p><h2>2. Behandlungseinwillingung</h2><p>…</p><h2>3. Widerspruchsrecht</h2><p>…</p>',
  '1.0'
);
```

**Step 5: Commit**

```bash
git add server/src/db/init.ts
git commit -m "feat(db): add document_type to encounters, consent_submissions and consent_form_templates tables"
```

---

### Task 1.2: API-Endpunkte für Consent Forms

**Objective:** Fastify-Routen für Consent-Form Flow

**Files:**
- Modify: `server/src/routes/api.ts`

**Step 1: Neue Imports**

```typescript
import { z } from "zod"; // falls noch nicht vorhanden
```

**Step 2: Route: Liste verfügbarer Aufklärungsbögen**

```typescript
fastify.get("/consent-forms", async () => {
  const db = fastify.sqlite;
  const templates = db.prepare("SELECT id, slug, title, version FROM consent_form_templates WHERE 1=1").all();
  return { templates };
});
```

**Step 3: Route: Consent-Submission speichern**

```typescript
fastify.post("/consent/:encounterId/submit", async (request, reply) => {
  const { encounterId } = request.params as { encounterId: string };
  const body = z.object({
    patientName: z.string().min(2),
    signatureSvg: z.string().min(100),
  }).parse(request.body);

  const encounter = (request as any).sqlite
    .prepare("SELECT id, status FROM encounters WHERE id = ?")
    .get(encounterId);
  if (!encounter) return reply.status(404).send({ error: "Not found" });
  if (encounter.status === "completed") return reply.status(409).send({ error: "Already submitted" });

  const ip = request.ip;
  const ua = request.headers["user-agent"] || "";
  const now = new Date().toISOString();

  (request as any).sqlite.prepare(`
    INSERT INTO consent_submissions (encounter_id, patient_name, signature_svg, signed_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(encounter_id) DO UPDATE SET
      patient_name = excluded.patient_name,
      signature_svg = excluded.signature_svg,
      signed_at = excluded.signed_at,
      ip_address = excluded.ip_address,
      user_agent = excluded.user_agent
  `).run(encounterId, body.patientName, body.signatureSvg, now, ip, ua);

  (request as any).sqlite.prepare("UPDATE encounters SET status = 'completed', completed_at = ? WHERE id = ?")
    .run(now, encounterId);

  return { success: true, signedAt: now };
});
```

**Step 4: Route: Consent-Details abrufen (Admin)**

```typescript
fastify.get("/consent/:encounterId", async (request, reply) => {
  const { encounterId } = request.params as { encounterId: string };
  const db = (request as any).sqlite;

  const encounter = db.prepare(`
    SELECT e.*, c.patient_name, c.signature_svg, c.signed_at, c.ip_address, c.user_agent
    FROM encounters e
    LEFT JOIN consent_submissions c ON c.encounter_id = e.id
    WHERE e.id = ? AND e.document_type = 'consent_form'
  `).get(encounterId);

  if (!encounter) return reply.status(404).send({ error: "Not found" });

  const template = db.prepare("SELECT * FROM consent_form_templates WHERE slug = ?")
    .get(encounter.consent_form_id || "standard-datenschutz");

  return { encounter, template };
});
```

**Step 5: Route: Encounter-Erstellung um document_type erweitern**

Suche die bestehende POST-Route für Encounters (vermutlich `/encounters` oder in MFA-Routen). Das `insert` Statement muss `document_type` und `consent_form_id` enthalten. Die Validierung muss akzeptieren:

```typescript
const encounterBody = z.object({
  pvsPatientId: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  dob: z.string().optional(),
  documentType: z.enum(["anamnese", "consent_form"]).default("anamnese"),
  consentFormId: z.string().optional(),
});
```

Beim INSERT:
```sql
INSERT INTO encounters (pvs_patient_id, email, phone, mobile, dob, document_type, consent_form_id, token, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
```

**Step 6: Anpassung der bestehenden `/anamnese/:token` GET Route**

In `server/src/index.ts` (oder wo die Route definiert ist), muss die Route erkennen, ob es ein consent_form ist, und dann auf `/auffklaerung/{token}` redirecten.

```typescript
app.get("/anamnese/:token", async (request, reply) => {
  const { token } = request.params as { token: string };
  const row = app.sqlite.prepare("SELECT document_type FROM encounters WHERE token = ?").get(token);
  if (!row) return reply.status(404).send("Ungültiger Link");
  if (row.document_type === "consent_form") {
    return reply.redirect(`/auffklaerung/${token}`);
  }
  // bestehende Anamnese-Logik …
});
```

**Step 7: Commit**

```bash
git add server/src/routes/api.ts server/src/index.ts
git commit -m "feat(api): add consent form routes, document_type support, redirect logic"
```

---

### Task 1.3: E-Mail-Versand für Consent-Form-Link

**Objective:** Neuer E-Mail-Typ + Versandfunktion für Aufklärungsbögen

**Files:**
- Modify: `server/src/email/sender.ts`
- Modify: `server/src/routes/api.ts`

**Step 1: Neue Funktion in sender.ts**

```typescript
export async function sendConsentFormLink(
  to: string,
  pvsPatientId: string,
  linkUrl: string,
  patientDob?: string,
  pin?: string | null,
  formTitle?: string,
) {
  const pinBlock = pin ? `🔢 PIN: ${pin}\n` : "";
  const dobFormatted = patientDob ? formatDisplayDOB(patientDob) : "nicht angegeben";
  const title = formTitle || "Aufklärungs- und Einwillingungsbogen";

  const textBody = `Guten Tag,\n\nvor Ihrem Termin bitten wir Sie, den folgenden ${title} zur Kenntnis zu nehmen und digital zu unterschreiben.\n\nIhre Praxis-Patienten-ID: ${pvsPatientId}\nGeburtsdatum: ${dobFormatted}\n\n🔗 Link zum Aufklärungsbogen:\n${linkUrl}\n${pinBlock}\nDer Link ist für Sie persönlich bestimmt und kann nur mit Ihrem Geburtsdatum${pin ? " und der PIN" : ""} geöffnet werden.\n\nSie können den Bogen bequem auf Ihrem Smartphone lesen und unterschreiben.\n\nMit freundlichen Grüßen\nIhr Praxis-Team\nHausärzte im Grillepark\n\n--\nAntworten bitte an: ${REPLY_TO}`;

  const htmlBody = `<!DOCTYPE html>…`; // analog zu Anamnese-Mail, aber mit anderer Überschrift und Hinweis auf "Lesen & Unterschreiben"

  return sendMail({ to, subject: `${title} – Hausärzte im Grillepark`, textBody, htmlBody });
}
```

Das HTML sollte den Call-to-Action klar als "Zum Aufklärungsbogen" labeln.

**Step 2: Route `/api/send-link` anpassen**

In `api.ts` bei der bestehenden `send-link` Route:

```typescript
if (documentType === "consent_form") {
  const templateTitle = /* fetch from DB */ "Aufklärungs- und Einwillingungsbogen";
  await sendConsentFormLink(to, pvsPatientId, linkUrl, patientDob, pin, templateTitle);
} else {
  await sendAnamneseLink(to, pvsPatientId, linkUrl, patientDob, pin);
}
```

**Step 3: Commit**

```bash
git add server/src/email/sender.ts server/src/routes/api.ts
git commit -m "feat(email): add sendConsentFormLink + wire into send-link route"
```

---

## Phase 2: Patienten-Frontend (Consent-Form-Anzeige)

### Task 2.1: Neue HTML-Seite für Aufklärungsbogen

**Objective:** Mobile-first Seite `/auffklaerung/:token` mit Bogen-Anzeige, Scroll-Tracking, Name, Unterschrift

**Files:**
- Create: `web/auffklaerung.html`
- Create: `web/js/consent-form.js`
- Create: `web/css/consent-form.css`

**Struktur von `web/auffklaerung.html`:**

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Aufklärungsbogen | myhistree</title>
  <link rel="stylesheet" href="/css/consent-form.css?v=0.6.7c">
</head>
<body>
  <div id="loading">Lade Dokument…</div>
  <div id="error-screen" class="hidden">…</div>
  
  <div id="consent-screen" class="hidden">
    <header class="cf-header">
      <h1 id="form-title">Aufklärungsbogen</h1>
      <div class="patient-info">PVS-ID: <span id="pvs-id"></span></div>
    </header>
    
    <main class="cf-content" id="form-content">
      <!-- HTML-Content aus DB wird hier injiziert -->
    </main>
    
    <section class="cf-sign-section" id="sign-section">
      <p class="legal-hint">Mit Ihrer Unterschrift bestätigen Sie, dass Sie den oben stehenden Text vollständig gelesen und verstanden haben und in die dort genannten Maßnahmen einwilligen.</p>
      
      <label for="patient-name">Vor- und Nachname des Patienten/der Patientin</label>
      <input type="text" id="patient-name" placeholder="z.B. Max Mustermann" autocomplete="name" required>
      
      <div class="signature-wrap">
        <label>Unterschrift</label>
        <canvas id="signature-pad" width="600" height="200"></canvas>
        <button type="button" id="clear-sig" class="btn-secondary">Unterschrift löschen</button>
      </div>
      
      <div class="meta-info">
        <p>IP: <span id="ip-hint">wird erfasst</span> | Zeit: <span id="time-hint">–</span></p>
      </div>
      
      <button id="submit-consent" class="btn-primary" disabled>
        Dokument unterschreiben & absenden
      </button>
    </section>
  </div>
  
  <div id="success-screen" class="hidden">
    <h2>✅ Vielen Dank!</h2>
    <p>Ihr Aufklärungsbogen wurde erfolgreich übermittelt.</p>
    <p class="subtitle">Sie können dieses Fenster jetzt schließen.</p>
  </div>

  <script src="/js/consent-form.js?v=0.6.7c"></script>
</body>
</html>
```

**Step 2: CSS `web/css/consent-form.css`**

```css
:root { --primary: #1e3a5f; --accent: #3b82f6; --bg: #f8fafc; --text: #1e293b; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html { font-size: 18px; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
.hidden { display: none !important; }

/* Header */
.cf-header { background: var(--primary); color: #fff; padding: 1.5rem 1rem; position: sticky; top: 0; z-index: 10; }
.cf-header h1 { margin: 0 0 0.3rem; font-size: 1.4rem; }
.patient-info { font-size: 0.85rem; opacity: 0.85; }

/* Content */
.cf-content { padding: 1.5rem 1rem; max-width: 680px; margin: 0 auto; }
.cf-content h2 { font-size: 1.25rem; color: var(--primary); margin-top: 2rem; }
.cf-content p { margin: 0.8rem 0; }
.cf-content ul { padding-left: 1.2rem; }

/* Sign Section */
.cf-sign-section { background: #fff; border-top: 4px solid var(--accent); padding: 2rem 1rem; max-width: 680px; margin: 0 auto; }
.legal-hint { font-size: 0.95rem; color: #475569; margin-bottom: 1.5rem; }
label { display: block; font-weight: 600; margin: 1.2rem 0 0.4rem; font-size: 0.95rem; }
input[type="text"] { width: 100%; padding: 0.9rem 1rem; font-size: 1.1rem; border: 2px solid #cbd5e1; border-radius: 8px; }
input:focus { outline: none; border-color: var(--accent); }

.signature-wrap { margin: 1.5rem 0; }
#signature-pad { width: 100%; height: 180px; background: #fff; border: 2px solid #cbd5e1; border-radius: 8px; touch-action: none; cursor: crosshair; }
.btn-secondary { background: transparent; border: 1px solid #94a3b8; color: #64748b; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; margin-top: 0.5rem; cursor: pointer; }
.btn-primary { width: 100%; padding: 1rem; font-size: 1.1rem; background: var(--accent); color: #fff; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 1.5rem; }
.btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
.meta-info { font-size: 0.75rem; color: #94a3b8; margin-top: 1rem; text-align: center; }

/* Success */
#success-screen { text-align: center; padding: 4rem 1rem; }
#success-screen h2 { color: var(--primary); font-size: 1.6rem; }
.subtitle { color: #64748b; margin-top: 0.5rem; }

/* Error */
#error-screen { text-align: center; padding: 3rem 1rem; color: #dc2626; }

@media print {
  .cf-header, .cf-sign-section, #success-screen, #error-screen, button { display: none !important; }
  .cf-content { padding: 0; max-width: 100%; }
  body { background: #fff; color: #000; }
}
```

**Step 3: Commit**

```bash
git add web/auffklaerung.html web/css/consent-form.css
git commit -m "feat(consent): add patient consent form HTML + CSS (mobile-first)"
```

---

### Task 2.2: Consent-Form JavaScript

**Objective:** Token-Validierung, Content laden, Canvas-Unterschrift, Submit-Logik

**Files:**
- Create: `web/js/consent-form.js`

**Vollständige JS-Datei:**

```javascript
// myhistree Consent Form – Patient View
(async () => {
  const API = window.location.origin;
  const m = window.location.pathname.match(/\/auffklaerung\/([a-f0-9-]{32,})/);
  const token = m ? m[1] : null;
  if (!token) return showError("Ungültiger Link");

  const els = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error-screen'),
    consent: document.getElementById('consent-screen'),
    success: document.getElementById('success-screen'),
    formContent: document.getElementById('form-content'),
    formTitle: document.getElementById('form-title'),
    pvsId: document.getElementById('pvs-id'),
    nameInput: document.getElementById('patient-name'),
    canvas: document.getElementById('signature-pad'),
    clearBtn: document.getElementById('clear-sig'),
    submitBtn: document.getElementById('submit-consent'),
    timeHint: document.getElementById('time-hint'),
  };

  let encounterId = null;
  let hasScrolledToBottom = false;
  let isDrawing = false;
  let hasSignature = false;

  // ─── Token validieren & Daten laden ───
  async function init() {
    try {
      const res = await fetch(`${API}/api/encounter-by-token/${token}`); // neuer Endpunkt oder bestehenden anpassen
      if (!res.ok) throw new Error("Ungültig");
      const data = await res.json();
      if (data.document_type !== 'consent_form') throw new Error("Kein Aufklärungsbogen");
      
      encounterId = data.id;
      els.formTitle.textContent = data.consent_title || 'Aufklärungsbogen';
      els.pvsId.textContent = data.pvs_patient_id;
      els.formContent.innerHTML = data.consent_html || '<p>Kein Inhalt verfügbar.</p>';
      els.timeHint.textContent = new Date().toLocaleString('de-DE');
      
      els.loading.classList.add('hidden');
      els.consent.classList.remove('hidden');
      
      setupScrollTracking();
      setupCanvas();
      setupValidation();
    } catch (err) {
      console.error(err);
      showError("Dieser Link ist ungültig oder bereits abgelaufen.");
    }
  }

  function showError(msg) {
    els.loading?.classList.add('hidden');
    els.consent?.classList.add('hidden');
    els.error?.classList.remove('hidden');
    if (els.error) els.error.querySelector('p').textContent = msg;
  }

  // ─── Scroll-Tracking (muss ganz unten sein) ───
  function setupScrollTracking() {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) hasScrolledToBottom = true;
      checkEnableSubmit();
    }, { threshold: 0.5 });
    observer.observe(els.formContent.lastElementChild || els.formContent);
  }

  // ─── Canvas Unterschrift ───
  function setupCanvas() {
    const ctx = els.canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e) => {
      const rect = els.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - rect.left) * (els.canvas.width / rect.width), y: (clientY - rect.top) * (els.canvas.height / rect.height) };
    };

    const start = (e) => { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e) => { if (!isDrawing) return; e.preventDefault(); const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSignature = true; checkEnableSubmit(); };
    const end = () => { isDrawing = false; };

    els.canvas.addEventListener('mousedown', start);
    els.canvas.addEventListener('mousemove', move);
    els.canvas.addEventListener('mouseup', end);
    els.canvas.addEventListener('mouseleave', end);
    els.canvas.addEventListener('touchstart', start, { passive: false });
    els.canvas.addEventListener('touchmove', move, { passive: false });
    els.canvas.addEventListener('touchend', end);

    els.clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      hasSignature = false;
      checkEnableSubmit();
    });
  }

  // ─── Validierung ───
  function setupValidation() {
    els.nameInput.addEventListener('input', checkEnableSubmit);
    els.submitBtn.addEventListener('click', submitConsent);
  }

  function checkEnableSubmit() {
    const nameOk = els.nameInput.value.trim().length >= 2;
    const canSubmit = hasScrolledToBottom && nameOk && hasSignature;
    els.submitBtn.disabled = !canSubmit;
  }

  // ─── Absenden ───
  async function submitConsent() {
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = 'Wird übermittelt…';

    const svg = canvasToSvg(els.canvas);
    try {
      const res = await fetch(`${API}/api/consent/${encounterId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: els.nameInput.value.trim(),
          signatureSvg: svg,
        }),
      });
      if (!res.ok) throw new Error('Submit failed');
      els.consent.classList.add('hidden');
      els.success.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = 'Dokument unterschreiben & absenden';
      alert('Fehler bei der Übermittlung. Bitte versuchen Sie es erneut.');
    }
  }

  function canvasToSvg(canvas) {
    const w = canvas.width, h = canvas.height;
    // Simpler SVG-Export: Wir speichern das Canvas als base64-PNG innerhalb eines SVG
    const png = canvas.toDataURL('image/png');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${png}" width="${w}" height="${h}"/></svg>`;
  }

  init();
})();
```

**WICHTIG:** Der Endpunkt `/api/encounter-by-token/:token` muss existieren oder angepasst werden. Falls noch nicht vorhanden, in `api.ts` ergänzen:

```typescript
fastify.get("/encounter-by-token/:token", async (request, reply) => {
  const { token } = request.params as { token: string };
  const db = (request as any).sqlite;
  const row = db.prepare(`
    SELECT e.*, t.title as consent_title, t.content_html as consent_html
    FROM encounters e
    LEFT JOIN consent_form_templates t ON t.slug = COALESCE(e.consent_form_id, 'standard-datenschutz')
    WHERE e.token = ?
  `).get(token);
  if (!row) return reply.status(404).send({ error: "Not found" });
  return row;
});
```

**Step 4: Commit**

```bash
git add web/js/consent-form.js server/src/routes/api.ts
git commit -m "feat(consent): add patient consent form JS with scroll tracking, canvas signature, submit"
```

---

## Phase 3: Admin-Panel-Erweiterung

### Task 3.1: MFA Senden-Dialog um Dokumenttyp-Auswahl erweitern

**Objective:** Beim Versenden kann MFA zwischen Anamnese und Aufklärungsbogen wählen

**Files:**
- Modify: `web/admin/index.html`
- Modify: `web/admin/js/admin-0.5.7.js` (aktuelle Version nachsehen!)

**Step 1: HTML-Änderungen im Senden-Dialog**

Im Admin-Panel (vermutlich ID `#send-modal` oder ähnlich), vor der E-Mail-Eingabe ein Dropdown einfügen:

```html
<div class="form-row">
  <label for="doc-type">Dokumententyp</label>
  <select id="doc-type" class="form-select">
    <option value="anamnese" selected>Anamnesebogen</option>
    <option value="consent_form">Aufklärungsbogen</option>
  </select>
</div>
<div class="form-row" id="consent-form-select-row" style="display:none;">
  <label for="consent-form-id">Aufklärungsbogen</label>
  <select id="consent-form-id" class="form-select">
    <!-- wird per JS befüllt -->
  </select>
</div>
```

**Step 2: JavaScript-Anpassungen**

```javascript
// Beim Öffnen des Modals: Templates laden
async function openSendModal(patientId) {
  // ... bestehende Logik ...
  
  const docTypeSelect = document.getElementById('doc-type');
  const consentRow = document.getElementById('consent-form-select-row');
  const consentSelect = document.getElementById('consent-form-id');
  
  // Templates laden
  const templatesRes = await fetch(`${API}/api/consent-forms`);
  const { templates } = await templatesRes.json();
  consentSelect.innerHTML = templates.map(t => `<option value="${t.slug}">${t.title}</option>`).join('');
  
  docTypeSelect.addEventListener('change', () => {
    consentRow.style.display = docTypeSelect.value === 'consent_form' ? 'block' : 'none';
  });
  
  // ... Modal anzeigen ...
}

// Beim Absenden: documentType mitübergeben
async function sendLink(patientId) {
  const docType = document.getElementById('doc-type').value;
  const consentFormId = docType === 'consent_form' ? document.getElementById('consent-form-id').value : null;
  
  const res = await fetch(`${API}/api/send-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId,
      email: document.getElementById('send-email').value,
      documentType: docType,
      consentFormId,
      // ...
    }),
  });
  // ...
}
```

**Step 3: Commit**

```bash
git add web/admin/index.html web/admin/js/admin-0.5.7.js
git commit -m "feat(admin): add document type selector in send modal (anamnese vs consent)"
```

---

### Task 3.2: Dashboard-Anzeige für eingereichte Consent Forms

**Objective:** Neue Tab-Seite oder Filter in der Dashboard-Ansicht

**Files:**
- Modify: `web/admin/index.html`
- Modify: `web/admin/js/admin-0.5.7.js`

**Step 1: Neue Dashboard-Tab oder Filter**

Dashboard hat vermutlich Tabs wie "Wartend", "In Bearbeitung", "Abgeschlossen", "Archiv". Wir fügen einen Filter "Dokumenttyp" hinzu oder eine zusätzliche Spalte.

```javascript
// In der Render-Funktion der Patientenliste
function renderPatientRow(row) {
  const docTypeLabel = row.document_type === 'consent_form' 
    ? 'Aufklärungsbogen' 
    : 'Anamnese';
  const docTypeBadge = `<span class="badge ${row.document_type === 'consent_form' ? 'badge-consent' : 'badge-anamnese'}">${docTypeLabel}</span>`;
  
  // ... in die Zeile einbauen ...
}
```

**Step 2: Detail-Panel anpassen**

Wenn auf eine Zeile geklickt wird, muss das Detail-Panel je nach `document_type` unterschiedliche Inhalte zeigen.

```javascript
async function showDetail(encounterId, documentType) {
  if (documentType === 'consent_form') {
    const res = await fetch(`${API}/api/consent/${encounterId}`);
    const data = await res.json();
    renderConsentDetail(data);
  } else {
    // bestehende Anamnese-Detail-Logik
    renderAnamneseDetail(encounterId);
  }
}

function renderConsentDetail(data) {
  const html = `
    <div class="detail-header">
      <h3>${data.template.title}</h3>
      <span class="status-badge completed">Unterschrieben</span>
    </div>
    <div class="detail-meta">
      <p><strong>Patient:</strong> ${data.encounter.patient_name}</p>
      <p><strong>Unterschrieben am:</strong> ${new Date(data.encounter.signed_at).toLocaleString('de-DE')}</p>
      <p><strong>PVS-ID:</strong> ${data.encounter.pvs_patient_id}</p>
    </div>
    <div class="detail-content">
      <div class="consent-document-preview">
        ${data.template.content_html}
      </div>
      <div class="signature-box">
        <p><strong>Unterschrift:</strong></p>
        <div class="signature-render">${data.encounter.signature_svg}</div>
      </div>
    </div>
    <div class="detail-actions">
      <button onclick="printConsentDetail()" class="btn-primary">🖨️ Drucken</button>
      <button onclick="archiveEncounter(${data.encounter.id})" class="btn-secondary">📁 Archivieren</button>
    </div>
  `;
  document.getElementById('detail-panel').innerHTML = html;
}
```

**Step 3: Print-Styles für Detail-Ansicht**

```css
@media print {
  .detail-panel { position: static; width: 100%; height: auto; box-shadow: none; }
  .detail-actions, .detail-header .status-badge { display: none; }
  .consent-document-preview { font-size: 12pt; line-height: 1.6; }
  .signature-render { border: 1px solid #000; padding: 1rem; page-break-inside: avoid; }
}
```

**Step 4: Commit**

```bash
git add web/admin/
git commit -m "feat(admin): dashboard detail view for consent forms with print support"
```

---

## Phase 4: Integration, Build & Test

### Task 4.1: Redirect & Static File Serving

**Objective:** `/auffklaerung/:token` als Route im Backend registrieren

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Neue Route registrieren**

```typescript
app.get("/auffklaerung/:token", async (request, reply) => {
  return reply.sendFile("auffklaerung.html", { root: path.join(__dirname, "../../web") });
});
```

(Falls `sendFile` nicht konfiguriert ist, `reply.type('text/html').send(fs.readFileSync(...))` verwenden.)

**Step 2: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): serve /auffklaerung/:token route"
```

---

### Task 4.2: Build & Type-Check

**Objective:** TypeScript kompiliert fehlerfrei

**Files:**
- Keine neuen Dateien

**Step 1: Build ausführen**

```bash
cd /root/myhistoree/server
npx tsc --noEmit
npm run build
```

**Step 2: Fehler beheben**

Typische Fehler:
- `(request as any).sqlite` → ggf. `request.server.sqlite` oder korrekten Fastify-Context verwenden
- `z.object` Import prüfen
- `prepare().all()` / `get()` Rückgabetypen

**Step 3: Commit**

```bash
git add -A
git commit -m "fix(build): resolve typescript errors for consent form feature"
```

---

### Task 4.3: Lokaler Test

**Objective:** Feature end-to-end lokal testen

**Files:**
- Keine Code-Änderungen

**Step 1: Server starten**

```bash
cd /root/myhistoree
docker compose up --build -d
```

**Step 2: Admin-Panel öffnen**

```bash
curl -s http://localhost:3000/admin | head -5
```

**Step 3: MFA-Prozess testen**

1. Patient auswählen → "Link senden"
2. Typ: "Aufklärungsbogen" wählen
3. E-Mail senden (ggf. an eine Test-Adresse)
4. Link aus Logs/Mail-Output kopieren

**Step 4: Patienten-Flow testen**

1. Link im Browser/Handy-Emulator öffnen
2. Inhalt lesen, runterscrollen
3. Namen eingeben
4. Unterschreiben (Maus/Touch simulieren)
5. Absenden
6. Erfolgsmeldung prüfen

**Step 5: Dashboard prüfen**

1. Admin-Panel → Dashboard
2. Neue Eintrag erscheint als "Aufklärungsbogen – Unterschrieben"
3. Detail-Ansicht öffnen
4. Name, Unterschrift, Inhalt prüfen
5. Druckvorschau testen (`Strg+P`)

**Step 6: Regressionstest**

1. Anamnese-versenden → Patient füllt aus → erscheint im Dashboard
2. Keine 404er, keine Console-Errors

**Step 7: Test-Daten aufräumen**

```bash
# SQLite-Test-Einträge löschen
docker exec myhistoree-server sqlite3 /data/myhistree.db "DELETE FROM consent_submissions; DELETE FROM encounters WHERE document_type='consent_form';"
```

---

### Task 4.4: Staging-Deployment (.190)

**Objective:** Feature auf dem experimentellen Server testen

> ⚠️ **NUR .190** – NIEMALS ohne Go auf .237

**Step 1: .190 deployen**

```bash
cd /root/myhistoree
# Stelle sicher, dass .190 im Skill korrekt konfiguriert ist
# nach myhistoree-devops skill:
hermes-deploy # oder manuell via rsync
```

**Step 2: Version prüfen**

```bash
ssh root@217.160.242.190 "cat /opt/myhistoree/web/js/consent-form.js | head -3"
```

**Step 3: MFA-Test mit echter E-Mail**

1. Echte E-Mail-Adresse verwenden (z.B. ivo.schmid@pm.me)
2. Auf Handy öffnen
3. Mobile-first Check: Lesbarkeit, Touch-Unterschrift, Scroll-Verhalten
4. Verschiedene Browser testen (Chrome Mobile, Safari iOS)

**Step 4: Edge Cases testen**

- Bereits unterschrieben → erneuter Zugriff: Sollte "Bereits unterschrieben" zeigen oder erneuten Zugriff verweigern
- Ungültiger Token → 404-Fehlerseite
- Abgelaufener Link → entsprechende Meldung
- Canvas leer → Submit-Button disabled
- Name zu kurz → Submit disabled
- Nicht bis unten gescrollt → Submit disabled

**Step 5: Monitoring**

```bash
# Server-Logs beobachten
ssh root@217.160.242.190 "docker logs -f myhistoree-server"
```

**Step 6: Bugfixes in Branch, dann `git push`**

---

## Phase 5: Abschluss & Merge

### Task 5.1: Produktionsreife

**Objective:** Code-Cleanup, Dokumentation, Versions-Bump

**Step 1: i18n-Keys prüfen**

Falls `web/js/app.js` i18n-Objekt verwendet: Auch für Consent-Form neue Keys hinzufügen (fallback auf Deutsch).

**Step 2: Cache-Busting sicherstellen**

- `?v=0.6.7c` (oder aktuelle Versionsnummer) auf alle neuen Assets prüfen
- Service Worker (`sw.js`) aktualisieren, falls er statische Files cached

**Step 3: README/CHANGELOG aktualisieren**

```markdown
## v0.6.7 – Aufklärungsbögen (Consent Forms)
- MFA kann optional Aufklärungsbögen statt Anamnese senden
- Patienten lesen, unterschreiben digital auf Handy
- Dashboard zeigt unterschriebene Dokumente mit Druckfunktion
```

**Step 4: Commit & Push**

```bash
git add -A
git commit -m "feat(consent): finalize consent form feature, v0.6.7"
git push origin feature/consent-form
```

---

## Task 5.2: Go für .237 einholen & Merge

**Objective:** Feature in Produktion bringen

> ⚠️ **.237 NUR mit explizitem Go vom Benutzer**

**Step 1: PR erstellen**

```bash
gh pr create --title "feat: Aufklärungsbögen (Consent Forms) v0.6.7" --body "…"
```

**Step 2: Auf "go" vom Benutzer warten**

**Step 3: Merge & Deploy**

```bash
git checkout main
git merge --no-ff feature/consent-form
git push origin main
# .237 deployen (nur nach go!)
```

---

## Risiken & Tradeoffs

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Canvas-Signatur auf iOS/Safari buggy | Mittel | Hoch | Extensives Device-Testing auf .190; Fallback auf Text-Eingabe „[Name] hat gelesen“ wenn Canvas leer |
| Rechtliche Wirksamkeit digitaler Signatur | Niedrig | Hoch | Keine rechtliche Qualifizierte Elektronische Signatur (QES), sondern „einfache Elektronische Signatur“ als Dokumentation. Hinweis: „Dies ist eine dokumentarische Unterschrift, keine QES.“ |
| Datenbank-Schema-Migration auf .237 | Mittel | Mittel | ALTER TABLE sicherstellen; bei SQLite kein Problem. Prod-Backup vor Deploy. |
| E-Mail als Spam markiert | Niedrig | Mittel | Subject-Zeile nicht „dringend“; bestehende DKIM/SPF-Einstellungen nutzen |
| Patient versteht Flow nicht | Mittel | Mittel | Klare Sprache, Hinweis „Bitte lesen Sie den Text komplett durch“, visuelle Scroll-Indikatoren |

## Offene Fragen (vom Benutzer klären lassen)

1. **Welche Aufklärungsbögen genau?** Datenschutz + Behandlungseinwillingung sind erfasst. Sollen weitere Bögen (z.B. Impfaufklärung, MRT-Kontrastmittel) hinterlegt werden?
2. **Text des Bogens:** Soll der Inhalt statisch im Repo liegen (wie geplant) oder soll es einen Admin-Editor geben, mit dem die Praxis die Texte selbst pflegen kann?
3. **Rechtlicher Disclaimer:** Soll unter der Unterschrift ein Satz stehen wie „Dies ist eine dokumentarische elektronische Signatur gemäß § 126a BGB (einfache Form)“?
4. **Mehrsprachigkeit:** Sollen Aufklärungsbögen auch auf Englisch/Türkisch/… verfügbar sein?

---

## Zusammenfassung der neuen/geänderten Dateien

**Neu:**
- `web/auffklaerung.html`
- `web/js/consent-form.js`
- `web/css/consent-form.css`

**Geändert:**
- `server/src/db/init.ts`
- `server/src/routes/api.ts`
- `server/src/email/sender.ts`
- `server/src/index.ts`
- `web/admin/index.html`
- `web/admin/js/admin-*.js`
- `web/sw.js` (Cache-Version)
- `package.json` (Versionsnummer)

**Lesezugriff (für Kontext):**
- `web/js/app.js` (i18n-Struktur)
- `server/src/db/index.ts` (DB-Access-Pattern)
