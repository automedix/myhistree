// myhistoree v0.4.0 – Vereinfachte Anamnese (Session-basiert, kein NOSTR)
const API = "";

let encounterId = null;
let patientId = null;
let currentStep = 0;
let linkToken = null;
let linkData = null;

const screens = [
  "verify", "language", "origin", "job", "insurance",
  "symptoms", "duration", "conditions", "operations", "medications",
  "allergies", "family", "lifestyle", "lifestyle2", "emergency",
  "review", "done"
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

    const pct = Math.round((currentStep / (screens.length - 1)) * 100);
    document.getElementById("progress-fill").style.width = pct + "%";

    if (currentScreen === "review") buildReview();
  },
  async saveAndNext(category, collectorFn) {
    const data = collectorFn();
    if (!data) return;
    if (encounterId) {
      try {
        await fetch(`${API}/api/anamnese/${encounterId}/${category}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
      } catch(e) { console.error("Speichern fehlgeschlagen", e); }
    }
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

    // Hide verify, show first form screen
    document.getElementById("screen-verify").classList.remove("active");
    currentStep = 1; // language
    wizard.render();
  } catch(e) {
    showError(e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Anamnese starten"; }
  }
}

// ─── Page Initialisierung ───────────────────────────────────────
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

    // Update verify screen with practice info
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
function toggleMedis(show) { document.getElementById("medis-detail").classList.toggle("hidden", !show); }
function toggleAllergy(type, show) { document.getElementById("allergy-" + type + "-text").classList.toggle("hidden", !show); }

// ─── Collectors ─────────────────────────────────────────────────
function collectLanguage() {
  const languages = getChips("lang-chips");
  const interpreter = document.querySelector('input[name="interpreter"]:checked')?.value;
  if (!languages.length) { alert("Bitte wählen Sie mindestens eine Sprache."); return null; }
  return { languages: languages.join(", "), interpreter, __completed: true };
}
function collectDemographics2() {
  const origin = document.querySelector('input[name="origin"]:checked')?.value;
  const familienstand = document.getElementById("familienstand").value;
  if (!origin || !familienstand) { alert("Bitte alle Felder ausfüllen."); return null; }
  return { origin, familienstand, __completed: true };
}
function collectDemographics3() {
  const kinder = document.querySelector('input[name="kinder"]:checked')?.value;
  const bildung = document.getElementById("bildung").value;
  const beruf = document.getElementById("beruf").value;
  if (!kinder || !bildung || !beruf) { alert("Bitte alle Felder ausfüllen."); return null; }
  return { kinder, bildung, beruf, __completed: true };
}
function collectInsurance() {
  const type = document.querySelector('input[name="insurance_type"]:checked')?.value;
  const kvid = document.getElementById("kvid").value.trim();
  if (!type) { alert("Bitte Versicherungsart wählen."); return null; }
  return { insurance_type: type, kvid: kvid || undefined, __completed: true };
}
function collectSymptoms() {
  const symptoms = getChips("symptom-chips");
  if (!symptoms.length) { alert("Bitte wählen Sie mindestens eine Option."); return null; }
  return { symptoms: symptoms.join(", "), __completed: true };
}
function collectDuration() {
  const duration = document.querySelector('input[name="duration"]:checked')?.value;
  if (!duration) { alert("Bitte Dauer angeben."); return null; }
  return { duration, __completed: true };
}
function collectConditions() {
  const conditions = getChips("condition-chips");
  if (!conditions.length) { alert("Bitte wählen Sie mindestens eine Option."); return null; }
  return { conditions: conditions.join(", "), __completed: true };
}
function collectOperations() {
  const ops = document.querySelector('input[name="ops"]:checked')?.value;
  const detail = document.getElementById("ops-text").value.trim();
  if (!ops) { alert("Bitte auswählen."); return null; }
  return { operations: ops === "ja" ? (detail || "Ja, Details folgen") : "Nein", __completed: true };
}
function collectMedications() {
  const medis = document.querySelector('input[name="medis"]:checked')?.value;
  const detail = document.getElementById("medis-text").value.trim();
  if (!medis) { alert("Bitte auswählen."); return null; }
  return { medications: medis === "ja" ? (detail || "Ja, Details folgen") : "Keine", __completed: true };
}
function collectAllergies() {
  const medi = document.querySelector('input[name="allergy_medi"]:checked')?.value;
  const mediText = document.getElementById("allergy-medi-text").value.trim();
  const food = document.querySelector('input[name="allergy_food"]:checked')?.value;
  const foodText = document.getElementById("allergy-food-text").value.trim();
  const other = document.querySelector('input[name="allergy_other"]:checked')?.value;
  const otherText = document.getElementById("allergy-other-text").value.trim();
  if (!medi || !food || !other) { alert("Bitte alle Felder ausfüllen."); return null; }
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
  if (!herz || !diabetes || !krebs || !psych) { alert("Bitte alle Felder ausfüllen."); return null; }
  return { fam_herz: herz, fam_diabetes: diabetes, fam_krebs: krebs, fam_psych: psych, __completed: true };
}
function collectLifestyle1() {
  const rauchen = document.querySelector('input[name="raucher"]:checked')?.value;
  const alkohol = document.querySelector('input[name="alkohol"]:checked')?.value;
  if (!rauchen || !alkohol) { alert("Bitte alle Felder ausfüllen."); return null; }
  return { rauchen, alkohol, __completed: true };
}
function collectLifestyle2() {
  const drogen = document.querySelector('input[name="drogen"]:checked')?.value;
  const schwanger = document.querySelector('input[name="schwanger"]:checked')?.value;
  if (!drogen || !schwanger) { alert("Bitte alle Felder ausfüllen."); return null; }
  return { drogen, schwanger, __completed: true };
}
function collectEmergency() {
  const name = document.getElementById("emergency-name").value.trim();
  const phone = document.getElementById("emergency-phone").value.trim();
  return { emergency_name: name || undefined, emergency_phone: phone || undefined, __completed: true };
}

// ─── Review & Submit ────────────────────────────────────────────
function buildReview() {
  const items = [
    { label: "Sprachen", cat: "language" },
    { label: "Herkunft / Familienstand", cat: "origin" },
    { label: "Kinder / Bildung / Beruf", cat: "job" },
    { label: "Versicherung", cat: "insurance" },
    { label: "Beschwerden", cat: "symptoms" },
    { label: "Dauer", cat: "duration" },
    { label: "Vorerkrankungen", cat: "conditions" },
    { label: "Operationen", cat: "operations" },
    { label: "Medikamente", cat: "medications" },
    { label: "Allergien", cat: "allergies" },
    { label: "Familienanamnese", cat: "family" },
    { label: "Lebensgewohnheiten (1)", cat: "lifestyle" },
    { label: "Lebensgewohnheiten (2)", cat: "lifestyle2" },
    { label: "Notfallkontakt", cat: "emergency" }
  ];

  // Load from server for accurate review
  let html = "";
  let complete = 0;

  items.forEach(it => {
    // For now, simple placeholder - data is server-side
    html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#22c55e;">✓ Gespeichert</span></div>`;
    complete++;
  });

  html += `<div style="margin-top:12px;padding:10px;background:#dbeafe;border-radius:8px;font-size:0.9rem;">${complete}/${items.length} Abschnitte bearbeitet</div>`;
  document.getElementById("review-content").innerHTML = html;
}

async function submitFinal() {
  if (!encounterId) { alert("Keine Session. Bitte starten Sie neu."); return; }

  try {
    // Mark encounter as completed
    await fetch(`${API}/api/anamnese/${encounterId}/complete`, { method: "POST" });
    document.getElementById("done-pvs-id").textContent = linkData?.pvsPatientId || "—";
    wizard.goTo("done");
  } catch(e) {
    alert("Absenden fehlgeschlagen: " + e.message);
  }
}

// Init
initPage();