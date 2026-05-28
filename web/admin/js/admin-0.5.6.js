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
      let userDiv = header.querySelector('.user-info');
      if (!userDiv) {
        userDiv = document.createElement('div');
        userDiv.className = 'user-info';
        header.appendChild(userDiv);
      }
      userDiv.innerHTML = `<span title="${currentAdmin.role}">${currentAdmin.email}</span><button onclick="doLogout()">Abmelden</button>`;
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
  if (tab === 'settings') loadSettings();
  if (tab === 'users') loadUsers();
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
      const ts = r.completed_at || r.updated_at || r.created_at;
      const d = ts ? new Date(ts) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentProcessed = processed.filter(r => {
      const ts = r.processed_at || r.updated_at || r.created_at;
      const d = ts ? new Date(ts) : null;
      return d && (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    });
    const recentAll = [...recentCompleted, ...recentProcessed].sort((a,b) => {
      const getTs = r => new Date(r.completed_at || r.processed_at || r.updated_at || r.created_at).getTime();
      return getTs(b) - getTs(a);
    });
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

// ─── Settings (TOTP) ────────────────────────────────────────────────────
async function loadSettings() {
  const container = document.getElementById('settings-content');
  if (!currentAdmin) {
    container.innerHTML = '<p class="empty">Lade...</p>';
    return;
  }
  let html = '';

  // Passwort ändern
  html += `
    <div class="card" style="margin-bottom:20px;">
      <h3>🔐 Passwort ändern</h3>
      <div class="form-group" style="margin-top:12px;">
        <label>Aktuelles Passwort</label>
        <input type="password" id="pw-current" placeholder="••••••••">
      </div>
      <div class="form-group">
        <label>Neues Passwort</label>
        <input type="password" id="pw-new" placeholder="Mindestens 8 Zeichen">
      </div>
      <div class="form-group">
        <label>Neues Passwort wiederholen</label>
        <input type="password" id="pw-confirm" placeholder="••••••••">
      </div>
      <button class="btn btn-primary" id="btn-change-pw" onclick="changePassword()">Passwort ändern</button>
      <div id="pw-msg" style="margin-top:10px;font-size:0.875rem;"></div>
    </div>
  `;

  // TOTP Status
  if (currentAdmin.totp_enabled) {
    html += `
      <div style="padding:16px;background:#dcfce7;border-radius:10px;">
        <p><strong>✅ Zwei-Faktor-Authentifizierung ist aktiviert.</strong></p>
        <p style="font-size:0.875rem;color:#166534;margin-top:8px;">Ihr Account ist durch TOTP (Authenticator-App) geschützt.</p>
      </div>
    `;
  } else {
    html += `
      <div style="padding:16px;background:#fef3c7;border-radius:10px;margin-bottom:16px;">
        <p><strong>⚠️ Zwei-Faktor-Authentifizierung ist nicht aktiviert.</strong></p>
        <p style="font-size:0.875rem;color:#92400e;margin-top:8px;">Empfohlen: Scannen Sie den QR-Code mit einer Authenticator-App.</p>
      </div>
      <button class="btn btn-primary" id="btn-setup-totp" onclick="setupTotp()">Authenticator einrichten</button>
      <div id="totp-qr" style="margin-top:16px;display:none;"></div>
      <div id="totp-confirm" style="margin-top:16px;display:none;">
        <label>6-stelliger Code aus der App</label>
        <input type="text" id="totp-confirm-code" placeholder="123456" maxlength="6" inputmode="numeric">
        <button class="btn btn-primary" style="margin-top:8px;" onclick="confirmTotp()">Aktivieren</button>
      </div>
    `;
  }
  container.innerHTML = html;
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
  } catch (e) { alert('Netzwerkfehler'); }
  finally { btn.disabled = false; btn.textContent = 'Authenticator einrichten'; }
}

async function confirmTotp() {
  const code = document.getElementById('totp-confirm-code').value.trim();
  if (!/^\d{6}$/.test(code)) { alert('Bitte einen gültigen 6-stelligen Code eingeben.'); return; }
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
  } catch (e) { alert('Netzwerkfehler'); }
}

async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirmPw = document.getElementById('pw-confirm').value;
  const btn = document.getElementById('btn-change-pw');
  const msg = document.getElementById('pw-msg');

  if (!current || !newPw || !confirmPw) {
    msg.textContent = 'Bitte alle Felder ausfüllen.';
    msg.style.color = '#ef4444';
    return;
  }
  if (newPw.length < 8) {
    msg.textContent = 'Neues Passwort muss mindestens 8 Zeichen haben.';
    msg.style.color = '#ef4444';
    return;
  }
  if (newPw !== confirmPw) {
    msg.textContent = 'Passwörter stimmen nicht überein.';
    msg.style.color = '#ef4444';
    return;
  }

  btn.disabled = true;
  msg.textContent = 'Ändere...';
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
    msg.textContent = '✅ Passwort geändert. Sie werden abgemeldet...';
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
    if (currentAdmin && currentAdmin.role === 'admin') {
      html += `<div class="form-group"><input type="email" id="u-email" placeholder="E-Mail"><input type="password" id="u-password" placeholder="Passwort (mind. 8 Zeichen)"><select id="u-role"><option value="user">User</option><option value="admin">Admin</option></select><button class="btn btn-primary" onclick="createUser()">Benutzer erstellen</button></div>`;
    }
    html += '<table><thead><tr><th>E-Mail</th><th>Rolle</th><th>TOTP</th><th>Erstellt</th><th>Aktionen</th></tr></thead><tbody>';
    for (const r of rows) {
      html += `<tr><td>${r.email}</td><td>${r.role}</td><td>${r.totp_enabled ? '✅' : '—'}</td><td>${fmtDate(r.created_at)}</td><td>`;
      if (currentAdmin && currentAdmin.role === 'admin' && r.email !== currentAdmin.email) {
        html += `<button class="btn btn-sm btn-secondary" onclick="resetUserPrompt('${r.id}')">PW reset</button> <button class="btn btn-sm btn-danger" onclick="deleteUser('${r.id}', '${r.email}')">Löschen</button>`;
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
    loadUsers();
    document.getElementById('u-email').value = '';
    document.getElementById('u-password').value = '';
  } catch (e) { alert('Netzwerkfehler'); }
}

async function deleteUser(id, email) {
  if (!confirm(`Benutzer ${email} wirklich löschen?`)) return;
  try {
    const res = await fetch(`${API}/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { alert('Fehler'); return; }
    loadUsers();
  } catch (e) { alert('Netzwerkfehler'); }
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
  } catch (e) { alert('Netzwerkfehler'); }
}

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
