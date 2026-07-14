// myhistree Admin Dashboard JS v0.6.7
const API = '/api';
function autoFormatDob(input) {
  var v = input.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.slice(0,2) + '.' + v.slice(2);
  if (v.length >= 5) v = v.slice(0,5) + '.' + v.slice(5,9);
  input.value = v;
  return v;
}
function parseDobToISO(dob) {
  if (!dob) return '';
  var m = dob.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : dob;
}
function isoToDob(iso) {
  if (!iso) return '';
  var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : iso;
}
function fmtEuro(val) {
  return Number(val || 0).toFixed(2).replace('.', ',') + ' €';
}
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


function sanitizeConsentHtml(raw) {
  if (!raw) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = raw;
  ['script','iframe','object','embed','style','link','meta','base','form'].forEach(tag => {
    tpl.content.querySelectorAll(tag).forEach(n => n.remove());
  });
  tpl.content.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
        node.removeAttribute(attr.name);
      }
      if ((attr.name === 'href' || attr.name === 'src') && attr.value.startsWith('data:')) {
        node.removeAttribute(attr.name);
      }
    }
  });
  return tpl.innerHTML;
}

function prepareConsentHtmlForAdmin(raw, consentItemsJson) {
  const html = sanitizeConsentHtml(raw);
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  if (consentItemsJson) {
    try {
      const items = JSON.parse(consentItemsJson);
      const itemMap = new Map();
      items.forEach(item => itemMap.set(item.item, item.checked));
      tpl.content.querySelectorAll('input.consent-check[type="checkbox"]').forEach(cb => {
        const key = cb.dataset.item || cb.name;
        if (itemMap.has(key)) cb.checked = itemMap.get(key);
      });
    } catch(e) {}
  }
  // Disable all interactive elements
  tpl.content.querySelectorAll('input, button, select, textarea').forEach(el => {
    el.disabled = true;
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.85';
  });
  return tpl.innerHTML;
}
let encounterFilter = 'all'; // 'all' | 'completed' | 'in-progress'
let CURRENT_PRACTICE = null;

async function initCurrentPractice() {
  try {
    const res = await fetch(`${API}/practices/list`, { credentials: 'include' });
    if (res.ok) {
      const list = await res.json();
      if (list && list.length > 0) CURRENT_PRACTICE = list[0].id;
    }
  } catch(e) {
    console.error('initCurrentPractice failed', e);
  }
  if (!CURRENT_PRACTICE) CURRENT_PRACTICE = 'demo-practice';
}

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
    await initCurrentPractice();
    // Show user info in header
    const header = document.querySelector('header');
    if (header && currentAdmin) {
      let userDiv = header.querySelector('.user-info');
      if (!userDiv) {
        userDiv = document.createElement('div');
        userDiv.className = 'user-info';
        header.appendChild(userDiv);
      }
      userDiv.innerHTML = `<span title="${escapeHtml(currentAdmin.role)}">${escapeHtml(currentAdmin.email)}</span><button onclick="doLogout()">Abmelden</button>`;
    }
    // Now load data
    await loadConsentTemplates();
    await loadLinks();
  } catch (e) {
    window.location.href = '/admin/login.html';
  }
}

let consentTemplates = [];
async function loadConsentTemplates() {
  try {
    const res = await fetch(`${API}/consent-forms`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      consentTemplates = data.templates || [];
      const select = document.getElementById('new-consent-form');
      if (select) {
        select.innerHTML = consentTemplates.map(t => `<option value="${escapeHtml(t.slug)}">${escapeHtml(t.title)}</option>`).join('');
      }
    }
  } catch (e) { console.log('Consent templates not loaded', e); }
}

async function doLogout() {
  await fetch(`${API}/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });
  window.location.href = '/admin/login.html';
}

// ─── Tab Switching ──────────────────────────────────────────────
async function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  if (tab === 'links') await loadLinks();
  if (tab === 'encounters') loadEncountersDashboard();
  if (tab === 'audit') loadAuditLog();
  if (tab === 'settings') loadSettings();
  if (tab === 'users') await loadUsers();
  if (tab === 'quotes') { await loadQuotes(); await loadQuoteTemplates(); }
}

// ─── Link erstellen ─────────────────────────────────────────────
async function createLink() {
  const pvsId = document.getElementById('new-pvs-id').value.trim();
  const dob = parseDobToISO(document.getElementById('new-patient-dob').value);
  const email = document.getElementById('new-patient-email').value.trim();
  const usePin = document.getElementById('new-use-pin').checked;
  const pin = usePin ? document.getElementById('new-pin').value.trim() : undefined;
  const requiresPin = usePin && !pin;
  const expiry = parseInt(document.getElementById('new-expiry').value);
  const docType = document.getElementById('new-doc-type').value;
  const consentFormId = docType === 'consent_form' ? document.getElementById('new-consent-form').value : undefined;
  const btn = document.getElementById('btn-create');

  if (!pvsId) { alert('Bitte PVS Patienten-ID eingeben.'); return; }
  if (!dob) { alert('Bitte Geburtsdatum eingeben.'); return; }
  if (usePin && pin && pin.length < 4) { alert('Bitte eine PIN mit mindestens 4 Ziffern eingeben.'); return; }

  btn.disabled = true;
  btn.textContent = 'Erstellen...';
  try {
    const res = await fetch(`${API}/link/create`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: pvsId, patientDob: dob, patientEmail: email || undefined, expiresHours: expiry, pin: requiresPin ? undefined : pin, documentType: docType, consentFormId })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); btn.disabled = false; btn.textContent = 'Link erstellen'; return; }
    const base = window.location.origin;
    const url = `${base}${data.link}`; // data.link enthält bereits /anamnese/... oder /auffklaerung/...
    document.getElementById('result-url').textContent = url;
    document.getElementById('result-pin').textContent = data.pin ? `PIN: ${data.pin}` : '';
    document.getElementById('link-result').style.display = 'block'; document.getElementById('result-box').style.display = 'block';
    // Generate QR code
    const qrDiv = document.getElementById('result-qr');
    qrDiv.innerHTML = '';
    new QRCode(qrDiv, { text: url, width: 160, height: 160, colorDark: '#1e293b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    if (email) {
    try {
      await sendLinkEmail(email, pvsId, url, dob, data.pin, docType, consentFormId);
      console.log('E-Mail gesendet');
    } catch(e) {
      console.error('E-Mail Fehler:', e);
      alert('E-Mail konnte nicht gesendet werden: ' + e.message);
    }
  }
    await loadLinks();
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); } finally { btn.disabled = false; btn.textContent = 'Link erstellen'; }
}

async function sendLinkEmail(to, pvsPatientId, linkUrl, patientDob, pin, documentType, consentFormId) {
  const res = await fetch(`${API}/link/send-email`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
    body: JSON.stringify({ to, pvsPatientId, linkUrl, patientDob, pin, documentType, consentFormId, practiceId: CURRENT_PRACTICE })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Links laden ────────────────────────────────────────────────
async function loadLinks() {
  const container = document.getElementById('links-table-container');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/link/list/${CURRENT_PRACTICE}`, { credentials: 'include' });
    const rows = await res.json();
    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Links erstellt.</div>'; return; }
    let html = '<table><thead><tr><th>Token</th><th>PVS-ID</th><th>DOB</th><th>Typ</th><th>E-Mail</th><th>Status</th><th>Erstellt</th><th>Ablauf</th><th>PIN</th><th>Aktion</th></tr></thead><tbody>';
    for (const r of rows) {
      const statusClass = r.status === 'pending' ? 'badge-pending' : (r.status === 'used' ? 'badge-used' : 'badge-expired');
      const typeLabel = r.document_type === 'consent_form' ? 'Aufklärung' : (r.document_type === 'bloodpressure' ? 'Blutdruck' : (r.document_type === 'behandlungsvertrag' ? 'Behandlungsvertrag' : 'Anamnese'));
      const typeTitle = r.document_type === 'consent_form' ? (r.consent_form_title || 'Aufklärung') : 'Patienten-Anamnese';
      html += `<tr>
        <td><code>${r.token.slice(0,16)}...</code></td>
        <td>${escapeHtml(r.pvs_patient_id ? r.pvs_patient_id : '-')}</td>
        <td>${escapeHtml(r.patient_dob ? r.patient_dob : '-')}</td>
        <td><span class="badge" title="${escapeHtml(typeTitle)}">${typeLabel}</span></td>
        <td>${escapeHtml(r.patient_email ? r.patient_email : '-')}</td>
        <td><span class="badge ${statusClass}">${r.status}</span></td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${fmtDate(r.expires_at)}</td>
        <td>${r.has_pin ? 'Ja' : 'Nein'}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="copyLink('${r.token}', '${r.document_type || 'anamnese'}')">Kopieren</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<div class="empty">Fehler: ' + (e.message || e) + '</div>'; }
}

function copyLink(token, docType) {
  const path = docType === 'consent_form' ? 'aufklaerung' : (docType === 'bloodpressure' ? 'blutdruck' : (docType === 'behandlungsvertrag' ? 'behandlungsvertrag' : 'anamnese'));
  const url = `${window.location.origin}/${path}/${token}`;
  navigator.clipboard.writeText(url).then(() => alert('Link kopiert!'));
}

function copyResultLink() {
  const url = document.getElementById('result-url').textContent;
  if (url) navigator.clipboard.writeText(url).then(() => alert('Link kopiert!'));
}

function showQRFullscreen() {
  const url = document.getElementById('result-url').textContent;
  if (!url) return;
  const container = document.getElementById('qr-fullscreen-canvas');
  container.innerHTML = '';
  new QRCode(container, { text: url, width: 320, height: 320, colorDark: '#1e293b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('qr-fullscreen').style.display = 'flex';
}
function closeQRFullscreen() {
  document.getElementById("qr-fullscreen").style.display = "none";
}

// ─── Encounters Dashboard (3-Bereich) ───────────────────────────
async function loadEncountersDashboard() {
  const container = document.getElementById('encounters-content');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    // Expire stale links in background (bloodpressure excluded)
    const expireRes = await fetch(`${API}/internal/cron/expire-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}'
    });
    const expireData = expireRes.ok ? await expireRes.json() : { expiredCount: 0 };

    const res = await fetch(`${API}/admin/encounters/list/${CURRENT_PRACTICE}`, { credentials: 'include' });
    if (!res.ok) { container.innerHTML = '<div class="empty">Zugriff verweigert — bitte neu anmelden.</div>'; return; }
    const rows = await res.json();
    const bloodpressureItems = rows.filter(r => r.document_type === 'bloodpressure' && (r.status === 'in-progress' || r.status === 'submitted' || r.status === 'completed'));
    const inProgress = rows.filter(r => r.document_type !== 'bloodpressure' && (r.status === 'in-progress' || r.status === 'submitted' || r.status === 'completed' || r.status === 'expired'));
        const processed = rows.filter(r => r.status === 'processed');

    let html = '';
    // OFFEN
    html += '<div class="card" style="border-left:4px solid #5889d5"><h3>Blutdruck</h3>';
    if (!bloodpressureItems.length) html += '<p class="empty">Keine Blutdruckmessungen in Bearbeitung.</p>';
    else html += encountersTable(bloodpressureItems, true);
    html += '</div>';

    // IN BEARBEITUNG
    html += '<div class="card"><h3>In Bearbeitung</h3>';
    if (!inProgress.length) html += '<p class="empty">Keine Dokumente in Bearbeitung.</p>';
    else html += encountersTable(inProgress, true);
    html += '</div>';

    // ABGESCHLOSSEN (7 Tage)
    html += '<div class="card"><h3>Abgeschlossen (letzte 7 Tage)</h3>';
    const recentCompleted = inProgress.filter(r => {
      const ts = r.completed_at || r.updated_at || r.created_at;
      const d = ts ? new Date(ts) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentProcessed = processed.filter(r => {
      const ts = r.processed_at || r.updated_at || r.created_at;
      const d = ts ? new Date(ts) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentAll = [...recentProcessed].sort((a,b) => {
      const getTs = r => new Date(r.completed_at || r.processed_at || r.updated_at || r.created_at).getTime();
      return getTs(b) - getTs(a);
    });
    if (!recentAll.length) html += '<p class="empty">Keine abgeschlossenen Dokumente in den letzten 7 Tagen.</p>';
    else html += encountersTable(recentAll, false);
    html += '</div>';

    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<div class="empty">Fehler: ' + (e.message || e) + '</div>'; }
}

function encountersTable(rows, showProcessBtn) {
  let html = '<table><thead><tr><th>Datum</th><th>PVS-ID</th><th>Typ</th><th>Email</th><th>Telefon</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>';
  for (const r of rows) {
    const isConsent = r.document_type === 'consent_form';
    const statusClass = r.status === 'processed' ? 'badge-processed' : (r.status === 'expired' ? 'badge-expired' : ((r.status === 'completed' || r.status === 'submitted') ? 'badge-completed' : 'badge-inprogress'));
    const typeLabel = isConsent ? 'Aufklärung' : (r.document_type === 'bloodpressure' ? 'Blutdruck' : (r.document_type === 'behandlungsvertrag' ? 'Behandlungsvertrag' : 'Anamnese'));
    const typeTitle = isConsent ? (r.consent_title || 'Aufklärung') : 'Patienten-Anamnese';
    let email = r.patient_email || '-';
    let phone = r.mobile_number || '-';
    if (r.contact_json) {
      try {
        const c = JSON.parse(r.contact_json);
        if (c.email) email = c.email;
        if (c.mobile) phone = c.mobile;
        if (c.landline && phone === '-') phone = c.landline;
      } catch(e) {}
    }
    html += `<tr>
      <td>${fmtDateTime(r.created_at)}</td>
      <td>${escapeHtml(r.pvs_patient_id ? r.pvs_patient_id : '-')}</td>
      <td><span class="badge" style="background:#f0f9ff;color:#3366AA;border:1px solid #bae6fd;font-size:0.7rem;" title="${escapeHtml(typeTitle)}">${typeLabel}</span></td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(phone)}</td>
      <td><span class="badge ${statusClass}">${r.status}</span></td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="viewEncounter('${r.id}')">Ansehen</button>
        <button class="btn btn-sm btn-secondary" onclick="copyEncounterText('${r.id}')">Kopieren</button>
        <button class="btn btn-sm btn-secondary" onclick="printEncounter('${r.id}')">Drucken</button>
        ${showProcessBtn && r.status !== 'processed' ? (r.status === 'expired' ? `<button class="btn btn-sm btn-warning" onclick="finishEncounter('${r.id}')">Fertig</button>` : `<button class="btn btn-sm btn-success" onclick="markProcessed('${r.id}')">Fertig</button>`) : ''}
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}


async function finishEncounter(encounterId) {
  if (!confirm("Diesen Eintrag als 'Fertig' markieren und nach 'Abgeschlossen' verschieben?")) return;
  try {
    const res = await fetch(`${API}/encounter/${encounterId}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); return; }
    loadEncountersDashboard();
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
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
  body.innerHTML = '<div class="spinner"></div>';
  modal.classList.add('active');
  try {
    // Zuerst Encounter laden, um Typ zu prüfen
    const encRes = await fetch(`${API}/encounter/${encounterId}`, { credentials: 'include' });
    const encData = await encRes.json();
    if (encData.error) { alert(encData.error); closeModal(); return; }

    if (encData.encounter && encData.encounter.document_type === 'consent_form') {
      // Consent Form Detail
      const res = await fetch(`${API}/consent/${encounterId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      const data = await res.json();
      const enc = data.encounter;
      const template = data.template;
      if (enc.document_type === 'bloodpressure') {
      const bpRes = await fetch(`${API}/admin/bloodpressure/${encounterId}`, { credentials: 'include' });
      if (!bpRes.ok) return;
      const bp = await bpRes.json();
      let html = '<div class="print-view">';
      html += `<h2>Blutdruckmessung ${escapeHtml(enc.id.slice(0,8))}</h2>`;
      html += `<p><strong>Erstellt:</strong> ${fmtDateTime(enc.created_at)}</p>`;
      html += '<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5">Zeit</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5">Systolisch</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5">Diastolisch</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5">Puls</th><th style="border:1px solid #ccc;padding:6px;background:#f5f5f5">Gewicht</th></tr></thead><tbody>';
      for (const r of bp.readings || []) {
        html += `<tr><td style="border:1px solid #ccc;padding:6px">${fmtDateTime(r.recorded_at)}</td><td style="border:1px solid #ccc;padding:6px">${r.systolic}</td><td style="border:1px solid #ccc;padding:6px">${r.diastolic}</td><td style="border:1px solid #ccc;padding:6px">${r.pulse}</td><td style="border:1px solid #ccc;padding:6px">${r.weight != null ? r.weight : '-'}</td></tr>`;
      }
      html += '</tbody></table></div>';
      const w = window.open('', '_blank');
      if (w) { w.document.write('<html><head><title>Blutdruckmessung</title><style>body{font-family:Arial;margin:20px}h2{margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #ccc;padding:6px}th{background:#f5f5f5}</style></head><body>' + html + '</body></html>'); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
      return;
    }

    let html = '<div class="print-view">';
      html += `<h2>${escapeHtml(template?.title || 'Aufklärungsbogen')} — ${escapeHtml(enc.pvs_patient_id || '–')}</h2>`;
      html += `<div class="field"><div class="field-label">Status</div><div class="field-value"><span class="badge badge-completed">${escapeHtml(enc.status)}</span></div></div>`;
      html += `<div class="field"><div class="field-label">PVS-ID</div><div class="field-value">${escapeHtml(enc.pvs_patient_id || '–')}</div></div>`;
      html += `<div class="field"><div class="field-label">Erstellt</div><div class="field-value">${fmtDateTime(enc.created_at)}</div></div>`;
      if (enc.patient_name) {
        html += `<div class="field"><div class="field-label">Unterschrieben von</div><div class="field-value"><strong>${escapeHtml(enc.patient_name)}</strong></div></div>`;
        html += `<div class="field"><div class="field-label">Unterschrieben am</div><div class="field-value">${fmtDateTime(enc.signed_at || enc.completed_at)}</div></div>`;
      }

      if (template?.content_html) {
        html += '<hr style="margin: 16px 0;"><h3>Dokumentinhalt</h3>';
        html += `\u003cdiv style="font-size:0.9rem;line-height:1.6;"\u003e${prepareConsentHtmlForAdmin(template.content_html, enc.consent_items)}\u003c/div\u003e`;
      }

      if (enc.signature_svg) {
        html += '<hr style="margin: 16px 0;"><h3>Unterschrift</h3>';
        const svgUrl = 'data:image/svg+xml;base64,' + btoa(enc.signature_svg);
        html += `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:#fafafa;"><img src="${svgUrl}" style="max-width:100%;"></div>`;
      }

      if (enc.consent_items) {
        html += '<hr style="margin: 16px 0;"><h3>Gewählte Optionen</h3>';
        const items = JSON.parse(enc.consent_items);
        html += '<ul style="list-style:none;padding:0;">';
        for (const item of items) {
          const checked = item.checked ? '✅' : '❌';
          html += `<li style="margin:4px 0">${checked} ${escapeHtml(item.label || item.item)}</li>`;
        }
        html += '</ul>';
      }

      if (enc.ip_address) {
        html += `<div class="meta-info" style="margin-top:16px;font-size:0.75rem;color:#94a3b8;text-align:center;">IP: ${escapeHtml(enc.ip_address)} | UA: ${escapeHtml((enc.user_agent || '').slice(0, 80))}...</div>`;
      }

      html += '</div>';
      body.innerHTML = html;
      document.getElementById('modal-title').textContent = 'Aufklärungsbogen';
      return;
    }

    if (encData.encounter && encData.encounter.document_type === 'bloodpressure') {
      const bpRes = await fetch(`${API}/admin/bloodpressure/${encounterId}`, { credentials: 'include' });
      if (!bpRes.ok) { body.innerHTML = '<p class="empty">Fehler beim Laden.</p>'; return; }
      const bp = await bpRes.json();
      let html = '<div class="print-view">';
      html += `<h2>Blutdruckmessung ${escapeHtml(encounterId.slice(0,8))} — ${escapeHtml(bp.encounter?.pvs_patient_id || '–')}</h2>`;
      html += `<p><strong>PVS-ID:</strong> ${escapeHtml(bp.encounter?.pvs_patient_id || '–')}</p>`;
      html += `<p><strong>Erstellt:</strong> ${fmtDateTime(bp.encounter?.created_at)}</p>`;
      html += '<table class="detail-table"><thead><tr><th>Zeit</th><th>Sys</th><th>Dia</th><th>Puls</th><th>Gewicht</th></tr></thead><tbody>';
      for (const r of bp.readings || []) {
        html += `<tr><td>${fmtDateTime(r.recorded_at)}</td><td>${r.systolic}</td><td>${r.diastolic}</td><td>${r.pulse}</td><td>${r.weight != null ? r.weight : '-'}</td></tr>`;
      }
      html += '</tbody></table>';
      if ((bp.readings || []).length) {
        html += '<canvas id="bp-chart" width="600" height="220" style="width:100%;height:220px;margin-top:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;"></canvas>';
      }
      html += '</div>';
      body.innerHTML = html;
      document.getElementById('modal-title').textContent = 'Blutdruckmessung';
      if ((bp.readings || []).length) {
        setTimeout(() => {
          const cvs = document.getElementById('bp-chart');
          if (!cvs) return;
          const ctx = cvs.getContext('2d');
          const w = 600, h = 220, pad = { l: 36, t: 10, r: 10, b: 24 };
          const pts = (bp.readings || []).map(r => ({ t: new Date(r.recorded_at).getTime(), rec: r.recorded_at, sys: r.systolic, dia: r.diastolic, pul: r.pulse, weight: r.weight }));
          const times = pts.map(p => p.t), minT = Math.min(...times), maxT = Math.max(...times);
          const allY = pts.flatMap(p => [p.sys, p.dia, p.pul, p.weight != null ? p.weight : null].filter(v => v != null));
          let minY = Math.min(...allY) - 10, maxY = Math.max(...allY) + 10;
          if (minY < 30) minY = 30; if (maxY > 250) maxY = 250;
          const sx = (t) => pad.l + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (w - pad.l - pad.r);
          const sy = (y) => pad.t + (maxY - y) / (maxY - minY) * (h - pad.t - pad.b);
          ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
          for (let i = 0; i <= 5; i++) { const y = pad.t + (h - pad.t - pad.b) * (i / 5); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
          function drawLine(key, color) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); let started = false; pts.forEach(p => { if (p[key] == null) { started = false; return; } const x = sx(p.t), y = sy(p[key]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }); ctx.stroke(); ctx.fillStyle = color; pts.forEach(p => { if (p[key] == null) return; ctx.beginPath(); ctx.arc(sx(p.t), sy(p[key]), 3, 0, Math.PI * 2); ctx.fill(); }); }
          drawLine('sys', '#3366AA'); drawLine('dia', '#4DA6FF'); drawLine('pul', '#000000');
          if (pts.some(p => p.weight != null)) drawLine('weight', '#D32F2F');
          ctx.fillStyle = '#475569'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
          pts.forEach(p => { const x = sx(p.t); const dt = _parseAsUTC(p.rec); const lbl = dt ? dt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; ctx.fillText(lbl, x, h - 6); });
          ctx.textAlign = 'right'; for (let i = 0; i <= 5; i++) { const v = maxY - (maxY - minY) * (i / 5); ctx.fillText(Math.round(v), pad.l - 4, pad.t + (h - pad.t - pad.b) * (i / 5) + 4); }
          ctx.textAlign = 'left'; let lx = pad.l + 8, ly = pad.t + 14;
          [{ c: '#3366AA', t: 'Systolisch' }, { c: '#4DA6FF', t: 'Diastolisch' }, { c: '#000000', t: 'Puls' }, { c: '#D32F2F', t: 'Gewicht' }].forEach(item => { ctx.fillStyle = item.c; ctx.fillRect(lx, ly - 6, 8, 8); ctx.fillStyle = '#334155'; ctx.fillText(item.t, lx + 12, ly); lx += ctx.measureText(item.t).width + 28; });
        }, 100);
      }
      return;
    }

    if (encData.encounter && encData.encounter.document_type === 'behandlungsvertrag') {
      const res = await fetch(`${API}/behandlungsvertrag/${encounterId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      const data = await res.json();
      const enc = data.encounter;
      const sub = enc;
      let html = '<div class="print-view">';
      html += '<h2>Behandlungsvertrag — ' + escapeHtml(enc.pvs_patient_id || '–') + '</h2>';
      html += '<div class="field"><div class="field-label">Status</div><div class="field-value"><span class="badge badge-completed">' + escapeHtml(enc.status) + '</span></div></div>';
      html += '<div class="field"><div class="field-label">PVS-ID</div><div class="field-value">' + escapeHtml(enc.pvs_patient_id || '–') + '</div></div>';
      html += '<div class="field"><div class="field-label">Erstellt</div><div class="field-value">' + fmtDateTime(enc.created_at) + '</div></div>';
      if (sub) {
        html += '<div class="field"><div class="field-label">Patient</div><div class="field-value"><strong>' + escapeHtml(sub.patient_name || '–') + '</strong></div></div>';
        html += '<div class="field"><div class="field-label">Tarif</div><div class="field-value">' + escapeHtml(sub.tariff || '–') + '</div></div>';
        html += '<div class="field"><div class="field-label">Steigerungsfaktor</div><div class="field-value">' + escapeHtml(sub.multiplier || '–') + '</div></div>';
        html += '<div class="field"><div class="field-label">Unterschrieben am</div><div class="field-value">' + fmtDateTime(sub.signed_at) + '</div></div>';
        if (enc.contract_html) {
          html += '<hr style="margin: 16px 0;"><h3>Vertragstext</h3>';
          html += '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:#fafafa;max-height:60vh;overflow:auto;font-size:0.85rem;line-height:1.5;">' + sanitizeConsentHtml(enc.contract_html) + '</div>';
        } else {
          html += '<hr style="margin: 16px 0;"><p style="color:#888;font-style:italic;">Vertragstext nicht gespeichert (ältere Einreichung)</p>';
        }
        if (sub.signature_svg) {
          const svgUrl = 'data:image/svg+xml;base64,' + btoa(sub.signature_svg);
          html += '<hr style="margin: 16px 0;"><h3>Unterschrift</h3>';
          html += '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:#fafafa;"><img src="' + svgUrl + '" style="max-width:100%;"></div>';
        }
      }
      html += '</div>';
      body.innerHTML = html;
      document.getElementById('modal-title').textContent = 'Behandlungsvertrag';
      return;
    }

    // Standard-Anamnese-Detailansicht
    const data = encData;
    const enc = data.encounter;
    let html = '<div class="print-view">';
    html += `<h2>Anamnese ${escapeHtml(enc.id.slice(0,8))} — ${escapeHtml(enc.pvs_patient_id ? enc.pvs_patient_id : '—')}</h2>`;
    html += `<p><strong>Erstellt:</strong> ${fmtDateTime(enc.created_at)}</p>`;

    if (data.responses && data.responses.length) {
      const items = [
        { label:'Sprache', cat:'language' },
        { label:'Herkunft', cat:'origin' },
        { label:'Familienstand', cat:'family_status' },
        { label:'Kinder', cat:'children' },
        { label:'Beruf / Ausbildung', cat:'job' },
        { label:'Versicherung', cat:'insurance' },
        { label:'Beschwerden', cat:'symptoms' },
        { label:'Dauer', cat:'duration' },
        { label:'Vorerkrankungen', cat:'conditions' },
        { label:'Operationen', cat:'operations' },
        { label:'Blutverdünnung', cat:'meds_bloodthin' },
        { label:'Blutdrucksenker', cat:'meds_bp' },
        { label:'Asthma / COPD', cat:'meds_asthma' },
        { label:'Diabetes', cat:'meds_diabetes' },
        { label:'Neurologisch', cat:'meds_neuro' },
        { label:'Schmerzmittel', cat:'meds_pain' },
        { label:'Gyn / Uro', cat:'meds_gynuro' },
        { label:'Cholesterinsenker', cat:'meds_chol' },
        { label:'Sonstige Medikamente', cat:'meds_other' },
        { label:'Allergien', cat:'allergies' },
        { label:'Familienanamnese', cat:'family' },
        { label:'Lebensstil', cat:'lifestyle' },
        { label:'Lebensstil II', cat:'lifestyle2' },
        { label:'Notfallkontakt', cat:'emergency' },
        { label:'Körpermaße', cat:'bodymetrics' },
        { label:'Kontakt', cat:'contact' },
        { label:'Zusätzliche Informationen', cat:'notes' }
      ];

      const respByCat = {};
      for (const r of data.responses) {
        if (r.category === 'email_verified') continue;
        respByCat[r.category] = r;
      }

      for (const it of items) {
        const r = respByCat[it.cat];
        if (!r) continue;
        html += `<div class="section"><h3>${it.label}</h3>`;
        const obj = (typeof r.data === 'string') ? JSON.parse(r.data) : r.data;
        const keys = Object.keys(obj || {}).filter(k => !k.startsWith('__'));
        if (keys.length > 0) {
          if (it.cat === 'contact') {
            const contactKeys = Object.keys(obj || {}).filter(k => !k.startsWith('__'));
            if (contactKeys.length === 0) {
              html += `<div class="field"><div class="field-label">Kontakt</div><div class="field-value">—</div></div>`;
            } else {
              for (const k of contactKeys) {
                let label = k;
                if (k === 'mobile') label = 'Mobilfunknummer';
                else if (k === 'landline') label = 'Festnetznummer';
                else if (k === 'email') label = 'E-Mail';
                else if (k === 'email_verified') label = 'E-Mail verifiziert';
                let val = obj[k];
                if (k === 'email_verified') val = val ? 'Ja' : 'Nein';
                html += `<div class="field"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${formatValue(val)}</div></div>`;
              }
            }
          } else {
            for (const [k, v] of Object.entries(obj)) {
              if (k.startsWith('__')) continue;
              html += `<div class="field"><div class="field-label">${escapeHtml(k)}</div><div class="field-value">${formatValue(v)}</div></div>`;
            }
          }
        } else {
          html += '<p><em>Keine Angaben</em></p>';
        }
        html += '</div>';
      }
    }

    html += '</div>';
    body.innerHTML = html;
    document.getElementById('modal-title').textContent = 'Anamnese';
  } catch (e) { alert('Fehler beim Laden'); body.innerHTML = '<p class="empty">Fehler beim Laden</p>'; }
}


function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (Array.isArray(v)) {
    // Array of objects (e.g. children: [{index:1, year:2005}])
    if (v.length > 0 && typeof v[0] === 'object') {
      return v.map(item => {
        const pairs = Object.entries(item).filter(([k]) => !k.startsWith('__'));
        return pairs.map(([k, val]) => `${escapeHtml(k)}: ${formatValue(val)}`).join(', ');
      }).join('; ');
    }
    return v.map(escapeHtml).join(', ');
  }
  if (typeof v === 'object') {
    // Single object with consent items
    const pairs = Object.entries(v).filter(([k]) => !k.startsWith('__'));
    if (pairs.length === 0) return '—';
    return pairs.map(([k, val]) => `${escapeHtml(k)}: ${formatValue(val)}`).join(', ');
  }
  return escapeHtml(v);
}

async function copyEncounterText(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`, { credentials: 'include' });
    const data = await res.json();
    if (data.error) return;
    const enc = data.encounter;
    if (enc.document_type === 'consent_form') {
      const cRes = await fetch(`${API}/consent/${encounterId}`, { credentials: 'include' });
      if (!cRes.ok) return;
      const cData = await cRes.json();
      let text = `${cData.template?.title || 'Aufklärungsbogen'}\n`;
      text += `PVS-ID: ${enc.pvs_patient_id || '–'}\n`;
      text += `Unterschrieben von: ${cData.encounter?.patient_name || '–'}\n`;
      text += `Unterschrieben am: ${fmtDateTime(cData.encounter?.signed_at || cData.encounter?.completed_at)}\n\n`;
      // Plain text aus HTML extrahieren (einfacher Approach)
      const temp = document.createElement('div');
      temp.innerHTML = sanitizeConsentHtml(cData.template?.content_html || '');
      text += temp.textContent || temp.innerText || '';
      navigator.clipboard.writeText(text).then(() => alert('Kopiert!'));
      return;
    }
    if (enc.document_type === 'bloodpressure') {
      const bpRes = await fetch(`${API}/admin/bloodpressure/${encounterId}`, { credentials: 'include' });
      if (!bpRes.ok) return;
      const bp = await bpRes.json();
      let text = `Blutdruckmessung ${enc.id.slice(0,8)}
Erstellt: ${fmtDateTime(enc.created_at)}

`;
      for (const r of bp.readings || []) {
        text += `${fmtDateTime(r.recorded_at)}  Sys ${r.systolic}  Dia ${r.diastolic}  Puls ${r.pulse}  Gewicht ${r.weight != null ? r.weight : '-'}
`;
      }
      navigator.clipboard.writeText(text).then(() => alert('Kopiert!'));
      return;
    }
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

async function printEncounter(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`, { credentials: 'include' });
    const data = await res.json();
    if (data.error) return;
    const enc = data.encounter;

    if (enc.document_type === 'consent_form') {
      const cRes = await fetch(`${API}/consent/${encounterId}`, { credentials: 'include' });
      if (!cRes.ok) return;
      const cData = await cRes.json();
      let html = '<div class="print-view">';
      html += `\u003ch1 style="font-size:16pt;color:#3366AA;border-bottom:2px solid #4477BB;padding-bottom:8px;margin-bottom:16px;"\u003e${escapeHtml(cData.template?.title || 'Aufklärungsbogen')}\u003c/h1\u003e`;
      html += `<p><strong>PVS-ID:</strong> ${escapeHtml(enc.pvs_patient_id || '–')}</p>`;
      html += `<p><strong>Unterschrieben von:</strong> ${escapeHtml(cData.encounter?.patient_name || '–')}</p>`;
      html += `<p><strong>Unterschrieben am:</strong> ${fmtDateTime(cData.encounter?.signed_at || cData.encounter?.completed_at)}</p>`;
      html += `\u003cp\u003e\u003cstrong\u003eIP-Adresse:\u003c/strong\u003e ${escapeHtml(cData.encounter?.ip_address || '–')}\u003c/p\u003e`;
      html += '\u003chr style="margin:20px 0;border:none;border-top:1px solid #ccc;"\u003e';
      html += `\u003cdiv style="font-size:10pt;line-height:1.5;"\u003e${sanitizeConsentHtml(cData.template?.content_html || '')}\u003c/div\u003e`;
      if (cData.encounter?.signature_svg) {
        html += '<hr style="margin:20px 0;border:none;border-top:1px solid #ccc;"><h3 style="font-size:12pt;">Unterschrift</h3>';
        const svgUrl = 'data:image/svg+xml;base64,' + btoa(cData.encounter.signature_svg);
        html += `<div style="border:1px solid #ccc;padding:12px;"><img src="${svgUrl}" style="max-width:100%;"></div>`;
      }
      html += '</div>';
      const w = window.open('', '_blank');
      if (w) {
        w.document.write('<html><head><title>' + escapeHtml(cData.template?.title || 'Aufklärungsbogen') + '</title><style>body{font-family:Arial;margin:20px}h1{font-size:16pt}h3{font-size:12pt}p{margin:4px 0}</style></head><body>' + html + '</body></html>');
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
      }
      return;
    }

    if (enc.document_type === 'bloodpressure') {
      const bpRes = await fetch(`${API}/admin/bloodpressure/${encounterId}`, { credentials: 'include' });
      if (!bpRes.ok) return;
      const bpData = await bpRes.json();
      const readings = bpData.readings || [];
      let chartImgUrl = '';
      if (readings.length >= 1) {
        const cvs = document.createElement('canvas');
        cvs.width = 700; cvs.height = 260;
        const cx = cvs.getContext('2d');
        const pts = readings.map(r => ({ t: new Date(r.recorded_at).getTime(), rec: r.recorded_at, sys: r.systolic, dia: r.diastolic, pul: r.pulse, weight: r.weight }));
        const times = pts.map(p => p.t), minT = Math.min(...times), maxT = Math.max(...times);
        const allY = pts.flatMap(p => [p.sys, p.dia, p.pul, p.weight != null ? p.weight : null].filter(v => v != null));
        let minY = Math.min(...allY) - 10, maxY = Math.max(...allY) + 10;
        if (minY < 30) minY = 30; if (maxY > 250) maxY = 250;
        const W = 700, H = 260, pad = { l: 50, r: 20, t: 20, b: 40 };
        const sx = (t) => pad.l + (maxT === minT ? 0.5 : (t - minT) / (maxT - minT)) * (W - pad.l - pad.r);
        const sy = (y) => pad.t + (maxY - y) / (maxY - minY) * (H - pad.t - pad.b);
        cx.clearRect(0, 0, W, H); cx.strokeStyle = '#e2e8f0'; cx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) { const y = pad.t + (H - pad.t - pad.b) * (i / 5); cx.beginPath(); cx.moveTo(pad.l, y); cx.lineTo(W - pad.r, y); cx.stroke(); }
        function drawLine(key, color) { cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); let started = false; pts.forEach(p => { if (p[key] == null) { started = false; return; } const x = sx(p.t), y = sy(p[key]); if (!started) { cx.moveTo(x, y); started = true; } else cx.lineTo(x, y); }); cx.stroke(); cx.fillStyle = color; pts.forEach(p => { if (p[key] == null) return; cx.beginPath(); cx.arc(sx(p.t), sy(p[key]), 3, 0, Math.PI * 2); cx.fill(); }); }
        drawLine('sys', '#3366AA'); drawLine('dia', '#4DA6FF'); drawLine('pul', '#000000');
          if (pts.some(p => p.weight != null)) drawLine('weight', '#D32F2F');
        cx.fillStyle = '#475569'; cx.font = '10px sans-serif'; cx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) { const v = maxY - (maxY - minY) * (i / 5); const y = pad.t + (H - pad.t - pad.b) * (i / 5); cx.fillText(Math.round(v), pad.l - 4, y + 4); }
        cx.textAlign = 'center';
        pts.forEach(p => { const dt = _parseAsUTC(p.rec); const lbl = dt ? dt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; cx.fillText(lbl, sx(p.t), H - 6); });
        chartImgUrl = cvs.toDataURL('image/png');
      }
      let html = '<div class="print-view">';
      html += '<h2>Blutdruckmessung ' + escapeHtml(enc.id.slice(0,8)) + ' — ' + escapeHtml(enc.pvs_patient_id ? enc.pvs_patient_id : '—') + '</h2>';
      html += '<p><strong>Erstellt:</strong> ' + fmtDateTime(enc.created_at) + '</p>';
      if (chartImgUrl) { html += '<img src="' + chartImgUrl + '" style="max-width:100%;margin-top:12px;display:block;">'; }
      html += '<h4 style="margin-top:16px;margin-bottom:4px;text-transform:uppercase;font-size:12px;color:#666">Messwerte</h4>';
      html += '<table class="detail-table" style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Zeit</th><th style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Sys</th><th style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Dia</th><th style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Puls</th><th style="border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left">Gew.</th></tr></thead><tbody>';
      for (const r of readings) {
        html += '<tr><td style="border:1px solid #ddd;padding:6px 8px">' + fmtDateTime(r.recorded_at) + '</td><td style="border:1px solid #ddd;padding:6px 8px">' + r.systolic + '</td><td style="border:1px solid #ddd;padding:6px 8px">' + r.diastolic + '</td><td style="border:1px solid #ddd;padding:6px 8px">' + r.pulse + '</td><td style="border:1px solid #ddd;padding:6px 8px">' + (r.weight != null ? r.weight : '—') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      const w = window.open('', '_blank');
      if (w) {
        w.document.write('<html><head><title>Blutdruckmessung</title><style>body{font-family:Arial;margin:20px}h2{margin-bottom:8px}h4{margin-top:16px;margin-bottom:4px;text-transform:uppercase;font-size:12px;color:#666}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #ddd;padding:6px 8px}th{background:#f5f5f5;text-align:left}</style></head><body>' + html + '</body></html>');
        w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
      }
      return;
    }

    if (enc.document_type === 'behandlungsvertrag') {
      const bvRes = await fetch(`${API}/behandlungsvertrag/${encounterId}`, { credentials: 'include' });
      if (!bvRes.ok) return;
      const bvData = await bvRes.json();
      const enc = bvData.encounter;
      const sub = enc;
      let html = '<div class="print-view">';
      html += '<h2>Behandlungsvertrag — ' + escapeHtml(enc.pvs_patient_id || '—') + '</h2>';
      html += '<p><strong>Erstellt:</strong> ' + fmtDateTime(enc.created_at) + '</p>';
      if (sub) {
        html += '<p><strong>Patient:</strong> ' + escapeHtml(sub.patient_name || '—') + '</p>';
        html += '<p><strong>Tarif:</strong> ' + escapeHtml(sub.tariff || '—') + '</p>';
        html += '<p><strong>Steigerungsfaktor:</strong> ' + escapeHtml(sub.multiplier || '—') + '</p>';
        html += '<p><strong>Unterschrieben am:</strong> ' + fmtDateTime(sub.signed_at) + '</p>';
        if (enc.contract_html) {
          html += '<hr style="margin: 16px 0;"><h3>Vertragstext</h3>';
          html += '<div style="border:1px solid #ddd;border-radius:8px;padding:12px;background:#fafafa;font-size:0.85rem;line-height:1.5;">' + sanitizeConsentHtml(enc.contract_html) + '</div>';
        } else {
          html += '<hr style="margin: 16px 0;"><p style="color:#888;font-style:italic;">Vertragstext nicht gespeichert (ältere Einreichung)</p>';
        }
        if (sub.signature_svg) {
          const svgUrl = 'data:image/svg+xml;base64,' + btoa(sub.signature_svg);
          html += '<h3 style="margin-top:16px">Unterschrift</h3>';
          html += '<div style="border:1px solid #ddd;border-radius:8px;padding:12px;background:#fafafa;"><img src="' + svgUrl + '" style="max-width:100%;"></div>';
        }
      }
      html += '</div>';
      const w = window.open('', '_blank');
      if (w) {
        w.document.write('<html><head><title>Behandlungsvertrag</title><style>body{font-family:Arial;margin:20px}h2{margin-bottom:8px}h3{margin-top:16px;margin-bottom:4px;text-transform:uppercase;font-size:12px;color:#666}p{margin:4px 0}</style></head><body>' + html + '</body></html>');
        w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
      }
      return;
    }

    let html = '<div class="print-view">';
    html += `<h2>Anamnese ${escapeHtml(enc.id.slice(0,8))} — ${escapeHtml(enc.pvs_patient_id ? enc.pvs_patient_id : '—')}</h2>`;
    html += `<p><strong>Erstellt:</strong> ${fmtDateTime(enc.created_at)}</p>`;
    if (data.responses) {
      for (const r of data.responses) {
        const obj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        html += `<h4>${escapeHtml(r.category)}</h4><table class="detail-table">`;
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('__')) continue;
          html += `<tr><th>${escapeHtml(k)}</th><td>${formatValue(v)}</td></tr>`;
        }
        html += '</table>';
      }
    }
    html += '</div>';
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<html><head><title>Anamnese</title><style>body{font-family:Arial;margin:20px}h2{margin-bottom:8px}h4{margin-top:16px;margin-bottom:4px;text-transform:uppercase;font-size:12px;color:#666}.detail-table{width:100%;border-collapse:collapse;font-size:14px}.detail-table th{text-align:left;padding:6px 8px;background:#f5f5f5;border:1px solid #ddd;width:35%}.detail-table td{padding:6px 8px;border:1px solid #ddd}</style></head><body>' + html + '</body></html>');
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    }
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
  } catch (e) { container.innerHTML = '<div class="empty">Fehler: ' + (e.message || e) + '</div>'; }
}

// ─── Helpers ────────────────────────────────────────────────────
function _parseAsUTC(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d)) {
    return new Date(d.replace(' ', 'T') + 'Z');
  }
  return new Date(d);
}
function fmtDate(d) {
  if (!d) return '-';
  try { const dt = _parseAsUTC(d); if (!dt || isNaN(dt.getTime())) return d; return dt.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }); } catch { return d; }
}
function fmtDateTime(d) {
  if (!d) return '-';
  try { const dt = _parseAsUTC(d); if (!dt || isNaN(dt.getTime())) return d; return dt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }); } catch { return d; }
}

// ─── Settings (TOTP) ────────────────────────────────────────────────────
async function loadSettings() {
  const container = document.getElementById('settings-content');
  if (!currentAdmin) {
    container.innerHTML = '<p class="empty">Lade...</p>';
    return;
  }

  let settings = {};
  let loadError = '';
  try {
    const res = await fetch(`${API}/practice/${CURRENT_PRACTICE}/settings`, { credentials: 'include' });
    if (res.ok) {
      settings = await res.json();
    } else {
      const err = await res.json();
      loadError = err.error || 'Fehler beim Laden der Einstellungen';
    }
  } catch (e) {
    loadError = 'Netzwerkfehler beim Laden der Einstellungen';
  }

  let html = '';

  // --- Praxis-Stammdaten ---
  html += `<div class="card" style="margin-bottom:20px;">`;
  html += `<h2>Praxis-Stammdaten</h2>`;
  if (loadError) html += `<p style="color:#ef4444;font-size:0.9rem;margin-bottom:12px;">${escapeHtml(loadError)}</p>`;
  html += `<div class="form-row"><div><label>Praxisname</label><input type="text" id="s-name" value="${escapeHtml(settings.name || '')}" placeholder="z.B. Praxis Dr. Mustermann"></div><div><label>Für myhistree verwendete E-Mail Adresse</label><input type="email" id="s-email" value="${escapeHtml(settings.email || '')}" placeholder="praxis@example.de"></div></div>`;
  html += `<div class="form-row"><div><label>Adresse</label><input type="text" id="s-address" value="${escapeHtml(settings.address || '')}" placeholder="Musterstraße 123"></div><div><label>Telefon</label><input type="text" id="s-phone" value="${escapeHtml(settings.phone || '')}" placeholder="+49 30 1234567"></div></div>`;
  html += `<div class="form-row"><div><label>PLZ</label><input type="text" id="s-postal" value="${escapeHtml(settings.postal_code || '')}" placeholder="10115"></div><div><label>Ort</label><input type="text" id="s-city" value="${escapeHtml(settings.city || '')}" placeholder="Berlin"></div></div>`;
  html += `<div style="margin-top:12px;"><button class="btn btn-primary" onclick="saveSettings()">Speichern</button><span id="settings-msg-stammdaten" style="margin-left:10px;font-size:0.9rem;"></span></div>`;
  html += `</div>`;

  // --- SMTP-Konfiguration ---
  html += `<div class="card" style="margin-bottom:20px;">`;
  html += `<h2>SMTP-Konfiguration</h2>`;
  html += `<div class="form-row"><div><label>SMTP-Host</label><input type="text" id="s-smtp-host" value="${escapeHtml(settings.smtp_host || '')}" placeholder="z.B. smtp.ionos.de"></div><div><label>SMTP-Port</label><input type="number" id="s-smtp-port" value="${escapeHtml(settings.smtp_port || '')}" placeholder="587"></div></div>`;
  html += `<div class="form-row"><div><label>SMTP-Benutzer</label><input type="text" id="s-smtp-user" value="${escapeHtml(settings.smtp_user || '')}" placeholder="mail@praxis.de"></div><div><label>SMTP-Passwort</label><input type="password" id="s-smtp-pass" value="${escapeHtml(settings.smtp_pass || '')}"></div></div>`;
  html += `<div class="form-row"><div><label>Absendername</label><input type="text" id="s-from-name" value="${escapeHtml(settings.email_from_name || '')}" placeholder="z.B. Praxis Dr. Mustermann"></div><div><label>Reply-To</label><input type="email" id="s-reply-to" value="${escapeHtml(settings.email_reply_to || '')}" placeholder="antwort@praxis.de"></div></div>`;
  html += `<div style="margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">`;
  html += `<button class="btn btn-primary" id="btn-save-settings" onclick="saveSettings()">Speichern</button>`;
  html += `<button class="btn btn-secondary" id="btn-test-email" onclick="sendTestEmail()">Test-E-Mail senden</button>`;
  html += `<span id="settings-msg" style="font-size:0.9rem;"></span>`;
  html += `</div>`;
  html += `</div>`;

  // --- KI-Anbieter (Info) ---
  html += `<div class="card" style="margin-bottom:20px;">`;
  html += `<h2>KI-Anbieter (Anzeige im Consent-Bogen)</h2>`;
  html += `<p style="font-size:0.85rem;color:#64748b;margin-bottom:12px;">Wird rein informativ auf dem Aufklaerungsbogen angezeigt. Keine API-Anbindung.</p>`;
  html += `<div class="form-row"><div><label>Name des KI-Anbieters</label><input type="text" id="s-ki-provider" value="${escapeHtml(settings.ki_provider_name || '')}" placeholder="z.B. Transkriptor"></div><div><label>KI-Produkt / Software</label><input type="text" id="s-ki-product" value="${escapeHtml(settings.ki_product_name || '')}" placeholder="z.B. Kassenaerztl. Notdienst-Shield"></div></div>`;
  html += `<div class="form-row"><div><label>Hersteller</label><input type="text" id="s-ki-manufacturer" value="${escapeHtml(settings.ki_manufacturer || '')}" placeholder="z.B. Acme Health GmbH"></div><div><label>KI-Modellanbieter</label><input type="text" id="s-ki-model" value="${escapeHtml(settings.ki_model_provider || '')}" placeholder="z.B. OpenAI Ireland Ltd."></div></div>`;
  html += `<div class="form-row"><div><label>Verarbeitungsort</label><input type="text" id="s-ki-location" value="${escapeHtml(settings.ki_processing_location || '')}" placeholder="z.B. EU-Datenzentren (Irland, Deutschland)"></div><div><label>Drittstaaten-Transfer</label><select id="s-ki-third-country"><option value="">-- Bitte waehlen --</option><option value="no" ${settings.ki_third_country_transfer === 'no' ? 'selected' : ''}>Ausserhalb EU Nein</option><option value="yes" ${settings.ki_third_country_transfer === 'yes' ? 'selected' : ''}>Ausserhalb EU Ja</option></select></div></div>`;
  html += `<div style="margin-top:12px;"><button class="btn btn-primary" onclick="saveSettings()">Speichern</button><span id="settings-msg-ki" style="margin-left:10px;font-size:0.9rem;"></span></div>`;
  html += `</div>`;

  // --- Recall-Einstellungen ---
  html += `<div class="card" style="margin-bottom:20px;">`;
  html += `<h2>Recall-Einstellungen</h2>`;
  html += `<p style="font-size:0.85rem;color:#64748b;margin-bottom:12px;">Links, die in Recall-E-Mails eingefuegt werden.</p>`;
  html += `<div class="form-row"><div><label>Online-Rezeption URL</label><input type="url" id="s-recall-medflex" value="${escapeHtml(settings.recall_medflex_url || '')}" placeholder="https://"></div><div><label>Terminbuchungsportal URL</label><input type="url" id="s-recall-medatixx" value="${escapeHtml(settings.recall_medatixx_url || '')}" placeholder="https://"></div></div>`;
  html += `<div style="margin-top:12px;"><button class="btn btn-primary" onclick="saveSettings()">Speichern</button><span id="settings-msg-recall" style="margin-left:10px;font-size:0.9rem;"></span></div>`;
  html += `</div>`;

  // --- Passwort / TOTP ---
  html += `<div class="card" style="margin-bottom:20px;">`;
  html += `<h2>Sicherheit</h2>`;
  html += `<h3 style="margin-top:16px;">Passwort aendern</h3>`;
  html += `<div class="form-row"><div><label>Aktuelles Passwort</label><input type="password" id="pw-current" placeholder="••••••••"></div><div></div></div>`;
  html += `<div class="form-row"><div><label>Neues Passwort</label><input type="password" id="pw-new" placeholder="Mindestens 8 Zeichen"></div><div><label>Neues Passwort wiederholen</label><input type="password" id="pw-confirm" placeholder="••••••••"></div></div>`;
  html += `<button class="btn btn-primary" id="btn-change-pw" onclick="changePassword()">Passwort aendern</button>`;
  html += `<div id="pw-msg" style="margin-top:10px;font-size:0.875rem;"></div>`;

  if (currentAdmin.totp_enabled) {
    html += `<div style="padding:16px;background:#dcfce7;border-radius:10px;margin-top:16px;"><p><strong>Zwei-Faktor-Authentifizierung ist aktiviert.</strong></p><p style="font-size:0.875rem;color:#166534;margin-top:8px;">Ihr Account ist durch TOTP (Authenticator-App) geschuetzt.</p></div>`;
  } else {
    html += `<div style="padding:16px;background:#fef3c7;border-radius:10px;margin-top:16px;"><p><strong>Zwei-Faktor-Authentifizierung ist nicht aktiviert.</strong></p><p style="font-size:0.875rem;color:#92400e;margin-top:8px;">Empfohlen: Scannen Sie den QR-Code mit einer Authenticator-App.</p></div>`;
    html += `<button class="btn btn-primary" id="btn-setup-totp" onclick="setupTotp()">Authenticator einrichten</button>`;
    html += `<div id="totp-qr" style="margin-top:16px;display:none;"></div>`;
    html += `<div id="totp-confirm" style="margin-top:16px;display:none;"><label>6-stelliger Code aus der App</label><input type="text" id="totp-confirm-code" placeholder="123456" maxlength="6" inputmode="numeric"><button class="btn btn-primary" style="margin-top:8px;" onclick="confirmTotp()">Aktivieren</button></div>`;
  }
  html += `</div>`;

  container.innerHTML = html;
}

async function saveSettings() {
  const btn = document.getElementById('btn-save-settings');
  const msg = document.getElementById('settings-msg');
  btn.disabled = true;
  msg.textContent = 'Speichere...';
  msg.style.color = 'var(--text-light)';

  const payload = {
    name: document.getElementById('s-name').value.trim(),
    email: document.getElementById('s-email').value.trim(),
    address: document.getElementById('s-address').value.trim(),
    phone: document.getElementById('s-phone').value.trim(),
    postalCode: document.getElementById('s-postal').value.trim(),
    city: document.getElementById('s-city').value.trim(),
    smtpHost: document.getElementById('s-smtp-host').value.trim(),
    smtpPort: document.getElementById('s-smtp-port').value.trim(),
    smtpUser: document.getElementById('s-smtp-user').value.trim(),
    smtpPass: document.getElementById('s-smtp-pass').value,
    fromName: document.getElementById('s-from-name').value.trim(),
    replyTo: document.getElementById('s-reply-to').value.trim(),
    kiProviderName: document.getElementById('s-ki-provider').value.trim(),
    kiProductName: document.getElementById('s-ki-product').value.trim(),
    kiManufacturer: document.getElementById('s-ki-manufacturer').value.trim(),
    kiModelProvider: document.getElementById('s-ki-model').value.trim(),
    kiProcessingLocation: document.getElementById('s-ki-location').value.trim(),
    kiThirdCountryTransfer: document.getElementById('s-ki-third-country').value.trim(),
    recallMedflexUrl: document.getElementById('s-recall-medflex').value.trim(),
    recallMedatixxUrl: document.getElementById('s-recall-medatixx').value.trim()
  };

  try {
    const res = await fetch(`${API}/practice/${CURRENT_PRACTICE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Fehler beim Speichern';
      msg.style.color = '#ef4444';
    } else {
      msg.textContent = 'Gespeichert.';
      msg.style.color = '#16a34a';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    }
  } catch (e) {
    msg.textContent = 'Netzwerkfehler.';
    msg.style.color = '#ef4444';
  } finally {
    btn.disabled = false;
  }
}

async function sendTestEmail() {
  const btn = document.getElementById('btn-test-email');
  const msg = document.getElementById('settings-msg');
  btn.disabled = true;
  msg.textContent = 'Sende Test-E-Mail...';
  msg.style.color = 'var(--text-light)';

  try {
    const res = await fetch(`${API}/practice/${CURRENT_PRACTICE}/test-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ to: document.getElementById('s-email').value.trim() })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Fehler beim Versand';
      msg.style.color = '#ef4444';
    } else {
      msg.textContent = 'Test-E-Mail versandt.';
      msg.style.color = '#16a34a';
      setTimeout(() => { msg.textContent = ''; }, 3000);
    }
  } catch (e) {
    msg.textContent = 'Netzwerkfehler.';
    msg.style.color = '#ef4444';
  } finally {
    btn.disabled = false;
  }
}

async function setupTotp() {
  const btn = document.getElementById('btn-setup-totp');
  btn.disabled = true; btn.textContent = 'Lade...';
  try {
    const res = await fetch(`${API}/auth/setup-totp`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); return; }
    const qrDiv = document.getElementById('totp-qr');
    qrDiv.innerHTML = `<p style="margin-bottom:8px;">Scannen Sie diesen QR-Code:</p><img src="${data.qrCode}" style="max-width:240px;border-radius:8px;" alt="TOTP QR Code">`;
    qrDiv.style.display = 'block';
    document.getElementById('totp-confirm').style.display = 'block';
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.textContent = 'Authenticator einrichten'; }
}

async function confirmTotp() {
  const code = document.getElementById('totp-confirm-code').value.trim();
  if (!/^\d{6}$/.test(code)) { alert('Bitte einen gueltigen 6-stelligen Code eingeben.'); return; }
  try {
    const res = await fetch(`${API}/auth/confirm-totp`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ token: code })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); return; }
    alert('TOTP erfolgreich aktiviert! Ab sofort wird bei jedem Login ein Code verlangt.');
    currentAdmin.totp_enabled = 1;
    loadSettings();
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
}

async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirmPw = document.getElementById('pw-confirm').value;
  const btn = document.getElementById('btn-change-pw');
  const msg = document.getElementById('pw-msg');

  if (!current || !newPw || !confirmPw) {
    msg.textContent = 'Bitte alle Felder ausfuellen.';
    msg.style.color = '#ef4444';
    return;
  }
  if (newPw.length < 8) {
    msg.textContent = 'Neues Passwort muss mindestens 8 Zeichen haben.';
    msg.style.color = '#ef4444';
    return;
  }
  if (newPw !== confirmPw) {
    msg.textContent = 'Passwoerter stimmen nicht ueberein.';
    msg.style.color = '#ef4444';
    return;
  }

  btn.disabled = true;
  msg.textContent = 'Aendere...';
  msg.style.color = 'var(--text-light)';

  try {
    const res = await fetch(`${API}/auth/change-password`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ currentPassword: current, newPassword: newPw })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Fehler';
      msg.style.color = '#ef4444';
      btn.disabled = false;
      return;
    }
    msg.textContent = 'Passwort geaendert. Sie werden abgemeldet...';
    msg.style.color = '#16a34a';
    setTimeout(() => { window.location.href = '/admin/login.html'; }, 2000);
  } catch (e) {
    msg.textContent = 'Netzwerkfehler.';
    msg.style.color = '#ef4444';
    btn.disabled = false;
  }
}

// ─── Nutzerverwaltung ────────────────────────────────────────────
async function loadUsers() {
  const container = document.getElementById('users-content');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/admin/users`, { credentials: 'include' });
    if (!res.ok) { container.innerHTML = '<p class="empty">Zugriff verweigert.</p>'; return; }
    const rows = await res.json();
    let html = `<div class="card"><h3>Benutzerverwaltung</h3>`;
    if (currentAdmin && (currentAdmin.role === 'admin' || currentAdmin.role === 'superadmin')) {
      html += `<div class="form-group"><input type="email" id="u-email" placeholder="E-Mail"><input type="password" id="u-password" placeholder="Passwort (mind. 8 Zeichen)"><select id="u-role"><option value="user">User</option><option value="admin">Admin</option></select><button class="btn btn-primary" onclick="createUser()">Benutzer erstellen</button></div>`;
    }
    html += '<table><thead><tr><th>E-Mail</th><th>Rolle</th><th>Status</th><th>TOTP</th><th>Erstellt</th><th>Aktionen</th></tr></thead><tbody>';
    for (const r of rows) {
      const statusBadge = r.active === 0
        ? '<span class="badge badge-inactive">Inaktiv</span>'
        : '<span class="badge badge-completed">Aktiv</span>';
      html += `<tr><td>${escapeHtml(r.email)}</td><td>${r.role}</td><td>${statusBadge}</td><td>${r.totp_enabled ? 'Ja' : '—'}</td><td>${fmtDate(r.created_at)}</td><td>`;
      if (currentAdmin && (currentAdmin.role === 'admin' || currentAdmin.role === 'superadmin') && r.email !== currentAdmin.email) {
        html += `<button class="btn btn-sm btn-secondary" onclick="resetUserPrompt('${r.id}')">PW reset</button> `;
        html += `<button class="btn btn-sm ${r.active === 0 ? 'btn-success' : 'btn-warning'}" onclick="toggleUserActive('${r.id}', ${r.active === 0 ? 1 : 0})">${r.active === 0 ? 'Aktivieren' : 'Deaktivieren'}</button> `;
        html += `<button class="btn btn-sm btn-danger" onclick="deleteUser('${r.id}', '${escapeHtml(r.email)}')">Löschen</button>`;
      }
      html += '</td></tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (e) { container.innerHTML = '<p class="empty">Fehler beim Laden.</p>'; }
}

async function createUser() {
  const email = document.getElementById('u-email').value.trim();
  const password = document.getElementById('u-password').value;
  const role = document.getElementById('u-role').value;
  if (!email || !password || password.length < 8) { alert('Bitte E-Mail und Passwort (min. 8 Zeichen) eingeben.'); return; }
  try {
    const res = await fetch(`${API}/admin/users`, { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ email, password, role }) });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Fehler'); return; }
    await loadUsers();
    document.getElementById('u-email').value = '';
    document.getElementById('u-password').value = '';
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
}

async function deleteUser(id, email) {
  if (!confirm(`Benutzer ${email} wirklich löschen?`)) return;
  try {
    const res = await fetch(`${API}/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { alert('Fehler'); return; }
    await loadUsers();
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
}

function resetUserPrompt(id) {
  const pw = prompt('Neues Passwort (mind. 8 Zeichen):');
  if (!pw || pw.length < 8) return;
  resetUserPassword(id, pw);
}

async function resetUserPassword(id, newPassword) {
  try {
    const res = await fetch(`${API}/admin/users/${id}/reset-password`, { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ newPassword }) });
    if (!res.ok) { alert('Fehler'); return; }
    alert('Passwort zurückgesetzt. Der Benutzer muss sich neu anmelden.');
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
}

async function toggleUserActive(id, activate) {
  const action = activate ? 'aktivieren' : 'deaktivieren';
  if (!confirm(`Benutzer wirklich ${action}?`)) return;
  try {
    const res = await fetch(`${API}/admin/users/${id}/toggle-active`, { method: 'POST', credentials: 'include' });
    if (!res.ok) { alert('Fehler'); return; }
    await loadUsers();
  } catch (e) { alert('Netzwerkfehler: ' + (e.message || e)); }
}


// ===== Kostenvoranschlaege =====
let QUOTE_DRAFT = null;
let GOA_RESULTS = [];

async function loadQuotes() {
  const el = document.getElementById('quotes-content');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/admin/quotes?practiceId=${CURRENT_PRACTICE}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    let html = '<div class="card"><h2>Kostenvoranschlaege</h2>';
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">';
    html += '<button class="btn-primary" onclick="newQuote()" style="width:auto;">Neu erstellen</button>';
    html += '<input type="text" id="quote-search" placeholder="Suche PVS-ID / Name / E-Mail..." style="flex:1;min-width:200px;" oninput="filterQuotes()">';
    html += '<select id="quote-filter-status" onchange="filterQuotes()"><option value="">Alle</option><option value="draft">Entwurf</option><option value="finalized">Finalisiert</option><option value="completed">Signiert</option></select>';
    html += '</div>';
    html += '<div id="quote-list-container">';

    if (!data.items || !data.items.length) {
      html += '<p class="empty">Keine Kostenvoranschlaege vorhanden.</p>';
    } else {
      html += '<table><thead><tr><th>PVS-ID</th><th>Patient</th><th>Datum</th><th>Status</th><th>Betrag</th><th>Aktion</th></tr></thead><tbody>';
      for (const q of data.items) {
        const badge = q.status === 'draft' ? 'badge-pending' : (q.status === 'finalized' ? 'badge-used' : 'badge-completed');
        const betrag = q.total_euro != null ? q.total_euro.toFixed(2) + ' EUR' : '-';
        const name = escapeHtml(q.patient_name || q.pvs_patient_id || '-');
        html += `<tr data-quote-id="${q.id}" data-status="${q.status}" data-search="${(q.pvs_patient_id + ' ' + (q.patient_name || '') + ' ' + (q.patient_email || '')).toLowerCase()}">`;
        html += `<td>${escapeHtml(q.pvs_patient_id || '-')}</td>`;
        html += `<td>${name}</td>`;
        html += `<td>${fmtDateTime(q.created_at).split(' ')[0]}</td>`;
        html += `<td><span class="badge ${badge}">${q.status}</span></td>`;
        html += `<td>${betrag}</td>`;
        html += `<td style="display:flex;gap:4px;"><button onclick="openQuoteEditor('${q.id}')" style="padding:4px 10px;font-size:0.8rem;border-radius:6px;background:var(--primary);color:#fff;border:none;cursor:pointer;">Bearbeiten</button>${q.status==='completed' ? '<button onclick="printQuote(\'' + q.id + '\')" style="padding:4px 10px;font-size:0.8rem;border-radius:6px;background:#28a745;color:#fff;border:none;cursor:pointer;">Drucken</button>' : ''}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    html += '</div></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<p class="empty">Fehler beim Laden.</p>';
  }
}

function filterQuotes() {
  const term = (document.getElementById('quote-search')?.value || '').toLowerCase();
  const status = document.getElementById('quote-filter-status')?.value || '';
  document.querySelectorAll('#quote-list-container tbody tr').forEach(tr => {
    const matchTerm = !term || (tr.dataset.search || '').includes(term);
    const matchStatus = !status || tr.dataset.status === status;
    tr.style.display = matchTerm && matchStatus ? '' : 'none';
  });
}

async function newQuote() {
  QUOTE_DRAFT = { id: null, title: 'Kostenvoranschlag', pvsPatientId: '', patientDob: '', patientEmail: '', patientName: '', multiplier: 2.3, items: [] };
  renderQuoteEditor();
}

async function openQuoteEditor(id) {
  try {
    const res = await fetch(`${API}/admin/quotes/${id}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const q = data.quote;
    QUOTE_DRAFT = {
      id: q.id,
      title: q.title,
      pvsPatientId: q.pvs_patient_id || '',
      patientDob: isoToDob(q.patient_dob) || '',
      patientEmail: q.patient_email || '',
      patientName: q.patient_name || '',
      multiplier: q.multiplier || 2.3,
      status: q.status,
      signatureSvg: q.signature_svg || '',
      signatureName: q.signature_name || '',
      items: (data.items || []).map(it => {
        return {
          ziffer: it.ziffer, title: it.title, description: it.description || '',
          quantity: it.quantity, unit_euro: it.unit_euro, base_euro: parseFloat(it.base_euro || 0)
        };
      })
    };
    renderQuoteEditor();
  } catch (e) { alert('Fehler: ' + (e.message || e)); }
}

function renderQuoteEditor() {
  const el = document.getElementById('quotes-content');
  const d = QUOTE_DRAFT;
  const isNew = !d.id;
  const isDraft = !d.status || d.status === 'draft';
  const isFinalized = d.status === 'finalized';
  const readOnly = !isDraft;

  let html = '<div class="card">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<h2>' + (isNew ? 'Neuer Kostenvoranschlag' : 'Kostenvoranschlag bearbeiten') + '</h2>';
  html += '<button onclick="loadQuotes()" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:0.9rem;">Zurueck zur Liste</button>';
  html += '</div>';

  html += '<div class="form-row">';
  html += '<div><label>PVS Patienten-ID</label><input type="text" id="q-pvs" value="' + escapeHtml(d.pvsPatientId) + '" ' + (readOnly ? 'disabled' : '') + ' autocomplete="off" oninput="QUOTE_DRAFT.pvsPatientId = this.value"></div>';
  html += '<div><label>Geburtsdatum</label><input type="text" id="q-dob" value="' + escapeHtml(d.patientDob) + '" ' + (readOnly ? 'disabled' : '') + ' autocomplete="off" placeholder="tt.mm.jjjj" maxlength="10" oninput="QUOTE_DRAFT.patientDob = autoFormatDob(this)"></div>';
  html += '</div>';
  html += '<div class="form-row">';
  html += '<div><label>Patientenname</label><input type="text" id="q-name" value="' + escapeHtml(d.patientName) + '" autocomplete="off" oninput="QUOTE_DRAFT.patientName = this.value"></div>';
  html += '<div><label>E-Mail</label><input type="email" id="q-email" value="' + escapeHtml(d.patientEmail) + '" autocomplete="off" oninput="QUOTE_DRAFT.patientEmail = this.value"></div>';
  html += '</div>';

  html += '<div style="margin:12px 0;">';
  html += '<label>Titel</label><input type="text" id="q-title" value="' + escapeHtml(d.title) + '" ' + (readOnly ? 'disabled' : '') + ' autocomplete="off" oninput="QUOTE_DRAFT.title = this.value">';
  html += '</div>';
  html += '<div style="margin-bottom:12px;"><label>Steigerungssatz</label>';
  html += '<select id="q-multiplier" onchange="recalcQuoteItems()" ' + (readOnly ? 'disabled' : '') + '>';
  html += '<option value="1.0" ' + (d.multiplier == 1.0 ? 'selected' : '') + '>1,0-fach (einfach)</option>';
  html += '<option value="1.5" ' + (d.multiplier == 1.5 ? 'selected' : '') + '>1,5-fach</option>';
  html += '<option value="2.0" ' + (d.multiplier == 2.0 ? 'selected' : '') + '>2,0-fach</option>';
  html += '<option value="2.3" ' + (d.multiplier == 2.3 ? 'selected' : '') + '>2,3-fach (Standard)</option>';
  html += '<option value="2.5" ' + (d.multiplier == 2.5 ? 'selected' : '') + '>2,5-fach</option>';
  html += '<option value="3.0" ' + (d.multiplier == 3.0 ? 'selected' : '') + '>3,0-fach</option>';
  html += '</select></div>';

    if (d.status === 'completed' && d.signatureSvg) {
    html += '<div style="margin-top:20px;padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">';
    html += '<h3 style="margin:0 0 8px;color:#166534;font-size:1rem;">Unterschrift</h3>';
    html += '<div style="font-size:0.9rem;color:#334155;margin-bottom:8px;">Signiert von: <strong>' + escapeHtml(d.signatureName || '') + '</strong></div>';
    html += '<div style="border:1px solid #ddd;padding:8px;background:#fff;border-radius:4px;max-width:100%;">' + (d.signatureSvg || '') + '</div>';
    html += '</div>';
  }

if (isDraft) {
    html += '<div style="margin-bottom:12px;">';
    html += '<label>Template (optional)</label>';
    html += '<select id="q-template-select" onchange="applyQuoteTemplate(this.value)"><option value="">-- Kein Template --</option></select>';
    html += '</div>';

    html += '<div style="margin-bottom:12px;">';
    html += '<label>GOAE-Ziffer suchen</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<input type="text" id="q-goa-search" placeholder="z.B. Impfung, Blutabnahme, EKG..." style="flex:1;" onkeydown="if(event.key===\'Enter\'){searchGOA();event.preventDefault();}" autocomplete="off">';
    html += '<button onclick="searchGOA()" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;">Suchen</button>';
    html += '</div>';
    html += '<div id="q-goa-results" style="margin-top:8px;"></div>';
    html += '</div>';
  }

  html += '<h3 style="margin-top:16px;font-size:1rem;">Positionen</h3>';
  html += '<table><thead><tr><th>Ziffer</th><th>Bezeichnung</th><th>Menge</th><th>Einzel (EUR)</th><th>Gesamt (EUR)</th><th></th></tr></thead><tbody id="q-items-body">';
  html += renderQuoteItemsRows();
  html += '</tbody></table>';

  html += '<div style="text-align:right;margin-top:12px;font-size:1.1rem;font-weight:700;">';
  html += 'Gesamtsumme: <span id="q-total" style="color:var(--primary);">' + formatEuro(computeQuoteTotal()) + '</span>';
  html += '</div>';

  html += '<div style="margin-top:16px;padding:12px;background:#f0f9ff;border-radius:8px;font-size:0.85rem;color:#334155;">';
  html += 'Hinweis: Dieser Kostenvoranschlag ist nach GOAE mit einem ' + d.multiplier + '-fachen Steigerungssatz kalkuliert. Die tatsaechlichen Kosten koennen je nach Aufwand abweichen. Gueltigkeit: 7 Tage. Die Krankenkasse uebernimmt diese Leistungen nicht.';
  html += '</div>';

  html += '<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;">';
  if (isDraft) {
    html += '<button onclick="saveQuote(false)" style="padding:10px 20px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Speichern (Entwurf)</button>';
    html += '<button onclick="saveQuote(true)" style="padding:10px 20px;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Fertig</button>';
  }
  if (isFinalized) {
    html += '<button onclick="sendQuoteLink()" style="padding:10px 20px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;">Per E-Mail senden</button>';
  }
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;

  // Ensure input values reflect QUOTE_DRAFT state after innerHTML rebuild
  const dobEl = document.getElementById('q-dob');
  if (dobEl) dobEl.value = d.patientDob || '';
  const pvsEl = document.getElementById('q-pvs');
  if (pvsEl) pvsEl.value = d.pvsPatientId || '';
  const nameEl = document.getElementById('q-name');
  if (nameEl) nameEl.value = d.patientName || '';
  const emailEl = document.getElementById('q-email');
  if (emailEl) emailEl.value = d.patientEmail || '';
  const titleEl = document.getElementById('q-title');
  if (titleEl) titleEl.value = d.title || '';

  if (isDraft) loadQuoteEditorTemplates();
}

function renderQuoteItemsRows() {
  const items = QUOTE_DRAFT?.items || [];
  if (!items.length) return '<tr><td colspan="6" style="text-align:center;color:#888;">Keine Positionen. Suchen Sie GOAE-Ziffern oder waehlen Sie ein Template.</td></tr>';
  let html = '';
  items.forEach((it, idx) => {
    const isDraft = !QUOTE_DRAFT.status || QUOTE_DRAFT.status === 'draft';
    const unit = parseFloat(it.unit_euro || 0);
    const line = Math.round(unit * (it.quantity || 1) * 100) / 100;
    html += '<tr>';
    html += '<td>' + escapeHtml(it.ziffer) + '</td>';
    html += '<td>' + escapeHtml(it.title) + '<br><small style="color:#888;">' + escapeHtml(it.description || '') + '</small></td>';
    html += '<td>' + (isDraft ? '<input type="number" min="0" max="99" value="' + (it.quantity||1) + '" onchange="updateItemQty(' + idx + ',this.value)" style="width:60px;text-align:center;">' : (it.quantity || 1)) + '</td>';
    html += '<td>' + formatEuro(unit) + '</td>';
    html += '<td style="font-weight:600;">' + formatEuro(line) + '</td>';
    html += '<td>' + (isDraft ? '<button onclick="removeItem(' + idx + ')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;">&times;</button>' : '') + '</td>';
    html += '</tr>';
  });
  return html;
}

function computeQuoteTotal() {
  const items = QUOTE_DRAFT?.items || [];
  let total = 0;
  for (const it of items) {
    total += parseFloat(it.unit_euro || 0) * (it.quantity || 1);
  }
  return Math.round(total * 100) / 100;
}

function updateItemQty(idx, val) {
  const q = parseInt(val, 10);
  if (!QUOTE_DRAFT.items[idx]) return;
  QUOTE_DRAFT.items[idx].quantity = isNaN(q) || q < 1 ? 1 : q;
  document.getElementById('q-items-body').innerHTML = renderQuoteItemsRows();
  document.getElementById('q-total').textContent = formatEuro(computeQuoteTotal());
}

function removeItem(idx) {
  QUOTE_DRAFT.items.splice(idx, 1);
  document.getElementById('q-items-body').innerHTML = renderQuoteItemsRows();
  document.getElementById('q-total').textContent = formatEuro(computeQuoteTotal());
}

function formatEuro(v) {
  const n = typeof v === 'number' ? v : parseFloat(v || 0);
  return n.toFixed(2).replace('.', ',') + ' EUR';
}

async function searchGOA() {
  const q = document.getElementById('q-goa-search').value.trim();
  if (!q) return;
  const resEl = document.getElementById('q-goa-results');
  resEl.innerHTML = '<small style="color:#888;">Suche...</small>';
  try {
    const res = await fetch(`${API}/admin/goa/search?q=` + encodeURIComponent(q), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    GOA_RESULTS = data.items || [];
    if (!GOA_RESULTS.length) {
      resEl.innerHTML = '<small style="color:#888;">Keine Treffer.</small>';
      return;
    }
    let html = '<div style="border:1px solid var(--border);border-radius:8px;max-height:240px;overflow:auto;">';
    for (const it of GOA_RESULTS) {
      html += '<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
      html += '<div><strong>' + escapeHtml(it.ziffer) + '</strong> ' + escapeHtml(it.title) + '<br><small>' + escapeHtml(it.description) + '</small></div>';
      html += '<div style="text-align:right;"><div>' + formatEuro(it.steiger_euro) + '</div><button onclick="addGOAItem(\'' + it.ziffer + '\')" style="padding:4px 10px;font-size:0.8rem;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;">Uebernehmen</button></div>';
      html += '</div>';
    }
    html += '</div>';
    resEl.innerHTML = html;
  } catch (e) { resEl.innerHTML = '<small style="color:#ef4444;">Fehler</small>'; }
}

function addGOAItem(ziffer) {
  const it = GOA_RESULTS.find(x => x.ziffer === ziffer);
  if (!it) return;
  const mult = parseFloat(QUOTE_DRAFT.multiplier || 2.3);
  const unit = Math.round(it.base_euro * mult * 100) / 100;
  QUOTE_DRAFT.items.push({
    ziffer: it.ziffer, title: it.title, description: it.description,
    quantity: 1, unit_euro: unit, base_euro: it.base_euro
  });
  document.getElementById('q-items-body').innerHTML = renderQuoteItemsRows();
  document.getElementById('q-total').textContent = formatEuro(computeQuoteTotal());
}

async function loadQuoteEditorTemplates() {
  try {
    const res = await fetch(`${API}/admin/goa/templates`, { credentials: 'include' });
    const data = await res.json();
    const sel = document.getElementById('q-template-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Kein Template --</option>';
    for (const t of data.items || []) {
      sel.innerHTML += '<option value="' + escapeHtml(t.slug) + '">' + escapeHtml(t.title) + '</option>';
    }
  } catch(e) {}
}

async function applyQuoteTemplate(slug) {
  if (!slug) return;
  try {
    const res = await fetch(`${API}/admin/goa/templates`, { credentials: 'include' });
    const data = await res.json();
    const tpl = (data.items || []).find(t => t.slug === slug);
    if (!tpl) return;
    const items = JSON.parse(tpl.items_json || '[]');
    QUOTE_DRAFT.items = [];
    for (const it of items) {
      QUOTE_DRAFT.items.push({
        ziffer: it.ziffer, title: it.title, description: '',
        quantity: it.quantity || 1, unit_euro: 0, base_euro: 0
      });
    }
    // Resolve prices
    const mult = parseFloat(QUOTE_DRAFT.multiplier || 2.3);
    for (let idx = 0; idx < QUOTE_DRAFT.items.length; idx++) {
      const it = QUOTE_DRAFT.items[idx];
      try {
        const r = await fetch(`${API}/admin/goa/search?q=` + encodeURIComponent(it.ziffer), { credentials: 'include' });
        const d = await r.json();
        const found = (d.items || []).find(x => x.ziffer === it.ziffer);
        if (found) {
          it.title = found.title;
          it.description = found.description;
          it.base_euro = found.base_euro;
          it.unit_euro = Math.round(found.base_euro * mult * 100) / 100;
        }
      } catch(e) {}
    }
    renderQuoteEditor();
  } catch (e) { alert('Template-Fehler: ' + e.message); }
}

async function recalcQuoteItems() {
  if (!QUOTE_DRAFT || !QUOTE_DRAFT.items) return;
  const mult = parseFloat(document.getElementById('q-multiplier').value) || 2.3;
  QUOTE_DRAFT.multiplier = mult;
  for (const it of QUOTE_DRAFT.items) {
    if (it.base_euro) {
      it.unit_euro = Math.round(it.base_euro * mult * 100) / 100;
    }
  }
  document.getElementById('q-items-body').innerHTML = renderQuoteItemsRows();
  document.getElementById('q-total').textContent = formatEuro(computeQuoteTotal());
  const hintDiv = document.querySelector('#quotes-content .card > div[style*="background:#f0f9ff"]');
  if (hintDiv) {
    hintDiv.textContent = 'Hinweis: Dieser Kostenvoranschlag ist nach GOAE mit einem ' + mult + '-fachen Steigerungssatz kalkuliert. Die tatsaechlichen Kosten koennen je nach Aufwand abweichen. Gueltigkeit: 7 Tage. Die Krankenkasse uebernimmt diese Leistungen nicht.';
  }
}

async function saveQuote(finalize) {
  const d = QUOTE_DRAFT;
  d.pvsPatientId = document.getElementById('q-pvs').value.trim();
  var rawDob = (d.patientDob || document.getElementById('q-dob').value || '').trim();
  d.patientDob = parseDobToISO(rawDob);
  if (!d.patientDob && rawDob.length >= 6) { d.patientDob = rawDob; } // fallback for incomplete format
  // Read current values from DOM (oninput may miss paste/autofill)
  const nameEl = document.getElementById('q-name');
  const emailEl = document.getElementById('q-email');
  if (nameEl) d.patientName = nameEl.value.trim();
  if (emailEl) d.patientEmail = emailEl.value.trim();
  d.title = document.getElementById('q-title').value.trim() || 'Kostenvoranschlag';
  d.multiplier = parseFloat(document.getElementById('q-multiplier').value) || 2.3;
  if (!d.pvsPatientId) { alert('Bitte PVS-ID eingeben.'); return; }

  try {
    let id = d.id;
    if (!id) {
      const res = await fetch(`${API}/admin/quotes`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
        body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: d.pvsPatientId, patientDob: d.patientDob, patientEmail: d.patientEmail || '', patientName: d.patientName || '', title: d.title, multiplier: d.multiplier, totalEuro: computeQuoteTotal() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      id = data.id;
      d.id = id;
    }
    const putBody = { title: d.title, patientName: d.patientName || '', patientEmail: d.patientEmail || '', patientDob: d.patientDob || '', multiplier: d.multiplier, items: d.items };
    console.log('PUT body:', JSON.stringify(putBody, null, 2));
    const res2 = await fetch(`${API}/admin/quotes/${id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify(putBody)
    });
    const d2 = await res2.json();
    if (!res2.ok) throw new Error(d2.error || 'Fehler');

    if (finalize) {
      const res3 = await fetch(`${API}/admin/quotes/${id}/finalize`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: '{}'
      });
      const d3 = await res3.json();
      if (!res3.ok) throw new Error(d3.error || 'Fehler');
    }
    if (finalize) { await loadQuotes(); } else { const btn = document.activeElement; if (btn && btn.textContent.includes("Entwurf")) { btn.textContent = "Gespeichert!"; setTimeout(() => btn.textContent = "Speichern (Entwurf)", 1500); } }
  } catch (e) { alert('Fehler: ' + (e.message || e)); }
}

async function sendQuoteLink() {
  if (!QUOTE_DRAFT) return;
  try {
    QUOTE_DRAFT.pvsPatientId = document.getElementById('q-pvs').value.trim();
    var rawDob2 = (QUOTE_DRAFT.patientDob || document.getElementById('q-dob').value || '').trim();
    QUOTE_DRAFT.patientDob    = parseDobToISO(rawDob2);
    if (!QUOTE_DRAFT.patientDob && rawDob2.length >= 6) { QUOTE_DRAFT.patientDob = rawDob2; }
    const nameEl2 = document.getElementById('q-name');
    const emailEl2 = document.getElementById('q-email');
    if (nameEl2) QUOTE_DRAFT.patientName = nameEl2.value.trim();
    if (emailEl2) QUOTE_DRAFT.patientEmail = emailEl2.value.trim();
    QUOTE_DRAFT.title         = document.getElementById('q-title').value.trim() || 'Kostenvoranschlag';
    QUOTE_DRAFT.multiplier    = parseFloat(document.getElementById('q-multiplier').value) || 2.3;
    if (!QUOTE_DRAFT.pvsPatientId) { alert('Bitte PVS-ID eingeben.'); return; }
    let id = QUOTE_DRAFT.id;
    if (!id) {
      const res = await fetch(`${API}/admin/quotes`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
        body: JSON.stringify({ practiceId: CURRENT_PRACTICE, pvsPatientId: QUOTE_DRAFT.pvsPatientId, patientDob: QUOTE_DRAFT.patientDob, patientEmail: QUOTE_DRAFT.patientEmail || '', patientName: QUOTE_DRAFT.patientName || '', title: QUOTE_DRAFT.title, multiplier: QUOTE_DRAFT.multiplier, totalEuro: computeQuoteTotal() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      id = data.id;
      QUOTE_DRAFT.id = id;
    }
    const putBody = { title: QUOTE_DRAFT.title, patientName: QUOTE_DRAFT.patientName || '', patientEmail: QUOTE_DRAFT.patientEmail || '', patientDob: QUOTE_DRAFT.patientDob || '', multiplier: QUOTE_DRAFT.multiplier, items: QUOTE_DRAFT.items };
    console.log('PUT body (sendLink):', JSON.stringify(putBody, null, 2));
    const res2 = await fetch(`${API}/admin/quotes/` + id, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify(putBody)
    });
    const d2 = await res2.json();
    if (!res2.ok) throw new Error(d2.error || 'Fehler');
    if (QUOTE_DRAFT.status !== 'finalized') {
      const res3 = await fetch(`${API}/admin/quotes/` + id + '/finalize', {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: '{}'
      });
      const d3 = await res3.json();
      if (!res3.ok) throw new Error(d3.error || 'Fehler');
    }
    const res4 = await fetch(`${API}/admin/quotes/` + id + '/send-link', {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({})
    });
    const data = await res4.json();
    if (!res4.ok) throw new Error(data.error || 'Fehler');
    const url = window.location.origin + data.url;
    if (data.sent) { alert('E-Mail mit Link versendet!' + '\n' + url); } else if (data.warning) { alert('Warnung: ' + data.warning + '\n' + url); } else { alert('Link erstellt (keine E-Mail-Adresse hinterlegt).' + '\n' + url); }
    QUOTE_DRAFT.status = 'finalized';
    await loadQuotes();
  } catch (e) { alert('Fehler: ' + (e.message || e)); }
}


// ===== Kostenvoranschlaege =====

// ─── PIN Toggle ─────────────────────────────────────────────────────
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

function printQuote(id) {
  fetch(API + '/admin/quotes/' + id + '/print', { credentials: 'include' })
    .then(r => { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(d => {
      const q = d.quote, items = d.items || [], pr = d.practice || {};
      const total = items.reduce((s,it) => s + (it.quantity||1) * (parseFloat(it.unit_euro)||0), 0);
      let h = '<!DOCTYPE html><html><head><meta charset=utf-8><title>Kostenvoranschlag</title>';
      h += '<style>@page{margin:20mm}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.4;color:#000;margin:0;padding:0}';
      h += '.header{border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px}';
      h += '.header h1{font-size:16pt;margin:0 0 6px}.header .addr{color:#333;font-size:10pt}';
      h += '.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:10pt}';
      h += '.meta div{background:#f5f5f5;padding:8px;border-radius:4px}';
      h += '.meta strong{display:block;font-size:9pt;text-transform:uppercase;color:#666;margin-bottom:2px}';
      h += 'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:10pt}';
      h += 'th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #ddd}';
      h += 'th{background:#f0f0f0;font-weight:600}td.num{text-align:right}';
      h += '.total-row{font-weight:700;font-size:12pt;text-align:right;margin-top:12px;padding-top:8px;border-top:2px solid #000}';
      h += '.sig-box{margin-top:30px;border:1px solid #ccc;padding:10px;border-radius:4px;text-align:center;page-break-inside:avoid}';
      h += '.sig-box svg{max-width:100%;height:auto;max-height:300px}';
      h += '.sig-name{margin-top:6px;font-size:10pt}';
      h += '.date{margin-top:8px;font-size:9pt;color:#444}';
      h += '@media print{.no-print{display:none} button{display:none}}';
      h += '</style></head><body>';
      h += '<div class="header"><h1>Kostenvoranschlag</h1>';
      h += '<div class="addr">' + escapeHtml(pr.name||'-') + '<br>' + escapeHtml(pr.address||'') + '<br>' + escapeHtml(pr.postal_code||'') + ' ' + escapeHtml(pr.city||'') + '<br>Tel: ' + escapeHtml(pr.phone||'-') + '</div></div>';
      h += '<div class="meta">';
      h += '<div><strong>PVS-ID</strong>' + escapeHtml(q.pvs_patient_id||'-') + '</div>';
      h += '<div><strong>Patient</strong>' + escapeHtml(q.patient_name||'-') + '</div>';
      h += '<div><strong>Geburtsdatum</strong>' + escapeHtml(q.patient_dob||'-') + '</div>';
      h += '<div><strong>E-Mail</strong>' + escapeHtml(q.patient_email||'-') + '</div>';
      h += '<div><strong>Titel</strong>' + escapeHtml(q.title||'-') + '</div>';
      h += '<div><strong>Steigerungssatz</strong>' + (q.multiplier||'2.3') + '-fach</div>';
      h += '<div><strong>Datum</strong>' + new Date(q.created_at).toLocaleDateString('de-DE') + '</div>';
      h += '<div><strong>Status</strong>' + escapeHtml(q.status||'-') + '</div></div>';
      h += '<table><thead><tr><th>Pos</th><th>Ziffer</th><th>Bezeichnung</th><th>Menge</th><th class="num">Einheit (EUR)</th><th class="num">Betrag (EUR)</th></tr></thead><tbody>';
      items.forEach((it,i) => {
        const ue = parseFloat(it.unit_euro||0), betrag = (it.quantity||1)*ue;
        h += '<tr><td>' + (i+1) + '</td><td>' + escapeHtml(it.ziffer||'-') + '</td><td>' + escapeHtml(it.title||it.description||'-') + '</td><td>' + (it.quantity||1) + 'x</td><td class="num">' + ue.toFixed(2) + '</td><td class="num">' + betrag.toFixed(2) + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="total-row">Gesamtsumme: ' + total.toFixed(2).replace('.',',') + ' EUR</div>';
      if (q.signature_svg) {
        h += '<div class="sig-box"><div><strong>Unterschrift</strong></div>' + q.signature_svg + '<div class="sig-name">' + escapeHtml(q.signature_name||'') + '</div><div class="date">Signiert am ' + new Date(q.signed_at).toLocaleDateString('de-DE') + ' um ' + new Date(q.signed_at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}) + '</div></div>';
      }
      h += '<div class="no-print" style="margin-top:20px;text-align:center;"><button onclick="window.print()" style="padding:10px 20px;font-size:12pt;background:#000;color:#fff;border:none;border-radius:6px;cursor:pointer;">Drucken</button></div>';
      h += '</body></html>';
      const w = window.open('','_blank','width=800,height=900');
      w.document.write(h); w.document.close();
    })
    .catch(e => alert('Fehler: ' + e.message));
}



// ─── QUOTE TEMPLATES ──────────────────────────────────────────
let TEMPLATE_DRAFT = {id:null, slug:'', title:'', description:'', items:[]};

async function loadQuoteTemplates() {
  try {
    const res = await fetch(`${API}/admin/quote-templates`, {credentials:'include'});
    if (!res.ok) return;
    const data = await res.json();
    const container = document.getElementById('templates-list');
    if (!container) return;
    if (!data.templates || !data.templates.length) {
      container.innerHTML = '<div class="empty">Noch keine Vorlagen.</div>'; return;
    }
    let html = '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid #ccc;">Slug</th><th style="text-align:left;padding:6px;border-bottom:1px solid #ccc;">Titel</th><th style="text-align:center;padding:6px;border-bottom:1px solid #ccc;">Ziffern</th><th style="padding:6px;border-bottom:1px solid #ccc;">Aktionen</th></tr></thead><tbody>';
    for (const t of data.templates) {
      let itemCount = 0;
      try { const items = JSON.parse(t.items_json||'[]'); itemCount = items.length; } catch(e){}
      html += `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(t.slug)}</td><td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(t.title)}</td><td style="padding:6px;text-align:center;border-bottom:1px solid #eee;">${itemCount}</td><td style="padding:6px;border-bottom:1px solid #eee;"><button class="btn btn-sm btn-secondary" onclick="openTemplateEditor('${t.id}')">Bearbeiten</button> <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${t.id})">Löschen</button></td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch(e) { console.error('Templates error', e); }
}

function newTemplateEditor() {
  TEMPLATE_DRAFT = {id:null, slug:'', title:'', description:'', items:[]};
  renderTemplateEditor();
}

async function openTemplateEditor(id) {
  try {
    const res = await fetch(`${API}/admin/quote-templates/${id}`, {credentials:'include'});
    if (!res.ok) return;
    const t = await res.json();
    TEMPLATE_DRAFT = {id: t.id, slug: t.slug, title: t.title, description: t.description||'', items: t.items||[]};
    renderTemplateEditor();
  } catch(e) { console.error('openTemplateEditor error', e); }
}

function renderTemplateEditor() {
  if (typeof TEMPLATE_DRAFT === 'undefined') TEMPLATE_DRAFT = {id:null, slug:'', title:'', description:'', items:[]};
  const d = TEMPLATE_DRAFT;
  const editor = document.getElementById('template-editor');
  if (!editor) return;
  let html = '<h3 style="margin-top:0;">' + (d.id ? 'Vorlage bearbeiten' : 'Neue Vorlage') + '</h3>';
  html += '<div class="form-row">';
  html += '<div><label>Slug (einmalig)</label><input type="text" id="tpl-slug" value="' + escapeHtml(d.slug) + '" ' + (d.id ? 'disabled' : '') + ' autocomplete="off" oninput="TEMPLATE_DRAFT.slug = this.value" placeholder="z.B. gesundheitscheck"></div>';
  html += '<div><label>Titel</label><input type="text" id="tpl-title" value="' + escapeHtml(d.title) + '" autocomplete="off" oninput="TEMPLATE_DRAFT.title = this.value" placeholder="Anzeigename"></div>';
  html += '</div>';
  html += '<div style="margin:12px 0;"><label>Beschreibung</label><textarea id="tpl-desc" rows="2" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc;" oninput="TEMPLATE_DRAFT.description = this.value">' + escapeHtml(d.description) + '</textarea></div>';
  html += '<div style="display:flex;gap:6px;margin-bottom:8px;">';
  html += '<input type="text" id="tpl-goa-search" placeholder="GOÄ Ziffer oder Begriff suchen..." style="flex:1;padding:8px;border-radius:6px;border:1px solid #ccc;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();searchTemplateGOA();}">';
  html += '<button class="btn btn-sm btn-secondary" onclick="searchTemplateGOA()">Suchen</button>';
  html += '</div>';
  html += '<div id="tpl-goa-results" style="margin-bottom:8px;"></div>';
  html += '<div id="tpl-items-container">';
  if (d.items && d.items.length) {
    html += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:4px;border-bottom:1px solid #ccc;">Ziffer</th><th style="text-align:left;padding:4px;border-bottom:1px solid #ccc;">Leistung</th><th style="text-align:right;padding:4px;border-bottom:1px solid #ccc;">Anz.</th><th style="text-align:right;padding:4px;border-bottom:1px solid #ccc;">Euro</th><th style="padding:4px;border-bottom:1px solid #ccc;"></th></tr></thead><tbody>';
    let total = 0;
    for (let i=0;i<d.items.length;i++) {
      const it = d.items[i];
      const line = Math.round((it.unit_euro||0)*(it.quantity||1)*100)/100;
      total += line;
      html += '<tr><td style="padding:4px;border-bottom:1px solid #eee;">' + escapeHtml(it.ziffer) + '</td><td style="padding:4px;border-bottom:1px solid #eee;">' + escapeHtml(it.title) + (it.description ? '<br><span style="font-size:0.75rem;color:#94a3b8;">' + escapeHtml(it.description) + '</span>' : '') + '</td>';
      html += '<td style="padding:4px;text-align:right;border-bottom:1px solid #eee;"><input type="number" min="1" value="' + (it.quantity||1) + '" style="width:50px;" onchange="updateTemplateItemQty(' + i + ',this.value)"></td>';
      html += '<td style="padding:4px;text-align:right;border-bottom:1px solid #eee;">' + fmtEuro(it.unit_euro||0) + '</td>';
      html += '<td style="padding:4px;border-bottom:1px solid #eee;"><button class="btn btn-sm btn-danger" onclick="removeTemplateItem(' + i + ')">×</button></td></tr>';
    }
    html += '</tbody></table>';
    html += '<div style="text-align:right;font-weight:700;margin-top:6px;">Summe: ' + fmtEuro(total) + '</div>';
  } else {
    html += '<div class="empty" style="padding:8px 0;">Noch keine GOÄ-Ziffern hinzugefügt.</div>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:12px;">';
  html += '<button class="btn btn-primary" onclick="saveTemplate()">Speichern</button>';
  html += '<button class="btn btn-secondary" onclick="closeTemplateEditor()">Abbrechen</button>';
  if (d.id) html += '<button class="btn btn-danger" onclick="deleteTemplate(' + d.id + ')">Löschen</button>';
  html += '</div>';
  editor.innerHTML = html;
  editor.style.display = 'block';
  window.scrollTo({top: document.getElementById('templates-panel').offsetTop, behavior:'smooth'});
}

async function searchTemplateGOA() {
  const q = document.getElementById('tpl-goa-search').value.trim();
  const container = document.getElementById('tpl-goa-results');
  if (!q || q.length < 1) { container.innerHTML = ''; return; }
  container.innerHTML = '<div style="font-size:0.85rem;color:#888;">Suche läuft...</div>';
  try {
    const res = await fetch(`${API}/admin/goa/search?q=` + encodeURIComponent(q), {credentials:'include'});
    if (!res.ok) { container.innerHTML = '<div style="font-size:0.85rem;color:#ef4444;">Fehler ' + res.status + '</div>'; return; }
    const data = await res.json();
    if (!data.items || !data.items.length) { container.innerHTML = '<div style="font-size:0.85rem;color:#94a3b8;">Keine Treffer.</div>'; return; }
    let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    for (const r of data.items) {
      const euro = fmtEuro(r.euro || 0);
      const itemStr = JSON.stringify({ziffer:String(r.ziffer), title:r.title, description:r.description||"", unit_euro:r.euro||0, base_euro:r.euro||0, quantity:1}).replace(/"/g, '&quot;');
      html += '<button class="btn btn-sm btn-secondary" style="font-size:0.75rem;" onclick="addTemplateItem(\'' + itemStr + '\')">' + escapeHtml(String(r.ziffer)) + ' — ' + escapeHtml(r.title) + ' (' + euro + ')</button>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch(e) { console.error("searchTemplateGOA error", e); container.innerHTML = '<div style="font-size:0.85rem;color:#ef4444;">Suche fehlgeschlagen: ' + escapeHtml(String(e.message || e)) + '</div>'; }
}

function addTemplateItem(itemStr) {
  try { const item = JSON.parse(itemStr.replace(/&quot;/g, '"')); TEMPLATE_DRAFT.items.push(item); renderTemplateEditor(); } catch(e){}
}
function updateTemplateItemQty(idx, qty) {
  if (TEMPLATE_DRAFT.items[idx]) TEMPLATE_DRAFT.items[idx].quantity = parseInt(qty) || 1;
  renderTemplateEditor();
}
function removeTemplateItem(idx) {
  TEMPLATE_DRAFT.items.splice(idx, 1);
  renderTemplateEditor();
}

function closeTemplateEditor() {
  TEMPLATE_DRAFT = {id:null, slug:'', title:'', description:'', items:[]};
  const editor = document.getElementById('template-editor');
  if (editor) { editor.innerHTML = ''; editor.style.display = 'none'; }
  loadQuoteTemplates();
}

async function saveTemplate() {
  const d = TEMPLATE_DRAFT;
  d.slug = document.getElementById('tpl-slug') ? document.getElementById('tpl-slug').value.trim() : d.slug;
  d.title = document.getElementById('tpl-title') ? document.getElementById('tpl-title').value.trim() : d.title;
  d.description = document.getElementById('tpl-desc') ? document.getElementById('tpl-desc').value.trim() : d.description;
  if (!d.slug) { alert('Bitte Slug eingeben.'); return; }
  if (!d.title) { alert('Bitte Titel eingeben.'); return; }
  const payload = { slug: d.slug, title: d.title, description: d.description, items: d.items };
  try {
    let res;
    if (d.id) {
      res = await fetch(`${API}/admin/quote-templates/${d.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
    } else {
      res = await fetch(`${API}/admin/quote-templates`, { method: 'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
    }
    if (!res.ok) { const data = await res.json().catch(()=>({})); alert(data.error || 'Fehler'); return; }
    alert('Gespeichert!');
    closeTemplateEditor();
  } catch(e) { alert('Fehler beim Speichern.'); }
}

async function deleteTemplate(id) {
  if (!confirm('Vorlage wirklich löschen?')) return;
  try {
    const res = await fetch(`${API}/admin/quote-templates/${id}`, {method:'DELETE', credentials:'include'});
    if (!res.ok) { const data = await res.json().catch(()=>({})); alert(data.error || 'Fehler'); return; }
    closeTemplateEditor();
  } catch(e) { alert('Fehler beim Löschen.'); }
}
