// myhistoree v0.2 — NOSTR-first Anamnese Wizard
const API = '';
const RELAY_URL = window.location.protocol === 'https:' ? 'wss://' + window.location.host + ':7777' : 'ws://' + window.location.host + ':7777';

let keys = null;
let encounterId = null;
let patientId = null;
let currentStep = 0;
let linkToken = null;
let linkData = null;

const screens = [
  'welcome','identity','checkin','language','origin','job','insurance',
  'symptoms','duration','conditions','operations','medications','allergies',
  'family','lifestyle','lifestyle2','emergency','review','done'
];

// ─── Utility ────────────────────────────────────────────────────
function parseTokenFromPath() {
  const m = window.location.pathname.match(/\/anamnese\/([a-f0-9-]{32,})/);
  return m ? m[1] : null;
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token: p.get('token') || parseTokenFromPath()
  };
}

// ─── NOSTR Keys ─────────────────────────────────────────────────
function loadKeys() {
  const raw = localStorage.getItem('myhistoree_keys');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      keys = { sk: new Uint8Array(parsed.sk), npub: parsed.npub };
      return true;
    } catch(e) { console.error('Key parse error', e); }
  }
  return false;
}

function generateKeys() {
  const sk = window.NostrTools.generateSecretKey();
  const pk = window.NostrTools.getPublicKey(sk);
  const npub = window.NostrTools.nip19.npubEncode(pk);
  keys = { sk, npub };
  localStorage.setItem('myhistoree_keys', JSON.stringify({ sk: Array.from(sk), npub }));
  return npub;
}

function showKeys() {
  document.getElementById('key-status').classList.add('hidden');
  document.getElementById('key-info').classList.remove('hidden');
  document.getElementById('display-npub').textContent = keys.npub;
}

// ─── NOSTR Relay ────────────────────────────────────────────────
function publishToRelay(kind, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const pk = window.NostrTools.getPublicKey(keys.sk);
    const event = {
      pubkey: pk,
      created_at: Math.floor(Date.now() / 1000),
      kind,
      tags: linkToken ? [['h', linkToken]] : [],
      content: typeof content === 'string' ? content : JSON.stringify(content)
    };

    event.id = window.NostrTools.getEventHash(event);
    event.sig = window.NostrTools.getSignature(event, keys.sk);

    ws.onopen = () => ws.send(JSON.stringify(["EVENT", event]));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === 'OK') { ws.close(); resolve(msg); }
    };
    ws.onerror = (err) => { ws.close(); reject(err); };
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
  });
}

// ─── Wizard ─────────────────────────────────────────────────────
const wizard = {
  next() {
    if (currentStep < screens.length - 1) {
      currentStep++;
      this.render();
    }
  },
  prev() {
    if (currentStep > 0) {
      currentStep--;
      this.render();
    }
  },
  goTo(name) {
    const idx = screens.indexOf(name);
    if (idx >= 0) { currentStep = idx; this.render(); }
  },
  render() {
    document.querySelectorAll('.screen').forEach((el, i) => {
      el.classList.toggle('active', i === currentStep);
    });
    const pct = Math.round((currentStep / (screens.length - 1)) * 100);
    document.getElementById('progress-fill').style.width = pct + '%';

    if (screens[currentStep] === 'identity') {
      if (keys) { showKeys(); }
      else { setTimeout(() => { generateKeys(); showKeys(); }, 600); }
    }
    if (screens[currentStep] === 'checkin') {
      updateCheckinScreen();
    }
  },
  async saveAndNext(category, collectorFn) {
    const data = collectorFn();
    if (!data) return;
    if (encounterId) {
      try {
        await fetch(`${API}/api/anamnese/${encounterId}/${category}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        // NOSTR auch publizieren (best effort)
        try {
          await publishToRelay(30078, { category, encounterId, ...data });
        } catch(e) { console.log('NOSTR publish optional', e.message); }
      } catch(e) { console.error('Speichern fehlgeschlagen', e); }
    }
    this.next();
  }
};

// ─── Link-Checkin ───────────────────────────────────────────────
function updateCheckinScreen() {
  const praxisInfo = document.getElementById('checkin-praxis-info');
  const tokenDisplay = document.getElementById('checkin-token');
  if (linkData && praxisInfo) {
    praxisInfo.innerHTML = `
      <div class="npub-box"><strong>Praxis:</strong> ${linkData.practiceName || 'Unbekannt'}<br>` +
      (linkData.patientName ? `<strong>Patient:</strong> ${linkData.patientName}` : '') +
      `</div>`;
    if (linkData.patientName) {
      document.getElementById('practice-select').style.display = 'none';
    }
  }
  if (tokenDisplay) tokenDisplay.textContent = (linkToken || '').slice(0, 12) + '…';
}

async function doLinkCheckin() {
  if (!keys) { alert('Bitte warten Sie, bis Ihre Identität erzeugt wurde.'); return; }
  if (!linkToken) { alert('Kein gültiger Einladungslink erkannt.'); return; }

  const btn = document.getElementById('btn-checkin');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird eingecheckt...'; }

  try {
    const res = await fetch(`${API}/api/link/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: linkToken, npub: keys.npub })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Checkin fehlgeschlagen');

    encounterId = json.encounterId;
    patientId = json.patientId;
    sessionStorage.setItem('myhistoree_encounter', encounterId);
    sessionStorage.setItem('myhistoree_patient', patientId);
    sessionStorage.setItem('myhistoree_linkToken', linkToken);

    // NOSTR Event publizieren: "patient X hat sich eingecheckt"
    try {
      await publishToRelay(30078, {
        type: 'checkin',
        token: linkToken,
        encounterId,
        patientId,
        npub: keys.npub
      });
    } catch(e) {}

    wizard.next();
  } catch(e) {
    alert('Checkin fehlgeschlagen: ' + e.message);
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = 'Einchecken'; }
  }
}

async function doClassicCheckin() {
  if (!keys) { alert('Bitte warten Sie, bis Ihre Identität erzeugt wurde.'); return; }
  const practiceId = document.getElementById('practice-select').value;
  try {
    const res = await fetch(`${API}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npub: keys.npub, practiceId })
    });
    const json = await res.json();
    encounterId = json.encounterId;
    patientId = json.patientId;
    wizard.next();
  } catch(e) {
    alert('Checkin fehlgeschlagen. Bitte erneut versuchen.');
    console.error(e);
  }
}

function checkin() {
  if (linkToken && linkData) doLinkCheckin();
  else doClassicCheckin();
}

// ─── Page-Initialisierung ───────────────────────────────────────
async function initPage() {
  const params = getUrlParams();
  linkToken = params.token;

  loadKeys();

  // Session-Rehydration
  const savedEncounter = sessionStorage.getItem('myhistoree_encounter');
  if (savedEncounter) encounterId = savedEncounter;
  const savedPatient = sessionStorage.getItem('myhistoree_patient');
  if (savedPatient) patientId = savedPatient;
  const savedToken = sessionStorage.getItem('myhistoree_linkToken');
  if (savedToken) linkToken = savedToken;

  if (linkToken) {
    try {
      const res = await fetch(`${API}/api/link/validate/${linkToken}`);
      if (res.ok) {
        linkData = await res.json();
        if (linkData.status === 'linked' && !keys) {
          // Patient hat bereits verknüpften npub aber Keys gelöscht -> Warnung
          document.getElementById('welcome-info').innerHTML += `
            <div style="background:#fff3cd;border-left:4px solid #c9a000;padding:12px;margin-top:16px;border-radius:0 8px 8px 0;font-size:0.9rem;">
              ⚠️ Dieser Link wurde bereits verwendet. Falls Sie seit Ihrem letzten Besuch Ihre Browserdaten gelöscht haben, zeigen Sie Ihre Praxis-ID in der Praxis vor.
            </div>`;
        }
      }
    } catch(e) { console.log('Link validation optional', e); }
  }

  initChips('lang-chips');
  initChips('symptom-chips');
  initChips('condition-chips');

  // Review-Hook
  const origNext = wizard.next.bind(wizard);
  wizard.next = function() { origNext(); if (screens[currentStep] === 'review') buildReview(); };

  wizard.render();
}

// ─── Chip Helpers ───────────────────────────────────────────────
function initChips(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const val = chip.dataset.value;
      const noneChip = Array.from(group.querySelectorAll('.chip')).find(c => c.dataset.value === 'keine');
      if (noneChip) {
        if (val === 'keine' && chip.classList.contains('selected')) {
          group.querySelectorAll('.chip').forEach(c => { if (c !== chip) c.classList.remove('selected'); });
        } else if (val !== 'keine' && chip.classList.contains('selected')) {
          noneChip.classList.remove('selected');
        }
      }
    });
  });
}
function getChips(groupId) {
  const group = document.getElementById(groupId);
  return Array.from(group.querySelectorAll('.chip.selected')).map(c => c.dataset.value);
}

// ─── Toggles ────────────────────────────────────────────────────
function toggleOps(show) { document.getElementById('ops-detail').classList.toggle('hidden', !show); }
function toggleMedis(show) { document.getElementById('medis-detail').classList.toggle('hidden', !show); }
function toggleAllergy(type, show) { document.getElementById('allergy-' + type + '-text').classList.toggle('hidden', !show); }

// ─── Collectors ─────────────────────────────────────────────────
function collectDemographics1() {
  const languages = getChips('lang-chips');
  const interpreter = document.querySelector('input[name="interpreter"]:checked')?.value;
  if (!languages.length) { alert('Bitte wählen Sie mindestens eine Sprache.'); return null; }
  return { languages: languages.join(', '), interpreter, __completed: true };
}
function collectDemographics2() {
  const origin = document.querySelector('input[name="origin"]:checked')?.value;
  const familienstand = document.getElementById('familienstand').value;
  if (!origin || !familienstand) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { origin, familienstand, __completed: true };
}
function collectDemographics3() {
  const kinder = document.querySelector('input[name="kinder"]:checked')?.value;
  const bildung = document.getElementById('bildung').value;
  const beruf = document.getElementById('beruf').value;
  if (!kinder || !bildung || !beruf) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { kinder, bildung, beruf, __completed: true };
}
function collectInsurance() {
  const type = document.querySelector('input[name="insurance_type"]:checked')?.value;
  const kvid = document.getElementById('kvid').value.trim();
  if (!type) { alert('Bitte Versicherungsart wählen.'); return null; }
  return { insurance_type: type, kvid: kvid || undefined, __completed: true };
}
function collectSymptoms() {
  const symptoms = getChips('symptom-chips');
  if (!symptoms.length) { alert('Bitte wählen Sie mindestens eine Option.'); return null; }
  return { symptoms: symptoms.join(', '), __completed: true };
}
function collectDuration() {
  const duration = document.querySelector('input[name="duration"]:checked')?.value;
  if (!duration) { alert('Bitte Dauer angeben.'); return null; }
  return { duration, __completed: true };
}
function collectConditions() {
  const conditions = getChips('condition-chips');
  if (!conditions.length) { alert('Bitte wählen Sie mindestens eine Option.'); return null; }
  return { conditions: conditions.join(', '), __completed: true };
}
function collectOperations() {
  const ops = document.querySelector('input[name="ops"]:checked')?.value;
  const detail = document.getElementById('ops-text').value.trim();
  if (!ops) { alert('Bitte auswählen.'); return null; }
  return { operations: ops === 'ja' ? (detail || 'Ja, Details folgen') : 'Nein', __completed: true };
}
function collectMedications() {
  const medis = document.querySelector('input[name="medis"]:checked')?.value;
  const detail = document.getElementById('medis-text').value.trim();
  if (!medis) { alert('Bitte auswählen.'); return null; }
  return { medications: medis === 'ja' ? (detail || 'Ja, Details folgen') : 'Keine', __completed: true };
}
function collectAllergies() {
  const medi = document.querySelector('input[name="allergy_medi"]:checked')?.value;
  const mediText = document.getElementById('allergy-medi-text').value.trim();
  const food = document.querySelector('input[name="allergy_food"]:checked')?.value;
  const foodText = document.getElementById('allergy-food-text').value.trim();
  const other = document.querySelector('input[name="allergy_other"]:checked')?.value;
  const otherText = document.getElementById('allergy-other-text').value.trim();
  if (!medi || !food || !other) { alert('Bitte alle Allergie-Felder ausfüllen.'); return null; }
  return {
    allergy_medications: medi === 'ja' ? (mediText || 'Ja') : 'Nein',
    allergy_food: food === 'ja' ? (foodText || 'Ja') : 'Nein',
    allergy_other: other === 'ja' ? (otherText || 'Ja') : 'Nein',
    __completed: true
  };
}
function collectFamily() {
  const herz = document.querySelector('input[name="fam_herz"]:checked')?.value;
  const diabetes = document.querySelector('input[name="fam_diabetes"]:checked')?.value;
  const krebs = document.querySelector('input[name="fam_krebs"]:checked')?.value;
  const psyche = document.querySelector('input[name="fam_psyche"]:checked')?.value;
  const text = document.getElementById('fam-text').value.trim();
  if (!herz || !diabetes || !krebs || !psyche) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { fam_herz: herz, fam_diabetes: diabetes, fam_krebs: krebs, fam_psyche: psyche, fam_notes: text || undefined, __completed: true };
}
function collectLifestyle1() {
  const raucher = document.querySelector('input[name="raucher"]:checked')?.value;
  const alkohol = document.querySelector('input[name="alkohol"]:checked')?.value;
  if (!raucher || !alkohol) { alert('Bitte auswählen.'); return null; }
  return { raucher, alkohol, __completed: true };
}
function collectLifestyle2() {
  const drogen = document.querySelector('input[name="drogen"]:checked')?.value;
  const schwanger = document.querySelector('input[name="schwanger"]:checked')?.value;
  if (!drogen || !schwanger) { alert('Bitte auswählen.'); return null; }
  return { drogen, schwanger, __completed: true };
}
function collectEmergency() {
  const name = document.getElementById('emergency-name').value.trim();
  const phone = document.getElementById('emergency-phone').value.trim();
  return { emergency_name: name || undefined, emergency_phone: phone || undefined, __completed: true };
}

// ─── Review ─────────────────────────────────────────────────────
async function buildReview() {
  if (!encounterId) return;
  let html = '';
  try {
    const res = await fetch(`${API}/api/encounter/${encounterId}`);
    const data = await res.json();
    const categories = {
      demographics: 'Persönliche Angaben',
      insurance: 'Versicherung',
      history: 'Krankengeschichte',
      medications: 'Medikamente',
      allergies: 'Allergien',
      family: 'Familienanamnese',
      lifestyle: 'Lebensgewohnheiten',
      emergency: 'Notfallkontakt'
    };
    for (const r of data.responses || []) {
      const title = categories[r.category] || r.category;
      const obj = JSON.parse(r.data);
      delete obj.__completed;
      const rows = Object.entries(obj).map(([k,v]) => {
        const label = k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
        return `<div><strong>${label}:</strong> <span style="color:#334155">${v}</span></div>`;
      }).join('');
      html += `<div class="review-block"><h3>${title}</h3>${rows}</div>`;
    }
  } catch(e) { html = '<p>Fehler beim Laden der Zusammenfassung.</p>'; }
  document.getElementById('review-content').innerHTML = html || '<p>Noch keine Daten erfasst.</p>';
}

async function submitFinal() {
  if (!encounterId || !keys) return;
  try {
    // Submit als abgeschlossen markieren
    await fetch(`${API}/api/anamnese/${encounterId}/__final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ __completed: true, submitted_at: new Date().toISOString() })
    });
  } catch(e) {}

  // NOSTR Final-Event
  try {
    await publishToRelay(30078, {
      type: 'anamnese_complete',
      encounterId,
      npub: keys.npub,
      completed: true
    });
  } catch(e) {}

  document.getElementById('done-npub').textContent = keys.npub;
  wizard.next();
}

// ─── Start ──────────────────────────────────────────────────────
initPage();
