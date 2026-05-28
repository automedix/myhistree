// myhistoree Admin Dashboard JS v0.5.6
const API = '/api';
let encounterFilter = 'all'; // 'all' | 'completed' | 'in-progress'
const CURRENT_PRACTICE = 'demo-practice';
let currentAdmin = null;

// ─── Auth Check on Load ─────────────────────────────────────────
async function initAuth() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
    if (!res.ok) {
      window.location.href = '/admin/login.html';
      return;
    }
    currentAdmin = await res.json();
    // Show user info in header
    const header = document.querySelector('header');
    if (header && currentAdmin) {
      const existing = header.querySelector('.user-info');
      if (!existing) {
        const userDiv = document.createElement('div');
        userDiv.className = 'user-info';
        userDiv.innerHTML = `<span title="${currentAdmin.role}">${currentAdmin.email}</span><button onclick="doLogout()">Abmelden</button>`;
        header.appendChild(userDiv);
      }
    }
    // Now load data
    loadLinks();
  } catch (e) {
    window.location.href = '/admin/login.html';
  }
}

async function doLogout() {
  await fetch(`${API}/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });
  window.location.href = '/admin/login.html';
}

// ─── Tab Switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  if (tab === 'links') loadLinks();
  if (tab === 'encounters') loadEncountersDashboard();
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
  btn.textContent = 'Erstellen...';
  try {
    const res = await fetch(`${API}/link/create`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: pvsId, patientDob: dob, patientEmail: email || undefined, expiresHours: expiry, pin: requiresPin ? undefined : pin })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); btn.disabled = false; btn.textContent = 'Link erstellen'; return; }
    const base = window.location.origin;
    const url = `${base}/anamnese/${data.token}`;
    document.getElementById('result-url').textContent = url;
    document.getElementById('result-pin').textContent = data.pin ? `PIN: ${data.pin}` : '';
    document.getElementById('result-box').style.display = 'block';
    if (email) sendLinkEmail(email, pvsId, url, dob, data.pin);
    loadLinks();
  } catch (e) { alert('Netzwerkfehler'); } finally { btn.disabled = false; btn.textContent = 'Link erstellen'; }
}

async function sendLinkEmail(to, pvsPatientId, linkUrl, patientDob, pin) {
  await fetch(`${API}/link/send-email`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
    body: JSON.stringify({ to, pvsPatientId, linkUrl, patientDob, pin })
  });
}

// ─── Links laden ────────────────────────────────────────────────
async function loadLinks() {
  const container = document.getElementById('links-table');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/link/list/${CURRENT_PRACTICE}`, { credentials: 'include' });
    const rows = await res.json();
    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Links erstellt.</div>'; return; }
    let html = '<table><thead><tr><th>Token</th><th>PVS-ID</th><th>DOB</th><th>E-Mail</th><th>Status</th><th>Erstellt</th><th>Ablauf</th><th>PIN</th><th>Aktion</th></tr></thead><tbody>';
    for (const r of rows) {
      const statusClass = r.status === 'pending' ? 'badge-pending' : (r.status === 'used' ? 'badge-used' : 'badge-expired');
      html += `<tr>
        <td><code>${r.token.slice(0,16)}...</code></td>
        <td>${r.pvs_patient_id || '-'}</td>
        <td>${r.patient_dob || '-'}</td>
        <td>${r.patient_email || '-'}</td>
        <td><span class="badge ${statusClass}">${r.status}</span></td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${fmtDate(r.expires_at)}</td>
        <td>${r.has_pin ? 'Ja' : 'Nein'}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="copyLink('${r.token}')">Kopieren</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
}

function copyLink(token) {
  const url = `${window.location.origin}/anamnese/${token}`;
  navigator.clipboard.writeText(url).then(() => alert('Link kopiert!'));
}

// ─── Encounters Dashboard (3-Bereich) ───────────────────────────
async function loadEncountersDashboard() {
  const container = document.getElementById('encounters-content');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/admin/encounters/list/${CURRENT_PRACTICE}`, { credentials: 'include' });
    if (!res.ok) { container.innerHTML = '<div class="empty">Zugriff verweigert — bitte neu anmelden.</div>'; return; }
    const rows = await res.json();
    const pending = rows.filter(r => r.status === 'pending' || !r.status);
    const inProgress = rows.filter(r => r.status === 'in-progress');
    const completed = rows.filter(r => r.status === 'completed');
    const processed = rows.filter(r => r.status === 'processed');

    let html = '';
    // OFFEN
    html += '<div class="card"><h3>Offen</h3>';
    if (!pending.length) html += '<p class="empty">Keine offenen Anamnesen.</p>';
    else html += encountersTable(pending, true);
    html += '</div>';

    // IN BEARBEITUNG
    html += '<div class="card"><h3>In Bearbeitung</h3>';
    if (!inProgress.length) html += '<p class="empty">Keine Anamnesen in Bearbeitung.</p>';
    else html += encountersTable(inProgress, true);
    html += '</div>';

    // ABGESCHLOSSEN (7 Tage)
    html += '<div class="card"><h3>Abgeschlossen (letzte 7 Tage)</h3>';
    const recentCompleted = completed.filter(r => {
      const d = r.completed_at ? new Date(r.completed_at) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentProcessed = processed.filter(r => {
      const d = r.processed_at ? new Date(r.processed_at) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentAll = [...recentCompleted, ...recentProcessed].sort((a,b) => new Date(b.completed_at||b.processed_at).getTime() - new Date(a.completed_at||a.processed_at).getTime());
    if (!recentAll.length) html += '<p class="empty">Keine abgeschlossenen Anamnesen in den letzten 7 Tagen.</p>';
    else html += encountersTable(recentAll, false);
    html += '</div>';

    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
}

function encountersTable(rows, showProcessBtn) {
  let html = '<table><thead><tr><th>Datum</th><th>PVS-ID</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>';
  for (const r of rows) {
    const statusClass = r.status === 'completed' ? 'badge-completed' : (r.status === 'processed' ? 'badge-processed' : 'badge-inprogress');
    html += `<tr>
      <td>${fmtDateTime(r.created_at)}</td>
      <td>${r.pvs_patient_id || '-'}</td>
      <td><span class="badge ${statusClass}">${r.status}</span></td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="viewEncounter('${r.id}')">Ansehen</button>
        <button class="btn btn-sm btn-secondary" onclick="copyEncounterText('${r.id}')">Kopieren</button>
        ${showProcessBtn && r.status !== 'processed' ? `<button class="btn btn-sm btn-success" onclick="markProcessed('${r.id}')">Fertig</button>` : ''}
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

async function markProcessed(encounterId) {
  if (!confirm('Als "Fertig" markieren?')) return;
  try {
    const res = await fetch(`${API}/admin/encounter/${encounterId}/process`, {
      method: 'POST', credentials: 'include'
    });
    if (!res.ok) throw new Error();
    loadEncountersDashboard();
  } catch (e) { alert('Fehler'); }
}

// ─── Encounter Ansehen / Kopieren / Drucken ─────────────────────
async function viewEncounter(encounterId) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`, { credentials: 'include' });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    const enc = data.encounter;
    let html = '<div class="print-view">';
    html += `<h2>Anamnese ${enc.id.slice(0,8)} — ${enc.pvs_patient_id || '—'}</h2>`;
    html += `<p><strong>Erstellt:</strong> ${fmtDateTime(enc.created_at)}</p>`;
    if (data.responses) {
      const items = [
        { label:'Sprache/Herkunft', cat:'origin'},
        { label:'Familienstand', cat:'family_status'},
        { label:'Kinder', cat:'children'},
        { label:'Beruf/Ausbildung', cat:'job'},
        { label:'Versicherung', cat:'insurance'},
        { label:'Beschwerden', cat:'symptoms'},
        { label:'Dauer', cat:'duration'},
        { label:'Vorerkrankungen', cat:'conditions'},
        { label:'Operationen', cat:'operations'},
        { label:'Blutverdünnung', cat:'meds_bloodthin'},
        { label:'Blutdrucksenker', cat:'meds_bp'},
        { label:'Asthma/COPD', cat:'meds_asthma'},
        { label:'Diabetes', cat:'meds_diabetes'},
        { label:'Neurologisch', cat:'meds_neuro'},
        { label:'Schmerzmittel', cat:'meds_pain'},
        { label:'Gyn/Uro', cat:'meds_gynuro'},
        { label:'Cholesterinsenker', cat:'meds_chol'},
        { label:'Sonstige Meds', cat:'meds_other'},
        { label:'Allergien', cat:'allergies'},
        { label:'Familienanamnese', cat:'family'},
        { label:'Lebensstil', cat:'lifestyle'},
        { label:'Lebensstil II', cat:'lifestyle2'},
        { label:'Notfallkontakt', cat:'emergency'},
        { label:'Körpermaße', cat:'bodymetrics'},
        { label:'Kontakt', cat:'contact'},
        { label:'Notizen', cat:'notes'}
      ];
      for (const it of items) {
        const r = data.responses.find((x) => x.category === it.cat);
        if (r) {
          html += `<div class="section"><h3>${it.label}</h3>`;
          const obj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
          if (obj && Object.keys(obj).length > 0) {
            for (const [k, v] of Object.entries(obj)) {
              if (k.startsWith('__')) continue;
              html += `<div class="field"><div class="field-label">${k}</div><div class="field-value">${formatValue(v)}</div></div>`;
            }
          } else { html += '<p><em>Keine Angaben</em></p>'; }
          html += '</div>';
        }
      }
    }
    html += '</div>';
    body.innerHTML = html;
    modal.classList.add('active');
  } catch (e) { alert('Fehler beim Laden'); }
}

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function copyEncounterText(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`, { credentials: 'include' });
    const data = await res.json();
    if (data.error) return;
    const enc = data.encounter;
    let text = `Anamnese ${enc.id.slice(0,8)} — ${enc.pvs_patient_id || '—'}\nErstellt: ${fmtDateTime(enc.created_at)}\n\n`;
    if (data.responses) {
      for (const r of data.responses) {
        const obj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        text += `[${r.category}]\n`;
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('__')) continue;
          text += `${k}: ${formatValue(v)}\n`;
        }
        text += '\n';
      }
    }
    navigator.clipboard.writeText(text).then(() => alert('Kopiert!'));
  } catch (e) {}
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

// ─── Audit Log ──────────────────────────────────────────────────
async function loadAuditLog() {
  const container = document.getElementById('audit-table');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/audit/log`, { credentials: 'include' });
    const rows = await res.json();
    if (!rows.length) { container.innerHTML = '<div class="empty">Keine Einträge.</div>'; return; }
    let html = '<table><thead><tr><th>Zeit</th><th>Admin</th><th>Aktion</th><th>Target</th><th>Details</th><th>IP</th></tr></thead><tbody>';
    for (const r of rows) {
      html += `<tr>
        <td>${fmtDateTime(r.created_at)}</td>
        <td>${r.admin_user || '-'}</td>
        <td><span class="badge badge-pending">${r.action}</span></td>
        <td>${r.target || '-'}</td>
        <td>${r.details || '-'}</td>
        <td>${r.ip || '-'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
}

// ─── Helpers ────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('de-DE'); } catch { return d; }
}
function fmtDateTime(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  } catch { return d; }
}

// ─── PIN Toggle ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const pinCheckbox = document.getElementById('new-use-pin');
  if (pinCheckbox) {
    pinCheckbox.addEventListener('change', () => {
      document.getElementById('pin-group').style.display = pinCheckbox.checked ? 'block' : 'none';
    });
  }
  // Init auth
  initAuth();
});
