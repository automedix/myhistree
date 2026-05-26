// myhistoree Admin Dashboard JS v0.4.0
const API = '/api';
let encounterFilter = 'all'; // 'all' | 'completed' | 'in-progress'
const CURRENT_PRACTICE = 'demo-practice';

// ─── Tab Switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  if (tab === 'links') loadLinks();
  if (tab === 'encounters') loadEncounters();
  if (tab === 'audit') loadAuditLog();
}

// ─── Link erstellen ─────────────────────────────────────────────
async function createLink() {
  const pvsId = document.getElementById('new-pvs-id').value.trim();
  const dob = document.getElementById('new-patient-dob').value;
  const email = document.getElementById('new-patient-email').value.trim();
  const usePin = document.getElementById('new-use-pin').checked;
  const pin = usePin ? document.getElementById('new-pin').value.trim() : undefined;
  const requiresPin = usePin && !pin;
  const expiry = parseInt(document.getElementById('new-expiry').value);
  const btn = document.getElementById('btn-create');

  if (!pvsId) { alert('Bitte PVS Patienten-ID eingeben.'); return; }
  if (!dob) { alert('Bitte Geburtsdatum eingeben.'); return; }
  if (usePin && pin && pin.length < 4) { alert('Bitte eine PIN mit mindestens 4 Ziffern eingeben.'); return; }

  btn.disabled = true;
  btn.textContent = 'Wird erstellt...';

  try {
    const res = await fetch(`${API}/link/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: pvsId, patientDob: dob, patientEmail: email, pin, requiresPin, expiresHours: expiry })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    const baseUrl = window.location.origin.replace('/admin', '');
    const fullUrl = `${baseUrl}/anamnese/${data.token}`;
    const displayPin = data.pin || pin;
    showLinkResult(pvsId, dob, usePin || !!data.pin, displayPin, data.expiresAt, fullUrl);

    document.getElementById('link-result').style.display = 'block';
    document.getElementById('new-pvs-id').value = '';
    document.getElementById('new-patient-dob').value = '';
    document.getElementById('new-patient-email').value = '';
    document.getElementById('new-use-pin').checked = false;
    document.getElementById('pin-row').style.display = 'none';
    document.getElementById('new-pin').value = '';
    loadLinks();
  } catch(e) {
    alert('Fehler: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Link erstellen';
  }
}

function copyLink() {
  const url = document.getElementById('link-url').textContent;
  navigator.clipboard.writeText(url).then(() => alert('Link kopiert!'));
}

// ─── QR Code ────────────────────────────────────────────────────
function generateQR(containerId, url, size) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  return new QRCode(container, {
    text: url,
    width: size,
    height: size,
    colorDark: '#1e293b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function showQRFullscreen(url) {
  const el = document.getElementById('qr-fullscreen');
  const container = document.getElementById('qr-fullscreen-canvas');
  container.innerHTML = '';
  new QRCode(container, { text: url, width: 400, height: 400, colorDark: '#1e293b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  el.style.display = 'flex';
  history.pushState({qr: true}, '');
}

function closeQRFullscreen() {
  document.getElementById('qr-fullscreen').style.display = 'none';
  history.back();
}

window.addEventListener('popstate', function(e) {
  document.getElementById('qr-fullscreen').style.display = 'none';
});

function showQRModal(url, title) {
  showModal(title || 'QR-Code', `
    <div class="qr-container qr-big">
      <div id="qr-modal-canvas"></div>
      <div class="qr-actions">
        <button class="btn btn-primary" onclick="showQRFullscreen('${url}')">📷 Gross zeigen</button>
      </div>
    </div>
  `);
  setTimeout(() => generateQR('qr-modal-canvas', url, 280), 50);
}

// ─── Link result with QR ────────────────────────────────────────
function showLinkResult(pvsId, dob, usePin, pin, expiresAt, fullUrl) {
  const pinHtml = usePin ? `<div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">PIN: ${pin}</div>` : '';
  const dobFormatted = new Date(dob).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

  document.getElementById('link-result').innerHTML = `
    <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:16px;">
      <div style="font-weight:600;color:#166534;margin-bottom:8px;">Link erstellt!</div>
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">PVS Patienten-ID: ${pvsId}</div>
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">Geburtsdatum: ${dobFormatted}</div>
      ${pinHtml}
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:8px;">Gueltig bis: ${new Date(expiresAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</div>
      <div class="url-box" id="link-url">${fullUrl}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-sm" onclick="copyLink()">Kopieren</button>
        <button class="btn btn-sm btn-success" onclick="window.open('${fullUrl}', '_blank')">Oeffnen</button>
        <button class="btn btn-sm btn-primary" onclick="showQRFullscreen('${fullUrl}')">📷 QR anzeigen</button>
      </div>
    </div>
  `;
}

// ─── Links laden ────────────────────────────────────────────────
async function loadLinks() {
  const container = document.getElementById('links-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/link/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Links erstellt</div>'; return; }

    const html = `
      <table>
        <thead>
          <tr><th>Token</th><th>PVS Patienten-ID</th><th>Verifizierung</th><th>Status</th><th>Erstellt</th><th>Gueltig bis</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'used' ? 'badge-used' : r.status === 'expired' ? 'badge-expired' : 'badge-pending';
            const verifyIcon = r.has_pin ? 'DOB+PIN' : r.patient_dob ? 'DOB' : '-';
            const baseUrl = window.location.origin.replace('/admin', '');
            const linkUrl = `${baseUrl}/anamnese/${r.token}`;
            return `<tr>
              <td><code style="font-size:0.8rem;">${r.token.slice(0, 12)}…</code></td>
              <td><strong>${r.pvs_patient_id || '-'}</strong></td>
              <td>${verifyIcon}</td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>${new Date(r.expires_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>
                <button class="btn btn-sm" onclick="showLinkDetail('${r.token}', '${linkUrl}', '${r.pvs_patient_id || ''}')">Detail</button>
                <button class="btn btn-sm btn-primary" onclick="showQRFullscreen('${linkUrl}')">QR</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler beim Laden: ' + e.message + '</div>';
  }
}

function showLinkDetail(token, url, pvsId) {
  showModal('Link Detail', `
    <p><strong>PVS Patienten-ID:</strong> ${pvsId || '-'}</p>
    <p><strong>Token:</strong> <code>${token}</code></p>
    <p><strong>URL:</strong></p>
    <div class="url-box">${url}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${url}')">Kopieren</button>
      <button class="btn btn-sm btn-success" onclick="window.open('${url}', '_blank')">Oeffnen</button>
      <button class="btn btn-sm btn-primary" onclick="showQRFullscreen('${url}')">QR anzeigen</button>
    </div>
  `);
}

// ─── Encounters ─────────────────────────────────────────────────
async function loadEncounters() {
  const container = document.getElementById('encounters-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/admin/encounters/list/${CURRENT_PRACTICE}`);
    const allRows = await res.json();

    const rows = encounterFilter === 'all' ? allRows : allRows.filter(r => r.status === encounterFilter);

    const filterButtons = `
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn btn-sm ${encounterFilter === 'all' ? 'btn-primary' : ''}" onclick="setEncounterFilter('all')" style="${encounterFilter === 'all' ? 'background:var(--color-primary);color:#fff;' : 'background:#f1f5f9;color:#475569;'}">Alle</button>
        <button class="btn btn-sm ${encounterFilter === 'completed' ? 'btn-primary' : ''}" onclick="setEncounterFilter('completed')" style="${encounterFilter === 'completed' ? 'background:var(--color-primary);color:#fff;' : 'background:#f1f5f9;color:#475569;'}">Abgeschlossen</button>
        <button class="btn btn-sm ${encounterFilter === 'in-progress' ? 'btn-primary' : ''}" onclick="setEncounterFilter('in-progress')" style="${encounterFilter === 'in-progress' ? 'background:var(--color-primary);color:#fff;' : 'background:#f1f5f9;color:#475569;'}">In Bearbeitung</button>
      </div>
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:12px;">${rows.length} von ${allRows.length} Anamnesen</div>
    `;

    if (!rows.length) {
      container.innerHTML = filterButtons + '<div class="empty">Keine Anamnesen fuer diesen Filter</div>';
      return;
    }

    container.innerHTML = filterButtons + `
      <table>
        <thead>
          <tr><th>PVS Patienten-ID</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'completed' ? 'badge-completed' : 'badge-inprogress';
            return `<tr>
              <td><strong>${r.pvs_patient_id || '-'}</strong></td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })} ${new Date(r.created_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', timeZone: 'Europe/Berlin'})}</td>
              <td>
                <button class="btn btn-sm" onclick="viewEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Ansehen</button>
                <button class="btn btn-sm btn-success" onclick="printEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Drucken</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

function setEncounterFilter(filter) {
  encounterFilter = filter;
  loadEncounters();
}

async function viewEncounter(encounterId, pvsId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`);
    const data = await res.json();

    const categories = {
      language: 'Sprache',
      origin: 'Herkunft',
      job: 'Familie, Bildung & Beruf',
      insurance: 'Versicherung',
      symptoms: 'Beschwerden',
      duration: 'Dauer',
      conditions: 'Vorerkrankungen',
      operations: 'Operationen',
      medications: 'Medikamente',
      allergies: 'Allergien',
      family: 'Familienanamnese',
      lifestyle: 'Lebensgewohnheiten',
      lifestyle2: 'Lebensgewohnheiten (2)',
      emergency: 'Notfallkontakt'
    };

    let html = '<div class="print-view">';
    html += `<div style="text-align:center;margin-bottom:20px;"><h2 style="color:var(--primary);margin:0;">myhistoree Anamnese</h2><div style="color:var(--text-light);font-size:0.9rem;">PVS Patienten-ID: <strong>${pvsId || '-'}</strong> | Datum: ${new Date(data.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</div></div>`;

    for (const r of data.responses || []) {
      const obj = JSON.parse(r.data);
      delete obj.__completed;
      const rows = Object.entries(obj).map(([k, v]) => {
        const label = fieldLabels[k] || k;
        return `<div class="field"><span class="field-label">${label}:</span> <span class="field-value">${formatValue(v)}</span></div>`;
      }).join('');
      html += `<h3>${categories[r.category] || r.category}</h3><div style="margin-left:8px;">${rows}</div>`;
    }

    if (!data.responses || !data.responses.length) {
      html += '<p style="color:var(--text-light);">Noch keine Antworten vorhanden.</p>';
    }

    html += '</div>';
    html += `<div class="print-actions"><button class="btn btn-primary" onclick="window.print()">Drucken / Als PDF speichern</button><button class="btn btn-secondary" onclick="copyEncounterText('${encounterId}')">Text kopieren</button></div>`;

    showModal(`Anamnese ${pvsId ? '- ID ' + pvsId : ''}`, html);
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

async function printEncounter(encounterId, pvsId) {
  await viewEncounter(encounterId, pvsId);
  setTimeout(() => window.print(), 300);
}

async function copyEncounterText(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`);
    const data = await res.json();

    let text = `myhistoree Anamnese\n`;
    text += `PVS Patienten-ID: ${data.pvs_patient_id || '-'}\n`;
    text += `Datum: ${new Date(data.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n`;
    text += `Status: ${data.status}\n`;
    text += `--------------------------\n\n`;

    for (const r of data.responses || []) {
      text += `${r.category}:\n`;
      const obj = JSON.parse(r.data);
      delete obj.__completed;
      for (const [k, v] of Object.entries(obj)) {
        text += `  ${fieldLabels[k] || k}: ${v}\n`;
      }
      text += '\n';
    }

    navigator.clipboard.writeText(text).then(() => alert('Text kopiert!'));
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

const fieldLabels = {
  languages: 'Sprachen',
  interpreter: 'Dolmetscher benoetigt',
  origin: 'Herkunft',
  familienstand: 'Familienstand',
  kinder: 'Kinderzahl',
  bildung: 'Ausbildung',
  beruf: 'Beruf',
  insurance_type: 'Versicherungstyp',
  kvid: 'Versichertennummer',
  symptoms: 'Aktuelle Beschwerden',
  duration: 'Seit wann',
  conditions: 'Bekannte Erkrankungen',
  operations: 'Operationen',
  medications: 'Aktuelle Medikamente',
  allergy_medication: 'Medikamentenallergien',
  allergy_food: 'Nahrungsmittelallergien',
  allergy_other: 'Sonstige Allergien',
  fam_herz: 'Herzinfarkt/Schlaganfall in Familie',
  fam_diabetes: 'Diabetes in Familie',
  fam_krebs: 'Krebs in Familie',
  fam_psych: 'Psychische Erkrankungen in Familie',
  rauchen: 'Raucher',
  alkohol: 'Alkoholkonsum',
  drogen: 'Drogenkonsum',
  schwanger: 'Schwangerschaft/Stillzeit',
  emergency_name: 'Notfallkontakt Name',
  emergency_phone: 'Notfallkontakt Telefon'
};

function formatValue(v) {
  if (v === true) return 'Ja';
  if (v === false) return 'Nein';
  if (Array.isArray(v)) return v.join(', ');
  return v || '-';
}

// ─── Modal ──────────────────────────────────────────────────────
function showModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal').classList.add('active');
}
function closeModal() {
  document.getElementById('modal').classList.remove('active');
}

// ─── Init ───────────────────────────────────────────────────────
switchTab('links');

// ─── Audit Log ──────────────────────────────────────────────────
async function loadAuditLog() {
  const container = document.getElementById('audit-table-container');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/audit/log?limit=200`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Eintraege</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Zeit</th><th>Aktion</th><th>Target</th><th>Details</th><th>IP</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${new Date(r.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td><span class="badge" style="background:#dbeafe;color:#1d4ed8;">${r.action}</span></td>
              <td>${r.target || '-'}</td>
              <td style="font-size:0.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;">${r.details || '-'}</td>
              <td style="font-size:0.75rem;color:var(--text-light);">${r.ip || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;text-align:center;">
        <button class="btn btn-sm btn-primary" onclick="applyRetentionNow()">🧹 Loeschfristen jetzt anwenden</button>
      </div>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

async function applyRetentionNow() {
  if (!confirm(`Loeschfristen jetzt anwenden?

- Abgeschlossene Anamnesen > 2 Jahre werden anonymisiert
- Genutzte Links > 30 Tage werden geloescht
- Abgelaufene Links > 7 Tage werden geloescht`)) return;
  try {
    const res = await fetch(`${API}/admin/apply-retention`, { method: 'POST' });
    const data = await res.json();
    alert(`Erledigt:
- Anonymisiert: ${data.anonymized}
- Links abgelaufen: ${data.expired}
- Links geloescht (genutzt): ${data.deletedUsed}
- Links geloescht (abgelaufen): ${data.deletedExpired}`);
    loadAuditLog();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }


// ─── Email Send ─────────────────────────────────────────────────
async function sendEmailForLink(linkToken, to, pvsId, dob, pin) {
  if (!to) { alert("Keine E-Mail-Adresse hinterlegt."); return; }

  // Validate
  try {
    const vRes = await fetch(`${API}/email/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: to })
    });
    const v = await vRes.json();
    if (!v.valid) { alert("E-Mail-Validierung: " + v.error); return; }
  } catch(e) {}

  const fullUrl = window.location.origin.replace("/admin", "") + "/anamnese/" + linkToken;
  const btn = document.activeElement;
  if (btn) btn.textContent = "⏳ Sende...";

  try {
    const res = await fetch(`${API}/link/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, pvsPatientId: pvsId, linkUrl: fullUrl, patientDob: dob, pin })
    });
    const data = await res.json();
    if (btn) btn.textContent = data.success ? "✅ Gesendet" : "❌ Fehler";
    if (!data.success) alert("Fehler: " + (data.error || "Unbekannter Fehler"));
    else setTimeout(() => { if (btn) btn.textContent = "📧 Per E-Mail senden"; }, 3000);
  } catch(e) {
    if (btn) btn.textContent = "❌ Fehler";
    alert("Fehler: " + e.message);
  }
}
}