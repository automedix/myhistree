// myhistoree v0.5.1 – Online Anamnese
const API = "";

let encounterId = null;
let patientId = null;
let currentStep = 0;
let linkToken = null;
let linkData = null;

// SCREENS ARRAY – Reihenfolge entscheidet!
const screens = [
  "verify",
  "language",
  "origin",
  "family_status",
  "children",
  "job",
  "insurance",
  "symptoms",
  "duration",
  "conditions",
  "operations",
  "meds_bloodthin",
  "meds_bp",
  "meds_asthma",
  "meds_diabetes",
  "meds_neuro",
  "meds_pain",
  "meds_gynuro",
  "meds_chol",
  "meds_other",
  "allergies",
  "family",
  "lifestyle",
  "lifestyle2",
  "emergency",
  "bodymetrics",
  "contact",
  "review",
  "done"
];

// ─── Utility ────────────────────────────────────────────────────
function parseTokenFromPath() {
  const m = window.location.pathname.match(/\/anamnese\/([a-f0-9-]{32,})/);
  return m ? m[1] : null;
}
function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return { token: p.get("token") || parseTokenFromPath() };
}
function showError(msg) {
  const el = document.getElementById("verify-error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}
function hideError() {
  const el = document.getElementById("verify-error");
  if (el) el.style.display = "none";
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
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    const currentScreen = screens[currentStep];
    const el = document.getElementById("screen-" + currentScreen);
    if (el) el.classList.add("active");
    // Dynamic children screen: rebuild based on kid count from family_status
    if (currentScreen === "children") buildChildrenScreen();
    const pct = Math.round((currentStep / (screens.length - 1)) * 100);
    document.getElementById("progress-fill").style.width = pct + "%";
    if (currentScreen === "review") buildReview();
  },
  async saveAndNext(category, collectorFn) {
    const data = collectorFn();
    if (data === null) { this.next(); return; }            // skipped
    if (data === undefined) return;                         // validation error, stay
    // Persist to backend
    if (encounterId) {
      try {
        await fetch(`${API}/api/anamnese/${encounterId}/${category}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
      } catch(e) { console.error("Speichern fehlgeschlagen", e); }
    }
    sessionStorage.setItem("myhistoree_" + category, JSON.stringify(data));
    this.next();
  }
};

// ─── Verification ───────────────────────────────────────────────
async function verifyAndStart() {
  hideError();
  const dob = document.getElementById("verify-dob")?.value;
  const pin = document.getElementById("verify-pin")?.value;
  if (!dob) { showError("Bitte geben Sie Ihr Geburtsdatum ein."); return; }
  if (linkData?.requiresPin && !pin) { showError("Bitte geben Sie die PIN ein."); return; }
  const btn = document.getElementById("btn-verify");
  if (btn) { btn.disabled = true; btn.textContent = "Wird überprüft..."; }
  try {
    const res = await fetch(`${API}/api/link/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: linkToken, patientDob: dob, pin: pin || undefined })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Verifizierung fehlgeschlagen");
    encounterId = json.encounterId;
    patientId = json.patientId;
    document.getElementById("screen-verify").classList.remove("active");
    currentStep = 1;
    wizard.render();
  } catch(e) {
    showError(e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Anamnese starten"; }
  }
}

// ─── Page Init ──────────────────────────────────────────────────
async function initPage() {
  const params = getUrlParams();
  linkToken = params.token;
  if (!linkToken) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui;"><h2>Kein gültiger Link</h2><p>Bitte verwenden Sie den Link, den Sie von Ihrer Praxis erhalten haben.</p></div>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/link/validate/${linkToken}`);
    if (!res.ok) {
      const err = await res.json();
      document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui;"><h2>Link ungültig</h2><p>${err.error || "Dieser Link ist abgelaufen oder bereits verwendet."}</p></div>`;
      return;
    }
    linkData = await res.json();
    const info = document.getElementById("verify-info");
    if (info) {
      info.innerHTML = `<div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:12px;margin-bottom:16px;">
        <strong>Praxis:</strong> ${linkData.practiceName || "Hausärzte im Grillepark"}<br>
        ${linkData.pvsPatientId ? `<strong>Patienten-ID:</strong> ${linkData.pvsPatientId}<br>` : ""}
        ${linkData.patientEmail ? `<strong>E-Mail:</strong> ${linkData.patientEmail}<br>` : ""}
      </div>`;
    }
    if (linkData.requiresPin) {
      document.getElementById("verify-pin-group").style.display = "block";
    }
  } catch(e) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui;"><h2>Fehler</h2><p>Der Link konnte nicht überprüft werden. Bitte versuchen Sie es später erneut.</p></div>`;
    return;
  }
  initChips("lang-chips");
  initChips("symptom-chips");
  initChips("condition-chips");
  initChips("bloodthin-chips");
  initChips("bp-chips");
  initChips("asthma-chips");
  initChips("diabetes-chips");
  initChips("neuro-chips");
  initChips("pain-chips");
  initChips("gynuro-chips");
  initChips("chol-chips");
  wizard.render();
}

// ─── Chip Helpers ───────────────────────────────────────────────
function initChips(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      const val = chip.dataset.value;
      const noneChip = Array.from(group.querySelectorAll(".chip")).find(c => c.dataset.value === "keine");
      if (noneChip) {
        if (val === "keine" && chip.classList.contains("selected")) {
          group.querySelectorAll(".chip").forEach(c => { if (c !== chip) c.classList.remove("selected"); });
        } else if (val !== "keine" && chip.classList.contains("selected")) {
          noneChip.classList.remove("selected");
        }
      }
    });
  });
}
function getChips(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return [];
  return Array.from(group.querySelectorAll(".chip.selected")).map(c => c.dataset.value);
}

// ─── Toggles ────────────────────────────────────────────────────
function toggleOps(show) { document.getElementById("ops-detail").classList.toggle("hidden", !show); }
function toggleAllergy(type, show) { document.getElementById("allergy-" + type + "-text").classList.toggle("hidden", !show); }

// ─── Dynamic Children Screen Builder ────────────────────────────
function buildChildrenScreen() {
  const saved = sessionStorage.getItem("myhistoree_family_status");
  let kinderAnzahl = 0;
  if (saved) { try { kinderAnzahl = JSON.parse(saved).kinder || 0; } catch(e){} }
  const container = document.getElementById("children-container");
  if (!container) return;
  let html = "";
  if (kinderAnzahl == 0) {
    html = `<p style="color:var(--text-light);text-align:center;">Keine Kinder angegeben. Sie können diese Seite überspringen.</p>`;
  } else {
    const jetzt = new Date().getFullYear();
    for (let i = 1; i <= kinderAnzahl; i++) {
      html += `<div class="form-group">
        <label>Geburtsjahr Kind ${i}</label>
        <select id="child-year-${i}">
          <option value="">Bitte wählen</option>`;
      for (let y = jetzt - 1; y >= jetzt - 80; y--) {
        html += `<option value="${y}">${y}</option>`;
      }
      html += `</select></div>`;
    }
  }
  container.innerHTML = html;
}

// ─── Collectors ─────────────────────────────────────────────────
function collectLanguage() {
  const languages = getChips("lang-chips");
  const interpreter = document.querySelector('input[name="interpreter"]:checked')?.value;
  if (!languages.length) { alert("Bitte wählen Sie mindestens eine Sprache."); return undefined; }
  return { languages: languages.join(", "), interpreter, __completed: true };
}

function collectOrigin() {
  const heimatland = document.getElementById("heimatland").value;
  const staatsangehoerigkeit = document.getElementById("staatsangehoerigkeit").value;
  if (!heimatland) { alert("Bitte wählen Sie Ihr Heimatland."); return undefined; }
  if (!staatsangehoerigkeit) { alert("Bitte wählen Sie Ihre Staatsangehörigkeit."); return undefined; }
  return { heimatland, staatsangehoerigkeit, __completed: true };
}

function collectFamilyStatus() {
  const familienstand = document.getElementById("familienstand").value;
  const kinder = document.querySelector('input[name="kinder"]:checked')?.value;
  if (!familienstand) { alert("Bitte Familienstand angeben."); return undefined; }
  if (!kinder) { alert("Bitte angeben, ob Sie Kinder haben."); return undefined; }
  return { familienstand, kinder, __completed: true };
}

function collectChildren() {
  const saved = sessionStorage.getItem("myhistoree_family_status");
  let kinderAnzahl = 0;
  if (saved) { try { kinderAnzahl = JSON.parse(saved).kinder || 0; } catch(e){} }
  if (kinderAnzahl == 0) return null; // skipped
  const children = [];
  for (let i = 1; i <= kinderAnzahl; i++) {
    const y = document.getElementById(`child-year-${i}`)?.value;
    children.push({ index: i, year: y || null });
  }
  const hasEmpty = children.some(c => !c.year);
  if (hasEmpty) { alert("Bitte geben Sie für jedes Kind ein Geburtsjahr an oder überspringen Sie diesen Schritt."); return undefined; }
  return { children, __completed: true };
}

function collectJob() {
  const bildung = document.getElementById("bildung").value;
  const berufsausbildung = document.getElementById("berufsausbildung").value.trim();
  const taetigkeit = document.getElementById("taetigkeit").value.trim();
  const situation = document.getElementById("berufssituation").value;
  if (!bildung) { alert("Bitte höchsten Bildungsabschluss angeben."); return undefined; }
  if (!situation) { alert("Bitte aktuelle berufliche Situation angeben."); return undefined; }
  return { bildung, berufsausbildung: berufsausbildung || undefined, taetigkeit: taetigkeit || undefined, situation, __completed: true };
}

function collectInsurance() {
  const type = document.querySelector('input[name="insurance_type"]:checked')?.value;
  const kvid = document.getElementById("kvid").value.trim();
  if (!type) { alert("Bitte Versicherungsart wählen."); return undefined; }
  return { insurance_type: type, kvid: kvid || undefined, __completed: true };
}

function collectSymptoms() {
  const symptoms = getChips("symptom-chips");
  if (!symptoms.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  return { symptoms: symptoms.join(", "), __completed: true };
}

function collectDuration() {
  const duration = document.querySelector('input[name="duration"]:checked')?.value;
  if (!duration) { alert("Bitte Dauer angeben."); return undefined; }
  return { duration, __completed: true };
}

function collectConditions() {
  const conditions = getChips("condition-chips");
  if (!conditions.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  return { conditions: conditions.join(", "), __completed: true };
}

function collectOperations() {
  const ops = document.querySelector('input[name="ops"]:checked')?.value;
  const detail = document.getElementById("ops-text").value.trim();
  if (!ops) { alert("Bitte auswählen."); return undefined; }
  return { operations: ops === "ja" ? (detail || "Ja, Details folgen") : "Nein", __completed: true };
}

function collectMedsBloodthin() {
  const meds = getChips("bloodthin-chips");
  const detail = document.getElementById("bloodthin-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_bloodthin: "Keine", __completed: true };
  return { meds_bloodthin: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsBP() {
  const meds = getChips("bp-chips");
  const detail = document.getElementById("bp-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_bp: "Keine", __completed: true };
  return { meds_bp: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsAsthma() {
  const meds = getChips("asthma-chips");
  const detail = document.getElementById("asthma-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_asthma: "Keine", __completed: true };
  return { meds_asthma: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsDiabetes() {
  const meds = getChips("diabetes-chips");
  const detail = document.getElementById("diabetes-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_diabetes: "Keine", __completed: true };
  return { meds_diabetes: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsNeuro() {
  const meds = getChips("neuro-chips");
  const detail = document.getElementById("neuro-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_neuro: "Keine", __completed: true };
  return { meds_neuro: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsPain() {
  const meds = getChips("pain-chips");
  const detail = document.getElementById("pain-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_pain: "Keine", __completed: true };
  return { meds_pain: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsGynUro() {
  const meds = getChips("gynuro-chips");
  const detail = document.getElementById("gynuro-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_gynuro: "Keine", __completed: true };
  return { meds_gynuro: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsChol() {
  const meds = getChips("chol-chips");
  const detail = document.getElementById("chol-text").value.trim();
  if (!meds.length) { alert("Bitte wählen Sie mindestens eine Option."); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_chol: "Keine", __completed: true };
  return { meds_chol: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsOther() {
  const detail = document.getElementById("other-meds-text").value.trim();
  return { meds_other: detail || "Keine", __completed: true };
}

function collectAllergies() {
  const medi = document.querySelector('input[name="allergy_medi"]:checked')?.value;
  const mediText = document.getElementById("allergy-medi-text").value.trim();
  const food = document.querySelector('input[name="allergy_food"]:checked')?.value;
  const foodText = document.getElementById("allergy-food-text").value.trim();
  const other = document.querySelector('input[name="allergy_other"]:checked')?.value;
  const otherText = document.getElementById("allergy-other-text").value.trim();
  if (!medi || !food || !other) { alert("Bitte alle Felder ausfüllen."); return undefined; }
  return {
    allergy_medication: medi === "ja" ? (mediText || "Ja") : "Nein",
    allergy_food: food === "ja" ? (foodText || "Ja") : "Nein",
    allergy_other: other === "ja" ? (otherText || "Ja") : "Nein",
    __completed: true
  };
}

function collectFamily() {
  const herz = document.querySelector('input[name="fam_herz"]:checked')?.value;
  const diabetes = document.querySelector('input[name="fam_diabetes"]:checked')?.value;
  const krebs = document.querySelector('input[name="fam_krebs"]:checked')?.value;
  const psych = document.querySelector('input[name="fam_psyche"]:checked')?.value;
  if (!herz || !diabetes || !krebs || !psych) { alert("Bitte alle Felder ausfüllen."); return undefined; }
  return { fam_herz: herz, fam_diabetes: diabetes, fam_krebs: krebs, fam_psych: psych, __completed: true };
}

function collectLifestyle1() {
  const rauchen = document.querySelector('input[name="raucher"]:checked')?.value;
  const alkohol = document.querySelector('input[name="alkohol"]:checked')?.value;
  if (!rauchen || !alkohol) { alert("Bitte alle Felder ausfüllen."); return undefined; }
  return { rauchen, alkohol, __completed: true };
}

function collectLifestyle2() {
  const drogen = document.querySelector('input[name="drogen"]:checked')?.value;
  const schwanger = document.querySelector('input[name="schwanger"]:checked')?.value;
  if (!drogen || !schwanger) { alert("Bitte alle Felder ausfüllen."); return undefined; }
  return { drogen, schwanger, __completed: true };
}

function collectEmergency() {
  const name = document.getElementById("emergency-name").value.trim();
  const phone = document.getElementById("emergency-phone").value.trim();
  return { emergency_name: name || undefined, emergency_phone: phone || undefined, __completed: true };
}

function collectBodyMetrics() {
  const height = document.getElementById("bodymetrics-height").value;
  const weight = document.getElementById("bodymetrics-weight").value;
  if (!height || !weight) { alert("Bitte Größe und Gewicht angeben."); return undefined; }
  const h = parseInt(height);
  const w = parseInt(weight);
  if (h < 50 || h > 250) { alert("Bitte eine gültige Größe in cm eingeben (50–250)."); return undefined; }
  if (w < 2 || w > 300) { alert("Bitte ein gültiges Gewicht in kg eingeben (2–300)."); return undefined; }
  return { height_cm: h, weight_kg: w, __completed: true };
}

function collectContact() {
  const mobile = document.getElementById("contact-mobile").value.trim();
  const email = document.getElementById("contact-email").value.trim();
  const result = { __completed: true };
  if (mobile) {
    const mobileClean = mobile.replace(/[\s\-\(\)]/g, "");
    if (mobileClean.length < 8) { alert("Bitte eine gültige Mobilfunknummer eingeben."); return undefined; }
    result.mobile = mobileClean;
  }
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Bitte eine gültige E-Mail-Adresse eingeben."); return undefined; }
    result.email = email;
    const verified = document.getElementById("contact-email-verified")?.value === "1";
    result.email_verified = verified;
  }
  return result;
}

// ─── Email Verification ─────────────────────────────────────────
async function sendEmailCode() {
  const email = document.getElementById("contact-email").value.trim();
  const statusEl = document.getElementById("email-status");
  const btn = document.getElementById("btn-send-code");
  if (!email) { statusEl.textContent = "Bitte zuerst E-Mail eingeben."; statusEl.style.color = "#ef4444"; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { statusEl.textContent = "Ungültiges E-Mail-Format."; statusEl.style.color = "#ef4444"; return; }
  btn.disabled = true;
  btn.textContent = "Wird gesendet...";
  statusEl.textContent = "";
  try {
    const res = await fetch(`${API}/api/email/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId, email })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Fehler beim Senden");
    statusEl.textContent = "Code gesendet! Bitte prüfen Sie Ihr Postfach.";
    statusEl.style.color = "#22c55e";
    document.getElementById("email-code-group").style.display = "block";
  } catch(e) {
    statusEl.textContent = e.message;
    statusEl.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.textContent = "Code senden";
  }
}

async function verifyEmailCode() {
  const email = document.getElementById("contact-email").value.trim();
  const code = document.getElementById("email-code").value.trim();
  const statusEl = document.getElementById("email-status");
  const btn = document.getElementById("btn-verify-code");
  if (!code) { statusEl.textContent = "Bitte Code eingeben."; statusEl.style.color = "#ef4444"; return; }
  btn.disabled = true;
  btn.textContent = "Prüfe...";
  try {
    const res = await fetch(`${API}/api/email/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId, email, code })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Verifizierung fehlgeschlagen");
    statusEl.textContent = "✓ E-Mail erfolgreich verifiziert.";
    statusEl.style.color = "#22c55e";
    document.getElementById("contact-email-verified").value = "1";
    document.getElementById("email-code-group").style.display = "none";
  } catch(e) {
    statusEl.textContent = e.message;
    statusEl.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.textContent = "Code prüfen";
  }
}

function skipEmailVerify() {
  document.getElementById("contact-email-verified").value = "0";
  const statusEl = document.getElementById("email-status");
  statusEl.textContent = "Fortfahren ohne E-Mail-Verifikation.";
  statusEl.style.color = "#94a3b8";
  // Hide code input section
  document.getElementById("email-code-group").style.display = "none";
  document.getElementById("btn-send-code").style.display = "none";
}

// ─── Review & Submit ────────────────────────────────────────────
function buildReview() {
  const items = [
    { label: "Sprachen", cat: "language" },
    { label: "Herkunft", cat: "origin" },
    { label: "Familienstand", cat: "family_status" },
    { label: "Kinder", cat: "children" },
    { label: "Bildung & Beruf", cat: "job" },
    { label: "Versicherung", cat: "insurance" },
    { label: "Beschwerden", cat: "symptoms" },
    { label: "Dauer", cat: "duration" },
    { label: "Vorerkrankungen", cat: "conditions" },
    { label: "Operationen", cat: "operations" },
    { label: "Blutverdünnung", cat: "meds_bloodthin" },
    { label: "Blutdrucksenker", cat: "meds_bp" },
    { label: "Asthma/COPD", cat: "meds_asthma" },
    { label: "Diabetes", cat: "meds_diabetes" },
    { label: "Neurologische Medikamente", cat: "meds_neuro" },
    { label: "Schmerzmittel", cat: "meds_pain" },
    { label: "Gynäkologie/Urologie", cat: "meds_gynuro" },
    { label: "Cholesterinsenker", cat: "meds_chol" },
    { label: "Sonstige Medikamente", cat: "meds_other" },
    { label: "Allergien", cat: "allergies" },
    { label: "Familienanamnese", cat: "family" },
    { label: "Lebensgewohnheiten (1)", cat: "lifestyle" },
    { label: "Lebensgewohnheiten (2)", cat: "lifestyle2" },
    { label: "Notfallkontakt", cat: "emergency" },
    { label: "Körpermaße", cat: "bodymetrics" },
    { label: "Kontakt", cat: "contact" }
  ];
  let html = "";
  let complete = 0;
  items.forEach(it => {
    const saved = sessionStorage.getItem("myhistoree_" + it.cat);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.__completed) { html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#22c55e;">✓ Gespeichert</span></div>`; complete++; }
      else { html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#f59e0b;">⚠ Entwurf</span></div>`; }
    } else {
      html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#94a3b8;">–</span></div>`;
    }
  });
  html += `<div style="margin-top:12px;padding:10px;background:#dbeafe;border-radius:8px;font-size:0.9rem;">${complete}/${items.length} Abschnitte bearbeitet</div>`;
  document.getElementById("review-content").innerHTML = html;
}

async function submitFinal() {
  if (!encounterId) { alert("Keine Session. Bitte starten Sie neu."); return; }
  const consent = document.getElementById("dsgvo-consent")?.checked;
  if (!consent) { alert("Bitte bestätigen Sie den Datenschutzhinweis, um fortzufahren."); return; }
  try {
    await fetch(`${API}/api/anamnese/${encounterId}/complete`, { method: "POST" });
    document.getElementById("done-pvs-id").textContent = linkData?.pvsPatientId || "—";
    document.getElementById("done-icon").textContent = "✓";
    document.getElementById("done-icon").style.background = "#22c55e";
    document.getElementById("done-title").textContent = "Anamnese abgeschickt!";
    document.getElementById("done-message").textContent = "Vielen Dank. Ihre Angaben wurden sicher an die Praxis übermittelt.";
    document.getElementById("done-help").textContent = "Sie können dieses Fenster nun schließen.";
    wizard.goTo("done");
  } catch(e) {
    alert("Absenden fehlgeschlagen: " + e.message);
  }
}

async function rejectAnamnese() {
  if (!encounterId) { alert("Keine Session. Bitte starten Sie neu."); return; }
  if (!confirm("Möchten Sie wirklich ablehnen? Alle Ihre eingegebenen Daten werden unwiderruflich gelöscht.")) return;
  try {
    await fetch(`${API}/api/anamnese/${encounterId}/reject`, { method: "POST" });
    document.getElementById("done-pvs-id").textContent = linkData?.pvsPatientId || "—";
    document.getElementById("done-icon").textContent = "✕";
    document.getElementById("done-icon").style.background = "#ef4444";
    document.getElementById("done-title").textContent = "Anamnese abgelehnt";
    document.getElementById("done-message").textContent = "Sie haben der Datenspeicherung nicht zugestimmt. Alle Ihre Angaben wurden gelöscht und nicht gespeichert.";
    document.getElementById("done-help").textContent = "Sie können dieses Fenster nun schließen.";
    wizard.goTo("done");
  } catch(e) {
    alert("Fehler beim Löschen: " + e.message);
  }
}

// Init
initPage();
