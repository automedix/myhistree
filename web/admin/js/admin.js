// myhistoree Admin Dashboard JS v0.3
const API = '/api';
const CURRENT_PRACTICE = 'demo-practice';

// ─── Tab Switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));

  if (tab === 'links') loadLinks();
  if (tab === 'encounters') loadEncounters();
}

// ─── Link erstellen ─────────────────────────────────────────────
async function createLink() {
  const pvsId = document.getElementById('new-pvs-id').value.trim();
  const email = document.getElementById('new-patient-email').value.trim();
  const expiry = parseInt(document.getElementById('new-expiry').value);
  const btn = document.getElementById('btn-create');

  if (!pvsId) { alert('Bitte PVS Patienten-ID eingeben.'); return; }

  btn.disabled = true;
  btn.textContent = 'Wird erstellt...';

  try {
    const res = await fetch(`${API}/link/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: pvsId, patientEmail: email, expiresHours: expiry })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    const baseUrl = window.location.origin.replace('/admin', '');
    const fullUrl = `${baseUrl}/anamnese/${data.token}`;

    document.getElementById('link-result').innerHTML = `
      <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:16px;">
        <div style="font-weight:600;color:#166534;margin-bottom:8px;">✅ Link erfolgreich erstellt!</div>
        <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">PVS Patienten-ID: ${pvsId}</div>
        <div style="font-size:0.85rem;color:#64748b;margin-bottom:8px;">Gültig bis: ${new Date(data.expiresAt).toLocaleString('de-DE')}</div>
        <div class="url-box" id="link-url">${fullUrl}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-sm" onclick="copyLink()">📋 Kopieren</button>
          <button class="btn btn-sm btn-success" onclick="window.open('${fullUrl}', '_blank')">🔗 Öffnen</button>
        </div>
      </div>
    `;
    document.getElementById('link-result').style.display = 'block';
    document.getElementById('new-pvs-id').value = '';
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
          <tr><th>Token</th><th>PVS Patienten-ID</th><th>Npub</th><th>Status</th><th>Erstellt</th><th>Gültig bis</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'linked' ? 'badge-linked' : r.status === 'expired' ? 'badge-expired' : 'badge-pending';
            const npubShort = r.linked_npub ? r.linked_npub.slice(0, 16) + '…' : '—';
            const baseUrl = window.location.origin.replace('/admin', '');
            const linkUrl = `${baseUrl}/anamnese/${r.token}`;
            return `<tr>
              <td><code style="font-size:0.8rem;">${r.token.slice(0, 12)}…</code></td>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td>${npubShort}</td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE')}</td>
              <td>${new Date(r.expires_at).toLocaleDateString('de-DE')}</td>
              <td>
                <button class="btn btn-sm" onclick="showLinkDetail('${r.token}', '${linkUrl}', '${r.pvs_patient_id || ''}')">Detail</button>
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
    <p><strong>PVS Patienten-ID:</strong> ${pvsId || '—'}</p>
    <p><strong>Token:</strong> <code>${token}</code></p>
    <p><strong>URL:</strong></p>
    <div class="url-box">${url}</div>
    <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${url}')">📋 Kopieren</button>
    <button class="btn btn-sm btn-success" onclick="window.open('${url}', '_blank')">🔗 Öffnen</button>
  `);
}

// ─── Encounters laden ───────────────────────────────────────────
async function loadEncounters() {
  const container = document.getElementById('encounters-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/encounters/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Anamnesen ausgefüllt</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>PVS Patienten-ID</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'completed' ? 'badge-completed' : 'badge-inprogress';
            return `<tr>
              <td><strong>${r.pvs_patient_id || '—'}</strong></td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE')} ${new Date(r.created_at).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}</td>
              <td>
                <button class="btn btn-sm" onclick="viewEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Ansehen</button>
                <button class="btn btn-sm btn-success" onclick="printEncounter('${r.id}', '${r.pvs_patient_id || ''}')">Drucken / PDF</button>
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
    html += `<div style="text-align:center;margin-bottom:20px;"><h2 style="color:var(--primary);margin:0;">myhistoree Anamnese</h2><div style="color:var(--text-light);font-size:0.9rem;">PVS Patienten-ID: <strong>${pvsId || '—'}</strong> | Datum: ${new Date(data.created_at).toLocaleString('de-DE')}</div></div>`;

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
  // Same as view but optimized for print
  await viewEncounter(encounterId, pvsId);
  // Auto-trigger print dialog after a short delay
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
    text += `Datum: ${new Date(data.created_at).toLocaleString('de-DE')}\n`;
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
              <td>${new Date(r.created_at * 1000).toLocaleString('de-DE')}</td>
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

// ─── Init ───────────────────────────────────────────────────────
switchTab('links');
