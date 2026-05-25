// myhistoree Admin Dashboard JS
const API = '/api';
const CURRENT_PRACTICE = 'demo-practice';

// ─── Tab Switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));

  if (tab === 'links') loadLinks();
  if (tab === 'patients') loadPatients();
  if (tab === 'encounters') loadEncounters();
}

// ─── Link erstellen ─────────────────────────────────────────────
async function createLink() {
  const name = document.getElementById('new-patient-name').value.trim();
  const email = document.getElementById('new-patient-email').value.trim();
  const expiry = parseInt(document.getElementById('new-expiry').value);
  const btn = document.getElementById('btn-create');

  btn.disabled = true;
  btn.textContent = 'Wird erstellt...';

  try {
    const res = await fetch(`${API}/link/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: CURRENT_PRACTICE, patientName: name, patientEmail: email, expiresHours: expiry })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    const baseUrl = window.location.origin.replace('/admin', '');
    const fullUrl = `${baseUrl}/anamnese/${data.token}`;

    document.getElementById('link-result').innerHTML = `
      <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:16px;">
        <div style="font-weight:600;color:#166534;margin-bottom:8px;">✅ Link erfolgreich erstellt!</div>
        <div style="font-size:0.85rem;color:#64748b;margin-bottom:4px;">Patientenname: ${name || '(kein Name)'}</div>
        <div style="font-size:0.85rem;color:#64748b;margin-bottom:8px;">Gültig bis: ${new Date(data.expiresAt).toLocaleString('de-DE')}</div>
        <div class="url-box" id="link-url">${fullUrl}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-sm" onclick="copyLink()">📋 Kopieren</button>
          <button class="btn btn-sm btn-success" onclick="window.open('${fullUrl}', '_blank')">🔗 Öffnen</button>
        </div>
      </div>
    `;
    document.getElementById('link-result').style.display = 'block';
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
          <tr><th>Token</th><th>Patient</th><th>Npub</th><th>Status</th><th>Erstellt</th><th>Gültig bis</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'linked' ? 'badge-linked' : r.status === 'expired' ? 'badge-expired' : 'badge-pending';
            const npubShort = r.linked_npub ? r.linked_npub.slice(0, 16) + '…' : '—';
            const baseUrl = window.location.origin.replace('/admin', '');
            const linkUrl = `${baseUrl}/anamnese/${r.token}`;
            return `<tr>
              <td><code style="font-size:0.8rem;">${r.token.slice(0, 12)}…</code></td>
              <td>${r.patient_name || '—'}</td>
              <td>${npubShort}</td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE')}</td>
              <td>${new Date(r.expires_at).toLocaleDateString('de-DE')}</td>
              <td>
                <button class="btn btn-sm" onclick="showLinkDetail('${r.token}', '${linkUrl}', '${r.patient_name || ''}')">Detail</button>
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

function showLinkDetail(token, url, name) {
  showModal('Link Detail', `
    <p><strong>Patient:</strong> ${name || '—'}</p>
    <p><strong>Token:</strong> <code>${token}</code></p>
    <p><strong>URL:</strong></p>
    <div class="url-box">${url}</div>
    <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${url}')">📋 Kopieren</button>
    <button class="btn btn-sm btn-success" onclick="window.open('${url}', '_blank')">🔗 Öffnen</button>
  `);
}

// ─── Patients laden ─────────────────────────────────────────────
async function loadPatients() {
  const container = document.getElementById('patients-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/patients`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Patienten registriert</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Npub</th><th>Erstellt</th><th>Encounters</th><th>Letzte Aktivität</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><code style="font-size:0.8rem;">${r.npub.slice(0, 20)}…</code></td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE')}</td>
              <td>${r.encounter_count || 0}</td>
              <td>${r.last_activity ? new Date(r.last_activity).toLocaleDateString('de-DE') : '—'}</td>
              <td><button class="btn btn-sm" onclick="openFhir('${r.npub}')">FHIR</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

function openFhir(npub) {
  window.open(`${API}/fhir/patient/${encodeURIComponent(npub)}`, '_blank');
}

// ─── Encounters laden ───────────────────────────────────────────
async function loadEncounters() {
  const container = document.getElementById('encounters-table-container');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch(`${API}/encounters/list/${CURRENT_PRACTICE}`);
    const rows = await res.json();

    if (!rows.length) { container.innerHTML = '<div class="empty">Noch keine Encounters</div>'; return; }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>ID</th><th>Patient (Npub)</th><th>Status</th><th>Link-Token</th><th>Erstellt</th><th>Aktion</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const statusClass = r.status === 'completed' ? 'badge-completed' : 'badge-inprogress';
            const npubShort = r.npub ? r.npub.slice(0, 16) + '…' : '—';
            return `<tr>
              <td><code style="font-size:0.8rem;">${r.id.slice(0, 8)}…</code></td>
              <td>${npubShort}</td>
              <td><span class="badge ${statusClass}">${r.status}</span></td>
              <td>${r.source_link_id ? r.source_link_id.slice(0, 8) + '…' : '—'}</td>
              <td>${new Date(r.created_at).toLocaleDateString('de-DE')}</td>
              <td>
                <button class="btn btn-sm" onclick="viewEncounter('${r.id}')">Ansehen</button>
                <button class="btn btn-sm btn-success" onclick="viewFhir('${r.id}')">FHIR</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}

async function viewEncounter(encounterId) {
  try {
    const res = await fetch(`${API}/encounter/${encounterId}`);
    const data = await res.json();
    const categories = {
      demographics: 'Persönliche Angaben', insurance: 'Versicherung', history: 'Krankengeschichte',
      medications: 'Medikamente', allergies: 'Allergien', family: 'Familienanamnese',
      lifestyle: 'Lebensgewohnheiten', emergency: 'Notfallkontakt'
    };
    let html = '';
    for (const r of data.responses || []) {
      const obj = JSON.parse(r.data);
      delete obj.__completed;
      const rows = Object.entries(obj).map(([k,v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('');
      html += `<div style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;"><h4>${categories[r.category] || r.category}</h4>${rows}</div>`;
    }
    if (!html) html = '<p>Keine Antworten vorhanden.</p>';
    showModal(`Encounter ${encounterId.slice(0, 8)}…`, html);
  } catch(e) {
    alert('Fehler: ' + e.message);
  }
}

function viewFhir(encounterId) {
  window.open(`${API}/anamnese/${encounterId}/fhir`, '_blank');
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
