// myhistoree v0.2 — NOSTR-first Anamnese Wizard
const API = '';
const RELAY_URL = window.location.protocol === 'https:' ? 'wss://' + window.location.host + ':7777' : 'ws://' + window.location.host + ':7777';

let keys = null;
let encounterId = null;
let patientId = null;
let currentStep = 0;
let linkToken = null;
let linkData = null;
let checkinMode = 'full'; // 'full' = Erstbesuch, 'quick' = Self-Checkin

const fullScreens = [
  'welcome','identity','checkin','language','origin','job','insurance',
  'symptoms','duration','conditions','operations','medications','allergies',
  'family','lifestyle','lifestyle2','emergency','review','done'
];

const quickScreens = [
  'welcome','quick-checkin','quick-complaints','quick-appointment','quick-done'
];

let screens = fullScreens;

// ─── Utility ────────────────────────────────────────────────────
function parseTokenFromPath() {
  const m = window.location.pathname.match(/\/anamnese\/([a-f0-9-]{32,})/);
  return m ? m[1] : null;
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token: p.get('token') || parseTokenFromPath(),
    source: p.get('source') || ''
  };
}

// ─── Storage Helpers (robust für iOS/Safari In-App-Browser) ────
const STORAGE_KEY = 'myhistoree_keys';

function storageSet(data) {
  const json = JSON.stringify(data);
  try { localStorage.setItem(STORAGE_KEY, json); } catch(e) {}
  try { sessionStorage.setItem(STORAGE_KEY, json); } catch(e) {}
}

function storageGet() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch(e) {}
  if (!raw) {
    try { raw = sessionStorage.getItem(STORAGE_KEY); } catch(e) {}
  }
  return raw;
}

function storageClear() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  try { sessionStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

// ─── NOSTR Keys ─────────────────────────────────────────────────
function loadKeys() {
  const raw = storageGet();
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
  storageSet({ sk: Array.from(sk), npub });
  return npub;
}

function restoreKeys(npubInput) {
  // Erlaubt Wiederherstellung via npub (z.B. vom Arzt ausgelesen)
  const npub = npubInput.trim();
  if (!npub.startsWith('npub1')) return false;
  // Wir können den privaten Key nicht aus npub rekonstruieren,
  // aber wir können einen neuen generieren und den npub als Alias speichern.
  // Für echte Wiederherstellung bräuchten wir nsec – das ist hier bewusst nicht implementiert.
  // Stattdessen: Wir zeigen eine Info, dass der alte nsec benötigt wird.
  return false;
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
    document.querySelectorAll('.screen').forEach((el) => {
      el.classList.remove('active');
    });
    const currentScreen = screens[currentStep];
    const el = document.getElementById('screen-' + currentScreen);
    if (el) el.classList.add('active');

    const pct = Math.round((currentStep / (screens.length - 1)) * 100);
    document.getElementById('progress-fill').style.width = pct + '%';

    if (currentScreen === 'identity') {
      if (keys) { showKeys(); }
      else { setTimeout(() => { generateKeys(); showKeys(); }, 600); }
    }
    if (currentScreen === 'checkin') {
      updateCheckinScreen();
    }
    if (currentScreen === 'quick-checkin') {
      updateQuickCheckinScreen();
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
  const verifyForm = document.getElementById('link-verify-form');
  const pinGroup = document.getElementById('verify-pin-group');
  const errorBanner = document.getElementById('checkin-error');
  const btn = document.getElementById('btn-checkin');

  if (linkData && praxisInfo) {
    praxisInfo.innerHTML = `
      <div class="npub-box"><strong>Praxis:</strong> ${linkData.practiceName || 'Unbekannt'}<br>` +
      (linkData.pvsPatientId ? `<strong>Patienten-ID:</strong> ${linkData.pvsPatientId}` : '') +
      `</div>`;
    if (linkData.pvsPatientId) {
      document.getElementById('practice-select').style.display = 'none';
    }

    // Harte Blockade: Link bereits verwendet
    if (linkData.linkedNpub) {
      errorBanner.style.display = 'block';
      errorBanner.innerHTML = '❌ Dieser Link wurde bereits verwendet. Bitte wenden Sie sich an Ihre Praxis, um einen neuen Link zu erhalten.';
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'Link bereits verwendet'; }
      if (verifyForm) verifyForm.style.display = 'none';
      return;
    }

    // Verifizierungsformular anzeigen
    if (verifyForm) {
      verifyForm.style.display = 'block';
      if (pinGroup && linkData.requiresPin) {
        pinGroup.style.display = 'block';
      }
    }
  }
  if (tokenDisplay) tokenDisplay.textContent = (linkToken || '').slice(0, 12) + '…';
}

async function doLinkCheckin() {
  if (!keys) { alert('Bitte warten Sie, bis Ihre Identität erzeugt wurde.'); return; }
  if (!linkToken) { alert('Kein gültiger Einladungslink erkannt.'); return; }

  const dob = document.getElementById('verify-dob')?.value;
  const pin = document.getElementById('verify-pin')?.value;

  if (!dob) { alert('Bitte geben Sie Ihr Geburtsdatum ein.'); return; }
  if (linkData?.requiresPin && !pin) { alert('Bitte geben Sie die PIN ein.'); return; }

  const btn = document.getElementById('btn-checkin');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird eingecheckt...'; }

  try {
    const res = await fetch(`${API}/api/link/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: linkToken, npub: keys.npub, patientDob: dob, pin: pin || undefined })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Checkin fehlgeschlagen');

    encounterId = json.encounterId;
    patientId = json.patientId;
    sessionStorage.setItem('myhistoree_encounter', encounterId);
    sessionStorage.setItem('myhistoree_patient', patientId);
    sessionStorage.setItem('myhistoree_linkToken', linkToken);

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


// ─── QR Landing Flow ────────────────────────────────────────────
let isQrScan = false;

function isInAppBrowser() {
  const ua = navigator.userAgent;
  // Detect common in-app browsers
  if (/Instagram|FBAN|FBAV|Twitter|LinkedIn|Line|WeChat/i.test(ua)) return true;
  // iOS: check if Safari standalone AND not added to home screen
  if (/iPhone|iPad|iPod/.test(ua)) {
    // navigator.standalone is true only when launched from home screen (PWA)
    return !window.navigator.standalone;
  }
  return false;
}

function showLandingPage() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-qr-landing').classList.add('active');
  
  const knownDiv = document.getElementById('qr-landing-known');
  const newDiv = document.getElementById('qr-landing-new');
  
  if (!knownDiv || !newDiv) return;
  
  if (keys) {
    knownDiv.style.display = 'block';
    newDiv.style.display = 'none';
    document.getElementById('landing-npub').textContent = keys.npub.slice(0, 30) + '…';
  } else {
    knownDiv.style.display = 'none';
    newDiv.style.display = 'block';
  }
}

function startQuickFlowFromLanding() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  startQuickFlow();
}

function startFullFlowFromLanding() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  startFullFlow();
}

function continueInAppBrowser() {
  // In-App-Browser: Keys existieren hier isoliert
  if (!keys) {
    generateKeys();
  }
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  // Direkt zum Quick-Checkin (nicht über Welcome-Screen)
  screens = quickScreens;
  currentStep = screens.indexOf('quick-checkin');
  wizard.render();
}

// ─── Page-Initialisierung ───────────────────────────────────────
async function initPage() {
  const params = getUrlParams();
  linkToken = params.token;
  isQrScan = params.source === 'qr';
  const isPwaStart = params.source === 'pwa' || window.navigator.standalone === true;

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
      }
    } catch(e) { console.log('Link validation optional', e); }
  }

  initChips('lang-chips');
  initChips('symptom-chips');
  initChips('condition-chips');
  initChips('quick-symptom-chips');

  // Review-Hook
  const origNext = wizard.next.bind(wizard);
  wizard.next = function() { origNext(); if (screens[currentStep] === 'review') buildReview(); };

  // Determine starting screen
  if (isQrScan && !linkToken) {
    // QR code scan without token - show landing page
    showLandingPage();
  } else if (isPwaStart) {
    // PWA launched from home screen - go directly to checkin
    if (keys) {
      startQuickFlow();
    } else {
      wizard.render();
    }
  } else {
    wizard.render();
  }
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
  if (!group) return [];
  return Array.from(group.querySelectorAll('.chip.selected')).map(c => c.dataset.value);
}

// ─── Mode Selection ─────────────────────────────────────────────
function selectMode(mode) {
  checkinMode = mode;
  if (mode === 'quick') {
    screens = quickScreens;
    // Reload keys – auf iOS/Safari können sie zwischenzeitlich verloren gehen
    if (!keys) loadKeys();
    const hasKeys = !!keys;
    document.getElementById('welcome-info').innerHTML = `
      <h3>Self-Checkin</h3>
      <p>Sie checken sich als bestehender Patient ein. Dies geht schnell – nur wenige Angaben nötig.</p>
      ${hasKeys ? `<p style="margin-top:8px;font-size:0.85rem;color:var(--text-light);">Ihre Praxis-ID ist auf diesem Gerät gespeichert: <code>${keys.npub.slice(0,30)}…</code></p>` : '<p style="margin-top:8px;font-size:0.85rem;color:var(--text-light);">Ihre anonyme Praxis-ID wird beim ersten Besuch erzeugt und auf diesem Gerät gespeichert.</p>'}
      <button class="btn-primary" onclick="startQuickFlow()" style="margin-top:16px">Weiter zum Checkin</button>
    `;
  } else {
    screens = fullScreens;
    document.getElementById('welcome-info').innerHTML = `
      <h3>Erstbesuch</h3>
      <p>Für Ihren ersten Besuch benötigen wir eine ausführliche Anamnese. Sie wurden vermutlich mit einem Einladungslink hierher geleitet.</p>
      <p style="margin-top:8px;font-size:0.9rem;color:var(--text-light);">Falls Sie keinen Link haben, melden Sie sich bitte am Empfang.</p>
      <button class="btn-primary" onclick="startFullFlow()" style="margin-top:16px">Anamnese starten</button>
    `;
  }
}

function startQuickFlow() {
  // Double-check: keys könnten zwischenzeitlich (z.B. bei iOS In-App-Browser Preview) verloren gegangen sein
  if (!keys) { loadKeys(); }

  if (keys) {
    // Keys bereits vorhanden – überspringe den identity-Schritt komplett
    currentStep = screens.indexOf('quick-checkin');
  } else {
    // Erster Besuch auf diesem Gerät/Browser – generiere Keys
    generateKeys();
    currentStep = screens.indexOf('quick-checkin');
  }
  wizard.render();
}

function startFullFlow() {
  if (keys) {
    currentStep = screens.indexOf('checkin');
  } else {
    currentStep = screens.indexOf('identity');
  }
  wizard.render();
}

// ─── Quick Checkin ──────────────────────────────────────────────
function updateQuickCheckinScreen() {
  const info = document.getElementById('quick-checkin-info');
  if (!info) return;
  // Reload keys – auf iOS/Safari können sie zwischenzeitlich verloren gehen
  if (!keys) loadKeys();

  if (keys) {
    info.innerHTML = `
      <div class="npub-box"><strong>Ihre Praxis-ID:</strong> <code>${keys.npub.slice(0, 30)}…</code></div>
      <p style="font-size:0.85rem;color:var(--text-light);margin-top:8px;">
        Diese anonyme ID ist auf diesem Gerät gespeichert. Ihre Praxis kann Sie damit wiedererkennen.
      </p>
    `;
    document.getElementById('btn-quick-checkin').style.display = 'block';
  } else {
    info.innerHTML = `<p>Ihre anonyme ID wird erzeugt...</p>`;
    setTimeout(() => {
      generateKeys();
      updateQuickCheckinScreen();
    }, 500);
  }
}

async function doQuickCheckin() {
  if (!keys) { alert('Bitte warten, Identität wird erzeugt...'); return; }
  const practiceId = document.getElementById('quick-practice-select')?.value || 'demo-practice';

  try {
    const res = await fetch(`${API}/api/checkin/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ npub: keys.npub, practiceId })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Checkin fehlgeschlagen');

    encounterId = json.encounterId;
    patientId = json.patientId;
    sessionStorage.setItem('myhistoree_encounter', encounterId);
    sessionStorage.setItem('myhistoree_patient', patientId);

    wizard.next();
  } catch(e) {
    alert('Checkin fehlgeschlagen: ' + e.message);
  }
}

function collectQuickComplaints() {
  const symptoms = getChips('quick-symptom-chips');
  const freitext = document.getElementById('quick-freitext')?.value.trim();
  if (!symptoms.length && !freitext) { alert('Bitte wählen Sie mindestens eine Beschwerde oder beschreiben Sie diese im Freitext.'); return null; }
  return { complaints: symptoms.join(', '), freitext, __completed: true };
}

function collectQuickAppointment() {
  const hasAppt = document.querySelector('input[name="quick-appointment"]:checked')?.value;
  const time = document.getElementById('quick-appt-time')?.value;
  if (!hasAppt) { alert('Bitte angeben, ob Sie einen Termin haben.'); return null; }
  return { hasAppointment: hasAppt === 'ja', appointmentTime: time || '', __completed: true };
}

async function submitQuickCheckin() {
  if (!encounterId || !keys) return;
  document.getElementById('quick-done-npub').textContent = keys.npub;
  wizard.next();
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
  if (!medi || !food || !other) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return {
    allergy_medication: medi === 'ja' ? (mediText || 'Ja') : 'Nein',
    allergy_food: food === 'ja' ? (foodText || 'Ja') : 'Nein',
    allergy_other: other === 'ja' ? (otherText || 'Ja') : 'Nein',
    __completed: true
  };
}
function collectFamily() {
  const herz = document.querySelector('input[name="fam_herz"]:checked')?.value;
  const diabetes = document.querySelector('input[name="fam_diabetes"]:checked')?.value;
  const krebs = document.querySelector('input[name="fam_krebs"]:checked')?.value;
  const psych = document.querySelector('input[name="fam_psych"]:checked')?.value;
  if (!herz || !diabetes || !krebs || !psych) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { fam_herz: herz, fam_diabetes: diabetes, fam_krebs: krebs, fam_psych: psych, __completed: true };
}
function collectLifestyle1() {
  const rauchen = document.querySelector('input[name="rauchen"]:checked')?.value;
  const alkohol = document.getElementById('alkohol').value;
  const sport = document.querySelector('input[name="sport"]:checked')?.value;
  if (!rauchen || !alkohol || !sport) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { rauchen, alkohol, sport, __completed: true };
}
function collectLifestyle2() {
  const ernaehrung = document.getElementById('ernaehrung').value;
  const schlaf = document.getElementById('schlaf').value;
  const stress = document.querySelector('input[name="stress"]:checked')?.value;
  if (!ernaehrung || !schlaf || !stress) { alert('Bitte alle Felder ausfüllen.'); return null; }
  return { ernaehrung, schlaf, stress, __completed: true };
}
function collectEmergency() {
  const name = document.getElementById('ename').value.trim();
  const phone = document.getElementById('ephone').value.trim();
  if (!name || !phone) { alert('Bitte Name und Telefonnummer eingeben.'); return null; }
  return { emergency_name: name, emergency_phone: phone, __completed: true };
}

// ─── Review ─────────────────────────────────────────────────────
function buildReview() {
  const items = [
    { label: 'Sprachen', cat: 'language' },
    { label: 'Herkunft / Familienstand', cat: 'origin' },
    { label: 'Kinder / Bildung / Beruf', cat: 'job' },
    { label: 'Versicherung', cat: 'insurance' },
    { label: 'Beschwerden', cat: 'symptoms' },
    { label: 'Dauer', cat: 'duration' },
    { label: 'Vorerkrankungen', cat: 'conditions' },
    { label: 'Operationen', cat: 'operations' },
    { label: 'Medikamente', cat: 'medications' },
    { label: 'Allergien', cat: 'allergies' },
    { label: 'Familienanamnese', cat: 'family' },
    { label: 'Lebensgewohnheiten (1)', cat: 'lifestyle1' },
    { label: 'Lebensgewohnheiten (2)', cat: 'lifestyle2' },
    { label: 'Notfallkontakt', cat: 'emergency' }
  ];

  let html = '';
  let complete = 0;
  let total = items.length;

  items.forEach(it => {
    const stored = sessionStorage.getItem('myhistoree_' + it.cat);
    if (stored) {
      complete++;
      let val = stored;
      try { val = JSON.stringify(JSON.parse(stored)); } catch(e) {}
      html += `<div class="review-item"><strong>${it.label}</strong><pre>${val.length > 300 ? val.slice(0,300)+'...' : val}</pre></div>`;
    } else {
      html += `<div class="review-item missing"><strong>${it.label}</strong> — Noch nicht ausgefüllt</div>`;
    }
  });

  html += `<div style="margin-top:12px;padding:10px;background:#dbeafe;border-radius:8px;font-size:0.9rem;">${complete}/${total} Abschnitte ausgefüllt</div>`;
  document.getElementById('review-content').innerHTML = html;
}

async function submitFinal() {
  if (!encounterId) { alert('Kein Encounter. Bitte erneut einchecken.'); return; }

  const categories = ['language','origin','job','insurance','symptoms','duration','conditions','operations','medications','allergies','family','lifestyle1','lifestyle2','emergency'];
  let saved = 0;

  for (const cat of categories) {
    const raw = sessionStorage.getItem('myhistoree_' + cat);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        await fetch(`${API}/api/anamnese/${encounterId}/${cat}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        try { await publishToRelay(30078, { category: cat, encounterId, ...data }); } catch(e) {}
        saved++;
      } catch(e) { console.error('Save failed for', cat, e); }
    }
  }

  document.getElementById('done-npub').textContent = keys.npub;
  wizard.goTo('done');
}

// Init
initPage();
