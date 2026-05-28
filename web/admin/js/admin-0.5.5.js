// myhistoree Admin Dashboard JS v0.5.5
const API = '/api';
const CURRENT_PRACTICE = 'demo-practice';

// ─── Tab Switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));

  if (tab === 'links') loadLinks();
  if (tab === 'encounters') loadEncountersDashboard();
  if (tab === 'checkins') { loadCheckins(); setTimeout(generateSelfCheckinQR, 100); }
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
    showLinkResultWithQR(pvsId, dob, usePin || !!data.pin, displayPin, data.expiresAt, fullUrl);

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

// ─── QR Code Generator ──────────────────────────────────────────
function generateQR(containerId, url, size, options) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const qrcode = new QRCode(container, {
    text: url,
    width: size,
    height: size,
    colorDark: '#1e293b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
  return qrcode;
}

function showQRModal(url, title) {
  const containerId = 'qr-modal-canvas';
  showModal(title || 'QR-Code anzeigen', `
    <div class="qr-container qr-big">
      <div id="${containerId}"></div>
      <div class="qr-actions">
        <button class="btn btn-primary" onclick="downloadQR()">⬇️ Herunterladen</button>
        <button class="btn btn-secondary" onclick="printQRPage('${url}')">🖨️ Drucken</button>
      </div>
    </div>
  `);
  setTimeout(() => generateQR(containerId, url, 280), 50);
}

function downloadQR() {
  const container = document.getElementById('qr-modal-canvas');
  if (!container) return;
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'myhistoree-qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ─── Print QR Code als eigenständige Seite ──────────────────────
function printQRPage(url) {
  const printWindow = window.open('', '_blank', 'width=600,height=600');
  if (!printWindow) { alert('Bitte Popups erlauben, um den QR-Code zu drucken.'); return; }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>myhistoree Self-Checkin QR-Code</title>
      <style>
        body { margin:0; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:system-ui,-apple-system,sans-serif; }
        .container { text-align:center; padding:40px; }
        .logo { font-size:1.5rem; font-weight:bold; color:#2563eb; margin-bottom:8px; }
        .subtitle { color:#64748b; margin-bottom:32px; font-size:0.95rem; }
        .qr-container { display:inline-block; padding:20px; background:white; border-radius:16px; box-shadow:0 4px 24px rgba(0,0,0,0.1); }
        .url { margin-top:20px; font-size:0.85rem; color:#64748b; word-break:break-all; max-width:400px; }
        .hint { margin-top:16px; font-size:0.8rem; color:#94a3b8; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display:none; }
        }
      </style>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    </head>
    <body>
      <div class="container">
        <div class="logo">🏥 myhistoree</div>
        <div class="subtitle">Self-Checkin QR-Code</div>
        <div class="qr-container">
          <div id="qr-print"></div>
        </div>
        <div class="url">${url}</div>
        <div class="hint">Mit der Handy-Kamera scannen und direkt einchecken</div>
        <div class="no-print" style="margin-top:32px;">
          <button onclick="window.print()" style="padding:12px 24px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:1rem;cursor:pointer;">🖨️ Jetzt drucken</button>
        </div>
      </div>
      <script>
        window.onload = function() {
          new QRCode(document.getElementById('qr-print'), {
            text: '${url}',
            width: 280,
            height: 280,
            colorDark: '#1e293b',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
          });
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ─── QR Code in Link-Result einfügen ────────────────────────────
function showLinkResultWithQR(pvsId, dob, usePin, pin, expiresAt, fullUrl) {
  const pinHtml = usePin ? `<div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">🔒 PIN: ${pin}</div>` : '';
  const dobFormatted = new Date(dob).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

  document.getElementById('link-result').innerHTML = `
    <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:16px;" id="link-result-box">
      <div style="font-weight:600;color:#166534;margin-bottom:8px;">✅ Link erfolgreich erstellt!</div>
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">PVS Patienten-ID: ${pvsId}</div>
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">Geburtsdatum: ${dobFormatted}</div>
      ${pinHtml}
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:8px;">Gültig bis: ${new Date(expiresAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</div>
      <div class="url-box" id="link-url">${fullUrl}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-sm" onclick="copyLink()">📋 Kopieren</button>
        <button class="btn btn-sm btn-success" onclick="window.open('${fullUrl}', '_blank')">🔗 Öffnen</button>
        <button class="btn btn-sm btn-primary" onclick="showQRModal('${fullUrl}', 'QR-Code für Patienten')">📷 QR-Code anzeigen</button>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(34,197,94,0.4);display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:center;">
        <div style="text-align:center;">
          <div style="font-size:0.8rem;color:#166534;font-weight:600;margin-bottom:8px;">📷 Handy-Kamera darauf richten</div>
          <div id="qr-inline" style="display:inline-block;"></div>
        </div>
        <div style="text-align:left;max-width:220px;">
          <div style="font-size:0.85rem;color:#166534;font-weight:600;margin-bottom:4px;">So geht's:</div>
          <ol style="font-size:0.8rem;color:#166534;margin:0;padding-left:16px;">
            <li>QR-Code mit Handy-Kamera scannen</li>
            <li>Link im Browser öffnen</li>
            <li>Anamnese ausfüllen</li>
            <li>Geburtsdatum ${dobFormatted} ${usePin ? '+ PIN bestätigen' : 'bestätigen'}</li>
          </ol>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => generateQR('qr-inline', fullUrl, 140), 50);
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
          <tr><th>Token</th><th>PVS Patienten-ID</th><th>Verifizierung</th><th>Verknüpfter npub</th><th>Status</th><th>Erstellt</th><th>Gültig bis</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'linked' ? 'badge-linked' : r.status === 'expired' ? 'badge-expired' : 'badge-pending';
            const verifyIcon = r.has_pin ? '🔒 DOB+PIN' : r.patient_dob ? '📅 DOB' : '—';
            const linkedNpub = r.linked_npub ? `<code style="font-size:0.75rem;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${r.linked_npub.slice(0, 20)}…</code>` : '—';
            const baseUrl = window.location.origin.replace('/admin', '');
            const linkUrl = `${baseUrl}/anamnese/${r.token}`;
            return `<tr>
              <td><code style="font-size:0.8rem;">${r.token.slice(0, 12)}…</code></td>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td>${verifyIcon}</td>
              <td>${linkedNpub}</td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>${new Date(r.expires_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>
                <button class="btn btn-sm" onclick="showLinkDetail('${r.token}', '${linkUrl}', '${r.pvs_patient_id || ''}', '${r.linked_npub || ''}')">Detail</button>
                <button class="btn btn-sm btn-primary" onclick="showQRModal('${linkUrl}', 'QR-Code – ${r.pvs_patient_id || 'Unbekannt'}')">📷 QR</button>
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

function showLinkDetail(token, url, pvsId, linkedNpub) {
  showModal('Link Detail', `
    <p><strong>PVS Patienten-ID:</strong> ${pvsId || '—'}</p>
    <p><strong>Verknüpfter npub:</strong> <code style="font-size:0.8rem;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${linkedNpub || '—'}</code></p>
    <p><strong>Token:</strong> <code>${token}</code></p>
    <p><strong>URL:</strong></p>
    <div class="url-box">${url}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${url}')">📋 Kopieren</button>
      <button class="btn btn-sm btn-success" onclick="window.open('${url}', '_blank')">🔗 Öffnen</button>
      <button class="btn btn-sm btn-primary" onclick="showQRModal('${url}', 'QR-Code – ${pvsId || 'Unbekannt'}')">📷 QR-Code anzeigen</button>
    </div>
  `);
}

// ─── Encounters Dashboard (v0.5.5) ──────────────────────────────
async function loadEncountersDashboard() {
  await Promise.all([
    loadPendingLinks(),
    loadCompletedEncounters(),
    loadProcessedEncounters()
  ]);
}

// 1. Offene Vorgänge – patient_links mit status='pending'
async function loadPendingLinks() {
  const container = document.getElementById('pending-links-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/link/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();
    const pending = rows.filter(r => r.status === 'pending');

    if (!pending.length) { container.innerHTML = '<div class="empty">Keine offenen Vorgänge</div>'; return; }

    const baseUrl = window.location.origin.replace('/admin', '');
    container.innerHTML = `
      <table>
        <thead>
          <tr><th>PVS Patienten-ID</th><th>Geburtsdatum</th><th>Erstellt</th><th>Gültig bis</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${pending.map(r => {
            const linkUrl = `${baseUrl}/anamnese/${r.token}`;
            const dobFormatted = r.patient_dob ? new Date(r.patient_dob).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : '—';
            return `<tr>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td>${dobFormatted}</td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>${new Date(r.expires_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td>
                <button class="btn btn-sm btn-primary" onclick="showQRModal('${linkUrl}', 'QR-Code – ${r.pvs_patient_id || 'Unbekannt'}')">📷 QR</button>
                <button class="btn btn-sm btn-danger" onclick="deleteLink('${r.token}')">🗑️ Löschen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

async function deleteLink(token) {
  if (!confirm('Link wirklich löschen?')) return;
  try {
    const res = await fetch(`${API}/admin/link/${token}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen');
    loadPendingLinks();
    loadLinks();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

// 2. In Bearbeitung – encounters mit status='completed'
async function loadCompletedEncounters() {
  const container = document.getElementById('completed-encounters-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/admin/encounters/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();
    const completed = rows.filter(r => r.status === 'completed');

    if (!completed.length) { container.innerHTML = '<div class="empty">Keine Vorgänge in Bearbeitung</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>PVS Patienten-ID</th><th>Abgeschickt am</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${completed.map(r => {
            return `<tr>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })} ${new Date(r.created_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', timeZone: 'Europe/Berlin'})}</td>
              <td>
                <button class="btn btn-sm" onclick="viewEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Ansehen</button>
                <button class="btn btn-sm btn-success" onclick="printEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Drucken</button>
                <button class="btn btn-sm btn-primary" onclick="processEncounter('${r.id}')">Fertig</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

async function processEncounter(encounterId) {
  if (!confirm('Vorgang als fertig markieren?')) return;
  try {
    const res = await fetch(`${API}/admin/encounter/${encounterId}/process`, { method: 'POST' });
    if (!res.ok) throw new Error('Fehler beim Verarbeiten');
    loadEncountersDashboard();
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

// 3. Abgeschlossene Vorgänge – encounters mit status='processed' (letzte 7 Tage)
async function loadProcessedEncounters() {
  const container = document.getElementById('processed-encounters-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/admin/encounters/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const processed = rows.filter(r => {
      if (r.status !== 'processed') return false;
      const processedAt = r.processed_at ? new Date(r.processed_at) : new Date(r.updated_at);
      return processedAt >= sevenDaysAgo;
    });

    if (!processed.length) { container.innerHTML = '<div class="empty">Keine abgeschlossenen Vorgänge in den letzten 7 Tagen</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>PVS Patienten-ID</th><th>Verarbeitet am</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${processed.map(r => {
            const processedAt = r.processed_at ? new Date(r.processed_at) : new Date(r.updated_at);
            return `<tr>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td><span class="badge badge-processed">${processedAt.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })} ${processedAt.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', timeZone: 'Europe/Berlin'})}</span></td>
              <td>
                <button class="btn btn-sm" onclick="viewEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Ansehen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

// ─── Encounter ansehen (schöne Zusammenfassung) ─────────────────
async function viewEncounter(encounterId, pvsId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`);
    const data = await res.json();

    const categories = {
      demographics: 'Persönliche Angaben',
      insurance: 'Versicherung',
      history: 'Krankengeschichte',
      medications: 'Medikamente',
      allergies: 'Allergien',
      family: 'Familienanamnese',
      lifestyle: 'Lebensgewohnheiten',
      lifestyle2: 'Lebensgewohnheiten (Fortsetzung)',
      emergency: 'Notfallkontakt'
    };

    let html = `<div class="print-view">`;
    html += `<div style="text-align:center;margin-bottom:20px;"><h2 style="color:var(--primary);margin:0;">myhistoree Anamnese</h2><div style="color:var(--text-light);font-size:0.9rem;">PVS Patienten-ID: <strong>${pvsId || '—'}</strong> | Datum: ${new Date(data.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</div></div>`;

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

    html += `</div>`;
    html += `<div class="print-actions"><button class="btn btn-primary" onclick="window.print()">🖨️ Drucken / Als PDF speichern</button><button class="btn btn-secondary" onclick="copyEncounterText('${encounterId}')">📋 Text kopieren (für Karteikarte)</button></div>`;

    showModal(`Anamnese ${pvsId ? '– ID ' + pvsId : ''}`, html);
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

// ─── Encounter Drucken / PDF ────────────────────────────────────
async function printEncounter(encounterId, pvsId) {
  await viewEncounter(encounterId, pvsId);
  setTimeout(() => window.print(), 300);
}

// ─── Text kopieren für Karteikarte ──────────────────────────────
async function copyEncounterText(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`);
    const data = await res.json();

    const categories = {
      demographics: 'Persönliche Angaben',
      insurance: 'Versicherung',
      history: 'Krankengeschichte',
      medications: 'Medikamente',
      allergies: 'Allergien',
      family: 'Familienanamnese',
      lifestyle: 'Lebensgewohnheiten',
      lifestyle2: 'Lebensgewohnheiten',
      emergency: 'Notfallkontakt'
    };

    let text = `myhistoree Anamnese\n`;
    text += `PVS Patienten-ID: ${data.pvs_patient_id || '—'}\n`;
    text += `Datum: ${new Date(data.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n`;
    text += `Status: ${data.status}\n`;
    text += `────────────────────────\n\n`;

    for (const r of data.responses || []) {
      text += `${categories[r.category] || r.category}:\n`;
      const obj = JSON.parse(r.data);
      delete obj.__completed;
      for (const [k, v] of Object.entries(obj)) {
        text += `  ${fieldLabels[k] || k}: ${v}\n`;
      }
      text += '\n';
    }

    navigator.clipboard.writeText(text).then(() => alert('Text kopiert! Sie können ihn jetzt in die Karteikarte einfügen.'));
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

// ─── Field Labels für schöne Darstellung ────────────────────────
const fieldLabels = {
  languages: 'Sprachen',
  interpreter: 'Dolmetscher benötigt',
  origin: 'Herkunft',
  familienstand: 'Familienstand',
  kinder: 'Kinderzahl',
  bildung: 'Ausbildung',
  beruf: 'Beruf',
  insurance_type: 'Versicherungstyp',
  insurance_name: 'Kasse',
  insurance_number: 'Versichertennummer',
  symptoms: 'Aktuelle Beschwerden',
  symptom_duration: 'Seit wann',
  symptom_severity: 'Schweregrad',
  conditions: 'Bekannte Erkrankungen',
  operations: 'Operationen',
  operation_details: 'Operationsdetails',
  medications: 'Aktuelle Medikamente',
  medication_details: 'Medikamentendetails',
  allergy_medications: 'Medikamentenallergien',
  allergy_food: 'Nahrungsmittelallergien',
  allergy_other: 'Sonstige Allergien',
  family_conditions: 'Familiäre Erkrankungen',
  smoking: 'Raucher',
  alcohol: 'Alkohol',
  drugs: 'Drogen',
  sport: 'Sport',
  diet: 'Ernährung',
  emergency_name: 'Notfallkontakt Name',
  emergency_phone: 'Notfallkontakt Telefon',
  emergency_relation: 'Verwandtschaftsgrad'
};

function formatValue(v) {
  if (v === true) return 'Ja';
  if (v === false) return 'Nein';
  if (Array.isArray(v)) return v.join(', ');
  return v || '—';
}

// ─── NOSTR Events ───────────────────────────────────────────────
async function loadNostrEvents() {
  const pubkey = document.getElementById('nostr-search').value.trim();
  const container = document.getElementById('nostr-table-container');
  if (!pubkey) { alert('Bitte Pubkey eingeben'); return; }

  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/nostr/events/${encodeURIComponent(pubkey)}`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Keine Events gefunden</div>'; return; }

    container.innerHTML = `
      <table>
        <thead><tr><th>Kind</th><th>Zeit</th><th>Content</th><th>Aktion</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
            const contentShort = content.length > 80 ? content.slice(0, 80) + '…' : content;
            return `<tr>
              <td>${r.kind}</td>
              <td>${new Date(r.created_at * 1000).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td>
              <td style="font-size:0.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;">${contentShort}</td>
              <td><button class="btn btn-sm" onclick='showJson(${JSON.stringify(r)})'>JSON</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

function showJson(obj) {
  showModal('NOSTR Event JSON', `<pre class="json">${JSON.stringify(obj, null, 2)}</pre>`);
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

// ─── Self-Checkin ───────────────────────────────────────────────
function generateSelfCheckinQR() {
  const baseUrl = window.location.origin.replace('/admin', '');
  const url = `${baseUrl}/anamnese`;
  document.getElementById('selfcheckin-url').textContent = url;
  generateQR('selfcheckin-qr', url, 280);
}

function downloadSelfCheckinQR() {
  const container = document.getElementById('selfcheckin-qr');
  if (!container) return;
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'myhistoree-selfcheckin-qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function loadCheckins() {
  const container = document.getElementById('checkins-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/checkin/today/${CURRENT_PRACTICE}`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Heute noch keine Checkins</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Zeit</th><th>PVS Patienten-ID</th><th>npub</th><th>Beschwerden</th><th>Termin</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const data = r.checkin_data || {};
            const complaints = data.complaints || '—';
            const freitext = data.freitext ? `<br><em style="font-size:0.8rem;color:var(--text-light);">${data.freitext}</em>` : '';
            const appt = data.hasAppointment ? (data.appointmentTime ? `✅ ${data.appointmentTime}` : '✅ Ja') : '❌ Nein';
            const pvsId = r.pvs_patient_id ? `<strong>${r.pvs_patient_id}</strong>` : '—';
            return `<tr>
              <td>${new Date(r.created_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit', timeZone: 'Europe/Berlin'})}</td>
              <td>${pvsId}</td>
              <td><code style="font-size:0.75rem;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${r.npub.slice(0, 20)}…</code></td>
              <td>${complaints}${freitext}</td>
              <td>${appt}</td>
              <td><span class="badge badge-completed">${r.status}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

// ─── Init ───────────────────────────────────────────────────────
switchTab('links');
