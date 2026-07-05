// myhistree v0.6.5 – Online Anamnese
// === i18n Fallback – Language Switcher disabled for now =====================
const i18nFallbacks = {
  "screen.verify.btn.start": "Anamnese starten",
  "screen.verify.btn.resume": "Anamnese fortsetzen",
  "screen.verify.title.resume": "Willkommen zurück",
  "screen.verify.lang.switch": "Language: English",
  "screen.verify.lang.active": "Sprache: Deutsch",
  "screen.verify.resume.subtitle": "Sie haben Ihre Anamnese bereits begonnen. Möchten Sie am Punkt \\{screen}\\ fortfahren?",
  "screen.verify.resume.pin": "Ihr persönlicher PIN-Code:",
  "language": "Sprache",
  "origin": "Herkunft",
  "family_status": "Familienstand",
  "children": "Kinder",
  "job": "Beruf",
  "insurance": "Versicherung",
  "symptoms": "Beschwerden",
  "duration": "Dauer",
  "conditions": "Vorerkrankungen",
  "operations": "Operationen",
  "meds_bloodthin": "Blutverdünner",
  "meds_bp": "Blutdruckmedikamente",
  "meds_asthma": "Asthma-Medikamente",
  "meds_diabetes": "Diabetes-Medikamente",
  "meds_neuro": "Neurologie-Medikamente",
  "meds_pain": "Schmerzmedikamente",
  "meds_gynuro": "Gyn/Uro-Medikamente",
  "meds_chol": "Cholesterin-Medikamente",
  "meds_other": "Sonstige Medikamente",
  "allergies": "Allergie",
  "family": "Familie",
  "lifestyle": "Lebensstil",
  "lifestyle2": "Lebensstil 2",
  "emergency": "Notfall",
  "bodymetrics": "Körpermaße",
  "contact": "Kontakt",
  "notes": "Notizen",
  "review": "Übersicht",
  "alert.select.one": "Bitte wählen Sie mindestens eine Option aus.",
  "alert.fill.required": "Bitte füllen Sie alle Pflichtfelder aus.",
  "alert.fill.all": "Bitte beantworten Sie alle Fragen."
};
function t(key) { return i18nFallbacks[key] || null; }
window.t = t;
function setLanguage(lang) { console.log("Language switcher disabled, requested:", lang); }
// ========================================================================
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
  "email_verified",
  "notes",
  "done"
];

// ─── Utility ────────────────────────────────────────────────────
function parseTokenFromPath() {
  const m = window.location.pathname.match(/\/anamnese\/([a-f0-9-]{32,})/);
  return m ? m[1] : null;
}
function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token: p.get("token") || parseTokenFromPath(),
    verify: p.get("verify"),
    verifyToken: p.get("verifyToken")
  };
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
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
  async goTo(name) {
    const idx = screens.indexOf(name);
    if (idx >= 0) { currentStep = idx; await this.render(); }
  },
  async render() {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
    let currentScreen = screens[currentStep];
    // Auto-skip email_verified if no magic-link verification happened
    if (currentScreen === "email_verified" && sessionStorage.getItem("myhistoree_email_verified") !== "1") {
      currentStep++;
      currentScreen = screens[currentStep];
    }
    const el = document.getElementById("screen-" + currentScreen);
    if (el) el.classList.add("active");
    // Save progress to sessionStorage for resume
    try {
      sessionStorage.setItem("myhistoree_step", String(currentStep));
      sessionStorage.setItem("myhistoree_mode", checkinMode);
      sessionStorage.setItem("myhistoree_encounter", encounterId || "");
    } catch(e) {}
    // Dynamic children screen: rebuild based on kid count from family_status
    if (currentScreen === "children") buildChildrenScreen();
    const pct = Math.round((currentStep / (screens.length - 1)) * 100);
    document.getElementById("progress-fill").style.width = pct + "%";
    
  },
  async saveAndNext(category, collectorFn) {
    const data = collectorFn();
    if (data === null) { saveProgress(); this.next(); return; }
    if (data === undefined) return;
    if (encounterId) {
      try {
        await fetch(`${API}/api/anamnese/${encounterId}/${category}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
      } catch(e) { console.error("Speichern fehlgeschlagen", e); }
    }
    sessionStorage.setItem("myhistoree_" + category, JSON.stringify({...data, __completed: true}));
    saveProgress();
    this.next();
  },
  prev() {
    if (currentStep > 0) {
      saveProgress();
      currentStep--;
      this.render();
    }
  }
};

// ─── Verification ───────────────────────────────────────────────
function parseGermanDate(dobStr) {
  const m = dobStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (d.getFullYear() !== parseInt(yyyy) || d.getMonth() + 1 !== parseInt(mm) || d.getDate() !== parseInt(dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

async function verifyAndStart() {
  hideError();
  const dobRaw = document.getElementById("verify-dob")?.value?.trim();
  const pin = document.getElementById("verify-pin")?.value;
  if (!dobRaw) { showError("Bitte geben Sie Ihr Geburtsdatum ein."); return; }
  const dob = parseGermanDate(dobRaw);
  if (!dob) { showError("Bitte geben Sie das Geburtsdatum im Format TT.MM.JJJJ ein."); return; }
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
    if (json.resume && linkData?.currentScreen) {
      await restoreSession(linkData.currentScreen);
    } else {
      currentStep = 1;
      wizard.render();
    }
  } catch(e) {
    showError(e.message);
    if (btn) { btn.disabled = false; btn.textContent = linkData?.resume ? t("screen.verify.btn.resume") : t("screen.verify.btn.start"); }
  }
}

// ─── Magic Link Verification ──────────────────────────────────
async function checkMagicLinkVerification() {
  const params = getUrlParams();
  const verifyToken = params.verifyToken;
  if (!verifyToken) return false;
  try {
    const res = await fetch(`${API}/api/email/verify-magic?token=${encodeURIComponent(verifyToken)}`);
    if (!res.ok) return false;
    const json = await res.json();
    if (json.verified) {
      encounterId = json.encounterId;
      if (json.linkToken) linkToken = json.linkToken;
      sessionStorage.setItem("myhistoree_email_verified", "1");
      await markContactEmailVerified();
      return true;
    }
  } catch(e) { console.error("Magic link check failed", e); }
  return false;
}

// ─── Page Init ───────────────────────────────────────────────────
async function initPage() {
  const params = getUrlParams();
  linkToken = params.token;

  // ── Magic-Link Handler: vor allem anderen prüfen ──
  if (params.verify === "email" && params.verifyToken) {
    const ok = await checkMagicLinkVerification();
    if (ok) {
      try {
        const res = await fetch(`${API}/api/link/validate/${linkToken}`);
        if (res.ok) linkData = await res.json();
      } catch(e) {}
      const savedMode = sessionStorage.getItem("myhistoree_mode");
      if (savedMode === "quick") { screens = quickScreens; checkinMode = "quick"; }
      // Restore anamnesis data from server into new tab's sessionStorage
      if (encounterId) {
        try {
          const res = await fetch(`${API}/api/anamnese/${encounterId}/responses`);
          if (res.ok) {
            const responses = await res.json();
            restoreFormData(responses);
          }
        } catch(e) { console.error("Data restore failed", e); }
      }
      await wizard.goTo("contact");
      // Server-Fallback: keine sessionStorage-Füllung da tab-lokal
      if (encounterId) {
        try {
          const res = await fetch(`${API}/api/anamnese/${encounterId}/contact`);
          if (res.ok) {
            const c = await res.json();
            // Retry loop: wait for DOM to render
            for (let retries = 0; retries < 20; retries++) {
              const mobileEl = document.getElementById("contact-mobile");
              const landlineEl = document.getElementById("contact-landline");
              const emailEl = document.getElementById("contact-email");
              const verifiedEl = document.getElementById("contact-email-verified");
              if (mobileEl) { mobileEl.value = c.mobile || ""; }
              if (landlineEl) { landlineEl.value = c.landline || ""; }
              if (emailEl) { emailEl.value = c.email || ""; }
              if (verifiedEl) {
                verifiedEl.value = c.email_verified ? "1" : "0";
              }
              if (mobileEl && emailEl) break;
              await new Promise(r => setTimeout(r, 100));
            }
          }
        } catch(e) { console.error("Contact fill failed", e); }
      }
      return;
    }
  }

  if (!linkToken) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui;"><h2>Kein gültiger Link</h2><p>Bitte verwenden Sie den Link, den Sie von Ihrer Praxis erhalten haben.</p></div>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/link/validate/${linkToken}`);
    if (!res.ok) {
      const err = await res.json();
      document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:system-ui;"><h2>Link ungültig</h2><p>${escapeHtml(err.error) || "Dieser Link ist abgelaufen oder bereits verwendet."}</p></div>`;
      return;
    }
    linkData = await res.json();
    const info = document.getElementById("verify-info");
    if (info) {
      info.innerHTML = `<div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:12px;margin-bottom:16px;">
        <strong>Praxis:</strong> ${escapeHtml(linkData.practiceName) || "Ihre Praxis"}<br>
        ${linkData.pvsPatientId ? `<strong>Patienten-ID:</strong> ${escapeHtml(linkData.pvsPatientId)}<br>` : ""}
        ${linkData.patientEmail ? `<strong>E-Mail:</strong> ${escapeHtml(linkData.patientEmail)}<br>` : ""}
      </div>`;
    }
    if (linkData.requiresPin) {
      document.getElementById("verify-pin-group").style.display = "block";
    }
    // Resume: if link was already used and there's an in-progress encounter
    if (linkData.resume) {
      encounterId = linkData.encounterId;
      const btn = document.getElementById("btn-verify");
      if (btn) {
        btn.textContent = t("screen.verify.btn.resume");
        btn.setAttribute("data-resume", "true");
      }
      const title = document.querySelector("#screen-verify h1");
      if (title) {
        title.innerHTML = t("screen.verify.title.resume");
      }
      const subtitle = document.querySelector("#screen-verify .subtitle");
      if (subtitle && linkData.currentScreen) {
        const screenNames = {
          language: t("screen.language.title"), origin: t("screen.origin.title"), family_status: t("screen.family_status.title"),
          children: t("screen.children.title"), job: t("screen.job.title"), insurance: t("screen.insurance.title"),
          symptoms: t("screen.symptoms.title"), duration: t("screen.duration.title"), conditions: t("screen.conditions.title"),
          operations: t("screen.operations.title"), meds_bloodthin: t("screen.meds_bloodthin.title"), meds_bp: t("screen.meds_bp.title"),
          meds_asthma: t("screen.meds_asthma.title"), meds_diabetes: t("screen.meds_diabetes.title"), meds_neuro: t("screen.meds_neuro.title"),
          meds_pain: t("screen.meds_pain.title"), meds_gynuro: t("screen.meds_gynuro.title"), meds_chol: t("screen.meds_chol.title"),
          meds_other: t("screen.meds_other.title"), allergies: t("screen.allergies.title"), family: t("screen.family.title"),
          lifestyle: t("screen.lifestyle.title"), lifestyle2: t("screen.lifestyle2.title"), emergency: t("screen.emergency.title"),
          bodymetrics: t("screen.bodymetrics.title"), contact: t("screen.contact.title"), notes: t("screen.notes.title"), review: t("screen.review.title")
        };
        const screenName = escapeHtml(screenNames[linkData.currentScreen] || linkData.currentScreen);
        let resumeText = t("screen.verify.resume.subtitle").replace("{screen}", screenName);
        if (linkData.requiresPin) {
          resumeText += " " + t("screen.verify.resume.pin");
        }
        subtitle.innerHTML = resumeText;
      }
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
  initChips("other-meds-chips");
  wizard.render();
  initLangSwitcher();
  injectPauseButtons();
}

function initLangSwitcher() {
  const container = document.getElementById("lang-switch-container");
  if (!container) return;
  const btn = document.getElementById("lang-switch-btn");
  if (!btn) return;
  btn.addEventListener("click", function() {
    const current = window.__i18n.lang || 'de';
    const next = (current === 'de') ? 'en' : 'de';
    setLanguage(next);
    // Update button text to the OTHER language
    btn.textContent = window.t("screen.verify.lang." + (next === 'de' ? "switch" : "active"));
  });
  // Set initial button text
  btn.textContent = window.t("screen.verify.lang.switch");
}

function injectPauseButtons() {
  const skipScreens = ["verify", "done"];
  for (const screenName of screens) {
    if (skipScreens.includes(screenName)) continue;
    const screenEl = document.getElementById("screen-" + screenName);
    if (!screenEl) continue;
    const existing = screenEl.querySelector(".btn-pause");
    if (existing) continue;
    const navBtns = screenEl.querySelector(".nav-btns");
    if (!navBtns) continue;
    const btn = document.createElement("button");
    btn.className = "btn-pause";
    btn.textContent = "Später fortsetzen";
    btn.style.cssText = "width:100%;margin-top:12px;padding:10px;border:none;background:#f1f5f9;color:#64748b;border-radius:8px;font-size:0.85rem;cursor:pointer;";
    btn.onclick = saveAndPause;
    navBtns.parentNode.insertBefore(btn, navBtns.nextSibling);
  }
}

// ─── Resume / Session Restore ─────────────────────────────────────────────
async function saveProgress() {
  if (!encounterId) return;
  const currentScreen = screens[currentStep];
  try {
    await fetch(`${API}/api/anamnese/${encounterId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentScreen })
    });
  } catch(e) { console.error("Progress save failed", e); }
}

async function restoreSession(targetScreen) {
  if (!encounterId) return;
  try {
    const res = await fetch(`${API}/api/anamnese/${encounterId}/responses`);
    const responses = await res.json();
    restoreFormData(responses);
    wizard.goTo(targetScreen);
  } catch(e) {
    console.error("Restore failed", e);
    currentStep = 1;
    wizard.render();
  }
}

function restoreFormData(responses) {
  for (const [category, data] of Object.entries(responses || {})) {
    if (typeof data !== "object" || data === null) continue;
    sessionStorage.setItem("myhistoree_" + category, JSON.stringify({...data, __completed: true}));
    for (const [key, value] of Object.entries(data)) {
      if (key === "__completed") continue;
      const el = document.getElementById(key);
      if (el) {
        if (el.type === "checkbox" || el.type === "radio") {
          const radios = document.querySelectorAll(`input[name="${el.name}"]`);
          radios.forEach(r => { if (r.value === value) r.checked = true; });
        } else if (el.tagName === "SELECT") {
          el.value = value;
        } else {
          el.value = value;
        }
      }
      // Chip groups
      const chipGroup = document.getElementById(key.replace(/_/g, "-") + "-chips") || document.getElementById(key + "-chips");
      if (chipGroup && typeof value === "string") {
        const vals = value.split(", ").map(v => v.trim());
        chipGroup.querySelectorAll(".chip").forEach(chip => {
          chip.classList.toggle("selected", vals.includes(chip.dataset.value));
        });
      }
    }
  }
}

async function saveAndPause() {
  await saveProgress();
  const doneScreen = document.getElementById("screen-done");
  if (doneScreen) {
    const content = doneScreen.querySelector(".content") || doneScreen;
    const original = content.innerHTML;
    content.innerHTML = `<div style="text-align:center;padding:40px;"><h2>Bearbeitung pausiert</h2><p style="color:#64748b;">Ihre Angaben wurden gespeichert. Sie können später mit dem gleichen Link fortfahren.</p><p style="font-size:0.85rem;color:#94a3b8;margin-top:8px;">Patienten-ID: <strong>${escapeHtml(linkData?.pvsPatientId) || "—"}</strong></p></div>`;
    setTimeout(() => { content.innerHTML = original; }, 5000);
  }
  wizard.goTo("done");
}

// ─── Chip Helpers ────────────────────────────────────────────────────────────────────────────
function initChips(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.preventDefault();
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
function toggleCondition(type, show) { document.getElementById("condition-" + type + "-text").classList.toggle("hidden", !show); }

// ─── Dynamic Children Screen Builder ────────────────────────────
function buildChildrenScreen() {
  const saved = sessionStorage.getItem("myhistoree_family_status");
  let kinderAnzahl = 0;
  if (saved) { try { kinderAnzahl = parseInt(JSON.parse(saved).kinder, 10) || 0; } catch(e){} if (kinderAnzahl < 0 || kinderAnzahl > 20) kinderAnzahl = 0; }
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
  if (!languages.length) { alert("Bitte wählen Sie mindestens eine Sprache aus."); return undefined; }
  // Language switcher disabled for now
  return { languages: languages.join(", "), interpreter, __completed: true };
}

function collectOrigin() {
  const heimatland = document.getElementById("heimatland").value;
  const staatsangehoerigkeit = document.getElementById("staatsangehoerigkeit").value;
  if (!heimatland) { alert(t("alert.fill.required")); return undefined; }
  if (!staatsangehoerigkeit) { alert(t("alert.fill.required")); return undefined; }
  return { heimatland, staatsangehoerigkeit, __completed: true };
}

function collectFamilyStatus() {
  const familienstand = document.getElementById("familienstand").value;
  const kinder = document.querySelector('input[name="kinder"]:checked')?.value;
  if (!familienstand) { alert(t("alert.fill.required")); return undefined; }
  if (!kinder) { alert(t("alert.fill.required")); return undefined; }
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
  if (hasEmpty) { alert(t("alert.fill.required")); return undefined; }
  return { children, __completed: true };
}

function collectJob() {
  const bildung = document.getElementById("bildung").value;
  const berufsausbildung = document.getElementById("berufsausbildung").value.trim();
  const taetigkeit = document.getElementById("taetigkeit").value.trim();
  const situation = document.getElementById("berufssituation").value;
  if (!bildung) { alert(t("alert.fill.required")); return undefined; }
  if (!situation) { alert(t("alert.fill.required")); return undefined; }
  return { bildung, berufsausbildung: berufsausbildung || undefined, taetigkeit: taetigkeit || undefined, situation, __completed: true };
}

function collectInsurance() {
  const type = document.querySelector('input[name="insurance_type"]:checked')?.value;
  const kvid = document.getElementById("kvid").value.trim();
  if (!type) { alert(t("alert.fill.required")); return undefined; }
  return { insurance_type: type, kvid: kvid || undefined, __completed: true };
}

function collectSymptoms() {
  const symptoms = getChips("symptom-chips");
  if (!symptoms.length) { alert(t("alert.select.one")); return undefined; }
  const notes = document.getElementById("symptoms-notes").value.trim();
  return { symptoms: symptoms.join(", "), notes: notes || undefined, __completed: true };
}

function collectDuration() {
  const duration = document.querySelector('input[name="duration"]:checked')?.value;
  if (!duration) { alert(t("alert.fill.required")); return undefined; }
  return { duration, __completed: true };
}

function collectConditions() {
  const conditions = getChips("condition-chips");
  const heart = document.querySelector('input[name="cond_heart"]:checked')?.value;
  const heartText = document.getElementById("condition-heart-text").value.trim();
  const cancer = document.querySelector('input[name="cond_cancer"]:checked')?.value;
  const cancerText = document.getElementById("condition-cancer-text").value.trim();
  const detailText = escapeHtml(document.getElementById("condition-detail-text")?.value.trim() || "");
  if (!heart || !cancer) { alert("Bitte beantworten Sie die Fragen zu Herzkrankheit und Krebs."); return undefined; }
  const hasConditions = conditions.length > 0 || detailText.length > 0;
  if (!hasConditions) { alert("Bitte wählen Sie mindestens eine Vorerkrankung aus oder beschreiben Sie diese."); return undefined; }
  return {
    conditions: conditions.length ? conditions.join(", ") : undefined,
    other_conditions: detailText.length ? detailText : undefined,
    heart: heart === "ja" ? (heartText || "Ja") : "Nein",
    cancer: cancer === "ja" ? (cancerText || "Ja") : "Nein",
    __completed: true
  };
}

function collectOperations() {
  const ops = document.querySelector('input[name="ops"]:checked')?.value;
  const detail = document.getElementById("ops-text").value.trim();
  if (!ops) { alert(t("alert.select.one")); return undefined; }
  return { operations: ops === "ja" ? (detail || "Ja, Details folgen") : "Nein", __completed: true };
}

function collectMedsBloodthin() {
  const meds = getChips("bloodthin-chips");
  const detail = document.getElementById("bloodthin-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_bloodthin: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_bloodthin: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsBP() {
  const meds = getChips("bp-chips");
  const detail = document.getElementById("bp-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_bp: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_bp: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsAsthma() {
  const meds = getChips("asthma-chips");
  const detail = document.getElementById("asthma-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_asthma: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_asthma: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsDiabetes() {
  const meds = getChips("diabetes-chips");
  const detail = document.getElementById("diabetes-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_diabetes: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_diabetes: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsNeuro() {
  const meds = getChips("neuro-chips");
  const detail = document.getElementById("neuro-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_neuro: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_neuro: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsPain() {
  const meds = getChips("pain-chips");
  const detail = document.getElementById("pain-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_pain: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_pain: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsGynUro() {
  const meds = getChips("gynuro-chips");
  const detail = document.getElementById("gynuro-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_gynuro: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_gynuro: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectMedsChol() {
  const meds = getChips("chol-chips");
  const detail = document.getElementById("chol-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_chol: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_chol: selected.join(", "), detail: detail || undefined, __completed: true };
}
function collectNotes() {
  const text = document.getElementById("notes-text").value.trim();
  // Always save, even if empty, so the admin sees "Keine Angaben"
  return { notes: text || "", __completed: true };
}

function collectMedsOther() {
  const meds = getChips("other-meds-chips");
  const detail = document.getElementById("other-meds-text").value.trim();
  if (!meds.length && !detail) { alert(t("alert.select.one")); return undefined; }
  const selected = meds.filter(m => m !== "keine");
  if (selected.length === 0) return { meds_other: detail || "Keine", detail: detail || undefined, __completed: true };
  return { meds_other: selected.join(", "), detail: detail || undefined, __completed: true };
}

function collectAllergies() {
  const medi = document.querySelector('input[name="allergy_medi"]:checked')?.value;
  const mediText = document.getElementById("allergy-medi-text").value.trim();
  const food = document.querySelector('input[name="allergy_food"]:checked')?.value;
  const foodText = document.getElementById("allergy-food-text").value.trim();
  const other = document.querySelector('input[name="allergy_other"]:checked')?.value;
  const otherText = document.getElementById("allergy-other-text").value.trim();
  if (!medi || !food || !other) { alert(t("alert.fill.all")); return undefined; }
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
  if (!herz || !diabetes || !krebs || !psych) { alert(t("alert.fill.all")); return undefined; }
  return { fam_herz: herz, fam_diabetes: diabetes, fam_krebs: krebs, fam_psych: psych, __completed: true };
}

function collectLifestyle1() {
  const rauchen = document.querySelector('input[name="raucher"]:checked')?.value;
  const alkohol = document.querySelector('input[name="alkohol"]:checked')?.value;
  if (!rauchen || !alkohol) { alert(t("alert.fill.all")); return undefined; }
  return { rauchen, alkohol, __completed: true };
}

function collectLifestyle2() {
  const drogen = document.querySelector('input[name="drogen"]:checked')?.value;
  const schwanger = document.querySelector('input[name="schwanger"]:checked')?.value;
  if (!drogen || !schwanger) { alert(t("alert.fill.all")); return undefined; }
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
  const landline = document.getElementById("contact-landline").value.trim();
  const email = document.getElementById("contact-email").value.trim();
  const mobileClean = mobile.replace(/[\s\-\(\)]/g, "");
  const landlineClean = landline.replace(/[\s\-\(\)]/g, "");
  const hasMobile = mobileClean.length >= 6;
  const hasLandline = landlineClean.length >= 6;
  if (!hasMobile && !hasLandline) { alert("Bitte geben Sie mindestens eine Telefonnummer an, unter der wir Sie erreichen können."); return undefined; }
  const result = { __completed: true };
  if (hasMobile) result.mobile = mobileClean;
  if (hasLandline) result.landline = landlineClean;
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Bitte eine gültige E-Mail-Adresse eingeben."); return undefined; }
    result.email = email;
    // Fallback to sessionStorage if DOM was reset (e.g. new tab or reload)
    const domVerified = document.getElementById("contact-email-verified")?.value === "1";
    const storageVerified = sessionStorage.getItem("myhistoree_email_verified") === "1";
    result.email_verified = domVerified || storageVerified;
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
    // ── SAVE contact data to server BEFORE sending code ──
    const contactData = collectContact();
    if (contactData && encounterId) {
      await fetch(`${API}/api/anamnese/${encounterId}/contact`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactData)
      });
      sessionStorage.setItem("myhistoree_contact", JSON.stringify(contactData));
    }
    // ── Now send verification email ──
    const res = await fetch(`${API}/api/email/send-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId, email })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Fehler beim Senden");
    statusEl.innerHTML = "Bestätigungslink gesendet!<br>Bitte prüfen Sie Ihr E-Mail-Postfach und tippen Sie auf den Link in der Nachricht.";
    statusEl.style.color = "#22c55e";
  } catch(e) {
    statusEl.textContent = e.message;
    statusEl.style.color = "#ef4444";
  } finally {
    btn.textContent = "Prüfen Sie Ihr E-Mail-Postfach";
    btn.disabled = false;
  }
}

async function markContactEmailVerified() {
  if (!encounterId) return;
  try {
    // Fetch current contact data
    const res = await fetch(`${API}/api/anamnese/${encounterId}/contact`);
    if (res.ok) {
      const data = await res.json();
      // Only update if there's an email in the contact record
      if (data && data.email) {
        data.email_verified = true;
        data.__completed = true;
        // Save back to server
        await fetch(`${API}/api/anamnese/${encounterId}/contact`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        // Also update sessionStorage
        sessionStorage.setItem("myhistoree_contact", JSON.stringify(data));
      }
    }
  } catch(e) { console.error("Failed to update contact email_verified", e); }
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
    statusEl.textContent = "E-Mail erfolgreich verifiziert.";
    statusEl.style.color = "#22c55e";
    document.getElementById("contact-email-verified").value = "1";
    sessionStorage.setItem("myhistoree_email_verified", "1");
    await markContactEmailVerified();
    document.getElementById("email-code-group").style.display = "none";
  } catch(e) {
    statusEl.textContent = e.message;
    statusEl.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.textContent = "Code prüfen";
  }
}

function resumeFromVerified() {
  wizard.next();
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function updateSendCodeButton() {
  const email = document.getElementById("contact-email").value.trim();
  const btn = document.getElementById("btn-send-code");
  if (!btn) return;
  if (isValidEmail(email)) {
    btn.classList.add("btn-pulse");
  } else {
    btn.classList.remove("btn-pulse");
  }
}

// Init
initPage();

// Email input listener for send-code button animation
document.addEventListener("DOMContentLoaded", () => {
  if (typeof updateDomTranslations === "function") updateDomTranslations();
  const emailInput = document.getElementById("contact-email");
  if (emailInput) {
    emailInput.addEventListener("input", updateSendCodeButton);
    // initial check in case browser autofill
    updateSendCodeButton();
  }
});

function saveNotesAndSubmit() {
  const data = collectNotes();
  if (encounterId) {
    fetch(API + "/api/anamnese/" + encounterId + "/notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).catch(function(e){ console.error("Speichern fehlgeschlagen", e); });
  }
  submitFinal();
}

// ─── Review & Submit ──────────────────────────────────────────── ────────────────────────────────────────────
async function buildReview() {
  const T = (k, fallback) => (typeof t === "function" ? t(k) : null) || fallback || k;
  const items = [
    { label: T("screen.language.title", "Sprache"), cat: "language" },
    { label: T("screen.origin.title", "Herkunft"), cat: "origin" },
    { label: T("screen.family_status.title", "Familienstand"), cat: "family_status" },
    { label: T("screen.children.title", "Kinder"), cat: "children" },
    { label: T("screen.job.title", "Beruf"), cat: "job" },
    { label: T("screen.insurance.title", "Versicherung"), cat: "insurance" },
    { label: T("screen.symptoms.title", "Beschwerden"), cat: "symptoms" },
    { label: T("screen.duration.title", "Dauer"), cat: "duration" },
    { label: T("screen.conditions.title", "Vorerkrankungen"), cat: "conditions" },
    { label: T("screen.operations.title", "Operationen"), cat: "operations" },
    { label: T("screen.meds_bloodthin.title", "Blutverdünnung"), cat: "meds_bloodthin" },
    { label: T("screen.meds_bp.title", "Blutdrucksenker"), cat: "meds_bp" },
    { label: T("screen.meds_asthma.title", "Asthma/COPD"), cat: "meds_asthma" },
    { label: T("screen.meds_diabetes.title", "Diabetes"), cat: "meds_diabetes" },
    { label: T("screen.meds_neuro.title", "Neurologisch"), cat: "meds_neuro" },
    { label: T("screen.meds_pain.title", "Schmerzmittel"), cat: "meds_pain" },
    { label: T("screen.meds_gynuro.title", "Gynäkologie/Urologie"), cat: "meds_gynuro" },
    { label: T("screen.meds_chol.title", "Cholesterinsenker"), cat: "meds_chol" },
    { label: T("screen.meds_other.title", "Sonstige Medikamente"), cat: "meds_other" },
    { label: T("screen.allergies.title", "Allergien"), cat: "allergies" },
    { label: T("screen.family.title", "Familienanamnese"), cat: "family" },
    { label: T("screen.lifestyle.title", "Lebensgewohnheiten"), cat: "lifestyle" },
    { label: T("screen.lifestyle2.title", "Lebensgewohnheiten (2)"), cat: "lifestyle2" },
    { label: T("screen.emergency.title", "Notfallkontakt"), cat: "emergency" },
    { label: T("screen.bodymetrics.title", "Körpermaße"), cat: "bodymetrics" },
    { label: T("screen.contact.title", "Kontaktdaten"), cat: "contact" },
    { label: T("screen.notes.title", "Zusätzliche Infos"), cat: "notes" }
  ];
  // Server-Fallback: load missing data when coming from Magic-Link / new tab
  if (encounterId) {
    const missing = items.some(it => !sessionStorage.getItem("myhistoree_" + it.cat));
    if (missing) {
      try {
        const res = await fetch(`${API}/api/anamnese/${encounterId}/responses`);
        if (res.ok) {
          const responses = await res.json();
          restoreFormData(responses);
        }
      } catch(e) { console.error("Review server load failed", e); }
    }
  }
  let html = "";
  let complete = 0;
  items.forEach(it => {
    const saved = sessionStorage.getItem("myhistoree_" + it.cat);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.__completed) {
          html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#22c55e;">${T("label.saved", "Gespeichert")}</span></div>`;
          // Expand contact details inline
          if (it.cat === "contact") {
            if (data.mobile) html += `<div class="review-detail">&nbsp;&nbsp;Mobil: ${escapeHtml(data.mobile)}</div>`;
            if (data.landline) html += `<div class="review-detail">&nbsp;&nbsp;Festnetz: ${escapeHtml(data.landline)}</div>`;
            if (data.email) {
              const verified = data.email_verified ? "verifiziert" : "nicht verifiziert";
              html += `<div class="review-detail">&nbsp;&nbsp;E-Mail: ${escapeHtml(data.email)} <span style="font-size:0.8rem;color:#64748b;">(${verified})</span></div>`;
            }
          }
          // Expand bodymetrics inline
          if (it.cat === "bodymetrics") {
            if (data.height_cm) html += `<div class="review-detail">&nbsp;&nbsp;Größe: ${data.height_cm} cm</div>`;
            if (data.weight_kg) html += `<div class="review-detail">&nbsp;&nbsp;Gewicht: ${data.weight_kg} kg</div>`;
          }
          complete++;
        }
        else { html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#f59e0b;">${T("label.draft", "Entwurf")}</span></div>`; }
      } catch(e) {
        html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#f59e0b;">Entwurf</span></div>`;
      }
    } else {
      html += `<div class="review-item"><strong>${it.label}</strong> — <span style="color:#94a3b8;">${T("label.empty", "Nicht ausgefüllt")}</span></div>`;
    }
  });
  const progressText = T("progress.text", "{complete} von {total} abgeschlossen").replace("{complete}", complete).replace("{total}", items.length);
  html += `<div style="margin-top:12px;padding:10px;background:#dbeafe;border-radius:8px;font-size:0.9rem;">${complete}/${items.length} ${progressText}</div>`;
  document.getElementById("review-content").innerHTML = html;
}

async function submitFinal() {
  console.log("[submitFinal] start, encounterId=" + encounterId);
  if (!encounterId) { alert("Keine Session. Bitte starten Sie neu."); return; }
  const consentBox = document.getElementById("dsgvo-consent");
  const consent = consentBox ? consentBox.checked : false;
  console.log("[submitFinal] consent=" + consent);
  if (!consent) { alert("Bitte stimmen Sie der Datenschutzerklärung zu."); return; }
  try {
    const res = await fetch(`${API}/api/anamnese/${encounterId}/complete`, { method: "POST" });
    console.log("[submitFinal] complete status=" + res.status);
    if (!res.ok) throw new Error("Server antwortete mit " + res.status);
    document.getElementById("done-pvs-id").textContent = linkData?.pvsPatientId || "—";
        document.getElementById("done-title").textContent = "Anamnese abgeschickt!";
    document.getElementById("done-message").textContent = "Vielen Dank. Ihre Angaben wurden sicher an die Praxis übermittelt.";
    document.getElementById("done-help").textContent = "Sie können dieses Fenster nun schließen.";
    wizard.goTo("done");
  } catch(e) {
    console.error("[submitFinal] error", e);
    alert("Fehler: " + e.message);
  }
}

async function rejectAnamnese() {
  if (!encounterId) { alert("Keine Session. Bitte starten Sie neu."); return; }
  if (!confirm("Möchten Sie wirklich ablehnen? Alle eingegebenen Daten werden unwiderruflich gelöscht.")) return;
  try {
    await fetch(`${API}/api/anamnese/${encounterId}/reject`, { method: "POST" });
    document.getElementById("done-pvs-id").textContent = linkData?.pvsPatientId || "\u2014";
    document.getElementById("done-icon").textContent = "\u2715";
    document.getElementById("done-icon").style.background = "#ef4444";
    document.getElementById("done-title").textContent = "Anamnese abgelehnt";
    document.getElementById("done-message").textContent = "Ihre Anamnese wurde abgebrochen.";
    document.getElementById("done-help").textContent = "Sie können dieses Fenster nun schließen.";
    wizard.goTo("done");
  } catch(e) {
    alert("Fehler: " + e.message);
  }
}
