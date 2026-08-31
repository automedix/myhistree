const API = '/api';

/* ─── Auth Check ─────────────────────────────────────────────────── */
async function initAuth() {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
    if (!res.ok) throw new Error('unauthorized');
  } catch (e) {
    window.location.href = '/admin/login.html';
  }
}
initAuth();

/* ─── Utilities ──────────────────────────────────────────────────── */
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function autoFormatDob(input) {
  var v = input.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.slice(0,2) + '.' + v.slice(2);
  if (v.length >= 5) v = v.slice(0,5) + '.' + v.slice(5,9);
  input.value = v;
  return v;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtEuro(cents) {
  if (typeof cents !== 'number') return '—';
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ─── Upload ─────────────────────────────────────────────────────── */
async function submitAttest() {
  const fileInput = document.getElementById('attest-file');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;
  const title = (document.getElementById('attest-title') || {}).value || '';
  const firstName = (document.getElementById('attest-firstname') || {}).value || '';
  const lastName = (document.getElementById('attest-lastname') || {}).value || '';
  const dob = (document.getElementById('attest-dob') || {}).value || '';
  const amount = (document.getElementById('attest-amount') || {}).value || '';

  if (!file || !firstName || !lastName || !dob) {
    toast('Bitte alle Pflichtfelder ausfüllen und PDF auswählen.');
    return;
  }
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(dob.trim())) {
    toast('Geburtsdatum bitte als TT.MM.JJJJ eingeben.');
    return;
  }

  toast('Datei wird hochgeladen…');
  let b64;
  try {
    b64 = await fileToBase64(file);
  } catch (e) {
    toast('Datei konnte nicht gelesen werden.');
    return;
  }

  const payload = {
    file_b64: b64,
    filename: file.name,
    title: title.trim() || file.name,
    patientFirstname: firstName.trim(),
    patientLastname: lastName.trim(),
    patientDob: dob.trim(),
    amountCents: parseInt(amount, 10) || 0
  };

  try {
    const res = await fetch(`${API}/admin/attests`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Fehler: ' + res.status);
      return;
    }
    toast('Attest gespeichert!');
    document.getElementById('attest-title').value = '';
    document.getElementById('attest-firstname').value = '';
    document.getElementById('attest-lastname').value = '';
    document.getElementById('attest-dob').value = '';
    document.getElementById('attest-amount').value = '';
    if (fileInput) fileInput.value = '';
    loadAttests();
  } catch (e) {
    toast('Netzwerkfehler: ' + (e && e.message ? e.message : String(e)));
  }
}

/* ─── List ───────────────────────────────────────────────────────── */
async function loadAttests() {
  const el = document.getElementById('attests-table-container');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`${API}/admin/attests`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.innerHTML = `<div class="empty">Fehler: ${data.error || res.status}</div>`;
      return;
    }
    renderAttests(data.items || []);
  } catch (e) {
    el.innerHTML = `<div class="empty">Netzwerkfehler: ${e && e.message ? e.message : String(e)}</div>`;
  }
}

function renderAttests(list) {
  const el = document.getElementById('attests-table-container');
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = '<div class="empty">Keine Atteste vorhanden.</div>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>ID</th><th>Titel</th><th>Patient</th><th>Betrag</th><th>Status</th><th>Erstellt</th><th>Aktionen</th>' +
    '</tr></thead><tbody>';
  for (const a of list) {
    const status = a.status || 'pending_payment';
    const badgeClass = status === 'paid' || status === 'free' ? 'badge-completed' : 'badge-pending';
    const statusText = status === 'free' ? 'Kostenlos' : (status === 'paid' ? 'Bezahlt' : 'Offen');
    const amount = fmtEuro(a.amount_cents);
    const patient = `${a.patient_firstname || ''} ${a.patient_lastname || ''}`.trim() || '—';
    const created = a.created_at ? new Date(a.created_at).toLocaleDateString('de-DE') : '—';
    html += `<tr>
      <td>${a.id}</td>
      <td>${escapeHtml(a.title || '—')}</td>
      <td>${escapeHtml(patient)}</td>
      <td>${amount}</td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>${created}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="downloadAttest('${a.id}')">Download</button>
        <button class="btn btn-sm btn-secondary" onclick="copyAttestLink('${a.id}')">Link</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ─── Actions ────────────────────────────────────────────────────── */
function downloadAttest(id) {
  window.open(`${API}/admin/attests/${id}/download`, '_blank');
}

async function copyAttestLink(id) {
  try {
    const res = await fetch(`${API}/admin/attests/${id}/link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast('Fehler: ' + (data.error || res.status)); return; }
    if (data.url) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(data.url);
        toast('Link kopiert!');
      } else {
        toast('Clipboard nicht verfügbar.');
      }
    }
  } catch (e) {
    toast('Fehler: ' + (e && e.message ? e.message : String(e)));
  }
}

/* ─── Event wiring ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', loadAttests);

// Auto-format DOB input
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'attest-dob') {
    autoFormatDob(e.target);
  }
});
