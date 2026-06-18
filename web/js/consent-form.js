// myhistree Consent Form – Patient View v0.6.8g
(function () {
  'use strict';

  const API = '';
  const m = window.location.pathname.match(new RegExp("/auff?klaerung(?:\\.html)?/([a-f0-9-]{32,})")) || window.location.search.match(/[?&]token=([a-f0-9-]{32,})/);
  const token = m ? m[1] : null;
  if (!token) { showError('Ungültiger Link'); return; }

  const els = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error-screen'),
    already: document.getElementById('already-submitted'),
    auth: document.getElementById('auth-screen'),
    authDob: document.getElementById('auth-dob'),
    authPin: document.getElementById('auth-pin'),
    authPinGroup: document.getElementById('auth-pin-group'),
    authSubmit: document.getElementById('auth-submit'),
    authError: document.getElementById('auth-error'),
    consent: document.getElementById('consent-screen'),
    success: document.getElementById('success-screen'),
    formContent: document.getElementById('form-content'),
    formTitle: document.getElementById('form-title'),
    pvsId: document.getElementById('pvs-id'),
    nameInput: document.getElementById('patient-name'),
    canvas: document.getElementById('signature-pad'),
    clearBtn: document.getElementById('clear-sig'),
    submitBtn: document.getElementById('submit-consent'),
    timeHint: document.getElementById('time-hint'),
    scrollInd: document.getElementById('scroll-indicator'),
    submitHint: document.getElementById('submit-hint'),
    nameHint: document.getElementById('name-hint'),
    sigHint: document.getElementById('sig-hint'),
    ipHint: document.getElementById('ip-hint'),
  };

  let encounterId = null;
  let hasScrolledToBottom = false;
  let isDrawing = false;
  let hasSignature = false;
  let currentLinkData = null;
  let consentChecks = []; // track checkboxes
  const consentCheckState = new Map();

  function sanitizeConsentHtml(raw) {
    if (!raw) return '<p>Kein Inhalt verfügbar.</p>';
    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    ['script','iframe','object','embed','style','link','meta','base','form','input','textarea','button'].forEach(tag => {
      tpl.content.querySelectorAll(tag).forEach(n => n.remove());
    });
    tpl.content.querySelectorAll('*').forEach(node => {
      for (const attr of [...node.attributes]) {
        if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
          node.removeAttribute(attr.name);
        }
      }
    });
    return tpl.innerHTML;
  }

  // ─── Init ───
  async function init() {
    try {
      // Step 1: Validate link
      const valRes = await fetch(`${API}/api/link/validate/${token}`);
      if (!valRes.ok) {
        const err = await valRes.json().catch(() => ({}));
        if (err.error !== 'Link already used') {
          throw new Error(err.error || 'Ungültiger oder abgelaufener Link');
        }
      }
      const linkData = valRes.ok ? await valRes.json() : null;
      currentLinkData = linkData;

      // Link already used but not completed — try loading encounter directly
      if (linkData && linkData.resume) {
        return loadEncounter();
      }

      // Already submitted?
      if (linkData && linkData.status === 'used') {
        // Check if already submitted via encounter
        const encRes = await fetch(`${API}/api/encounter-by-token/${token}`);
        if (encRes.ok) {
          const enc = await encRes.json();
          if (enc.alreadySubmitted) {
            showAlreadySubmitted(enc.submittedAt);
            return;
          }
        }
      }

      // Show auth screen with DOB/PIN form
      els.loading.classList.add('hidden');
      els.auth.classList.remove('hidden');

      // Show PIN field if required
      if (linkData && linkData.has_pin) {
        els.authPinGroup.classList.remove('hidden');
      }

      // Prefill DOB if available
      if (linkData && linkData.patient_dob) {
        const parts = linkData.patient_dob.split('-');
        if (parts.length === 3) {
          els.authDob.value = `${parts[2]}-${parts[1]}-${parts[0]}`; // dd-mm-yyyy -> yyyy-mm-dd
        }
      }

      els.authSubmit.addEventListener('click', handleAuthSubmit);
      els.authDob.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
      els.authPin.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
    } catch (err) {
      console.error('[consent-form]', err);
      showError(err.message || 'Dieser Link ist ungültig oder bereits abgelaufen.');
    }
  }

  async function handleAuthSubmit() {
    els.authError.textContent = '';
    const dobVal = els.authDob.value;
    if (!dobVal) {
      els.authError.textContent = 'Bitte geben Sie Ihr Geburtsdatum ein.';
      return;
    }

    const startPayload = { token };
    // Format: YYYY-MM-DD (from date input)
    startPayload.patientDob = dobVal.replace(/\./g, '-');

    if (currentLinkData && currentLinkData.has_pin) {
      const pin = els.authPin.value.trim();
      if (!pin) {
        els.authError.textContent = 'Bitte geben Sie die PIN ein.';
        return;
      }
      startPayload.pin = pin;
    }

    els.authSubmit.disabled = true;
    els.authSubmit.textContent = 'Wird geprüft…';

    try {
      const startRes = await fetch(`${API}/api/link/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startPayload)
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        els.authSubmit.disabled = false;
        els.authSubmit.textContent = 'Aufklärungsbogen öffnen';
        els.authError.textContent = err.error || 'Fehler beim Öffnen. Bitte überprüfen Sie Ihre Angaben.';
        return;
      }

      // Auth success — hide auth, show consent
      els.auth.classList.add('hidden');
      await loadEncounter();
    } catch (err) {
      console.error('[auth-submit]', err);
      els.authSubmit.disabled = false;
      els.authSubmit.textContent = 'Aufklärungsbogen öffnen';
      els.authError.textContent = 'Netzwerkfehler. Bitte versuchen Sie es erneut.';
    }
  }

  async function loadEncounter() {
    try {
      const res = await fetch(`${API}/api/encounter-by-token/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ungültiger oder abgelaufener Link');
      }
      const data = await res.json();
      if (data.document_type !== 'consent_form') throw new Error('Kein Aufklärungsbogen');

      if (data.alreadySubmitted) {
        showAlreadySubmitted(data.submittedAt);
        return;
      }

      encounterId = data.id;
      els.formTitle.textContent = data.consent_title || 'Aufklärungsbogen';
      els.pvsId.textContent = data.pvs_patient_id || '–';
      els.formContent.innerHTML = sanitizeConsentHtml(data.consent_html);
      els.timeHint.textContent = new Date().toLocaleString('de-DE');
      els.ipHint.textContent = 'wird übermittelt';

      setupConsentChecks();
      setupScrollTracking();
      setupValidation();

      els.loading.classList.add('hidden');
      els.consent.classList.remove('hidden');

      // Canvas erst initialisieren, nachdem es sichtbar ist,
      // sonst liefert getBoundingClientRect() 0×0 und das Backing-Store bleibt leer.
      requestAnimationFrame(setupCanvas);
    } catch (err) {
      console.error('[load-encounter]', err);
      showError(err.message || 'Fehler beim Laden des Bogens.');
    }
  }

  // ─── Consent Checkboxes ───
  function setupConsentChecks() {
    consentChecks = Array.from(els.formContent.querySelectorAll('input.consent-check[type="checkbox"]'));
    consentChecks.forEach((cb) => {
      consentCheckState.set(cb.dataset.item || cb.name, cb.checked);
      cb.addEventListener('change', () => {
        consentCheckState.set(cb.dataset.item || cb.name, cb.checked);
        checkEnableSubmit();
      });
    });
  }

  function allConsentChecksOk() {
    if (!consentChecks.length) return true;
    return consentChecks.every((cb) => cb.checked);
  }

  function collectConsentItems() {
    if (!consentChecks.length) return null;
    return consentChecks.map((cb) => ({
      item: cb.dataset.item || cb.name,
      label: cb.closest('label')?.textContent?.trim() || '',
      checked: cb.checked
    }));
  }

  function showError(msg) {
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('consent-screen')?.classList.add('hidden');
    document.getElementById('already-submitted')?.classList.add('hidden');
    document.getElementById('success-screen')?.classList.add('hidden');
    const el = document.getElementById('error-message');
    if (el) el.textContent = msg;
    document.getElementById('error-screen')?.classList.remove('hidden');
  }

  function showAlreadySubmitted(at) {
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('consent-screen')?.classList.add('hidden');
    document.getElementById('error-screen')?.classList.add('hidden');
    const atEl = document.getElementById('already-submitted-at');
    if (atEl && at) atEl.textContent = new Date(at).toLocaleString('de-DE');
    document.getElementById('already-submitted')?.classList.remove('hidden');
  }

  // ─── Scroll-Tracking ───
  function setupScrollTracking() {
    // Check if document is scrolled to bottom
    const lastEl = els.formContent.lastElementChild;
    if (!lastEl) { hasScrolledToBottom = true; return; }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        hasScrolledToBottom = true;
        els.scrollInd?.classList.add('scrolled-away');
        checkEnableSubmit();
      }
    }, { threshold: 0.3, rootMargin: '0px 0px 60px 0px' });
    observer.observe(lastEl);

    // Also check on scroll directly
    window.addEventListener('scroll', () => {
      const scrollPos = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      if (scrollPos >= docHeight - 100 && !hasScrolledToBottom) {
        hasScrolledToBottom = true;
        els.scrollInd?.classList.add('scrolled-away');
        checkEnableSubmit();
      }
    }, { passive: true });
  }

  // ─── Canvas Signature ───
  function setupCanvas() {
    const ctx = els.canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = els.canvas.getBoundingClientRect();
    els.canvas.width = rect.width * dpr;
    els.canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e) => {
      const rect = els.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left),
        y: (clientY - rect.top)
      };
    };

    const start = (e) => {
      isDrawing = true;
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      hasSignature = true;
      els.canvas.classList.add('has-signature');
      if (els.sigHint) els.sigHint.textContent = '✅ Unterschrift erfasst';
      checkEnableSubmit();
    };
    const end = () => { isDrawing = false; };

    els.canvas.addEventListener('mousedown', start);
    els.canvas.addEventListener('mousemove', move);
    els.canvas.addEventListener('mouseup', end);
    els.canvas.addEventListener('mouseleave', end);
    els.canvas.addEventListener('touchstart', start, { passive: false });
    els.canvas.addEventListener('touchmove', move, { passive: false });
    els.canvas.addEventListener('touchend', end);
    els.canvas.addEventListener('touchcancel', end);

    els.clearBtn.addEventListener('click', () => {
      const rect = els.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      hasSignature = false;
      els.canvas.classList.remove('has-signature');
      if (els.sigHint) els.sigHint.textContent = 'Bitte unten im Feld unterschreiben';
      checkEnableSubmit();
    });
  }

  // ─── Validation ───
  function setupValidation() {
    els.nameInput.addEventListener('input', () => {
      const val = els.nameInput.value.trim();
      if (val.length >= 2) {
        els.nameHint.textContent = '✅ Name erfasst';
        els.nameHint.style.color = '#22c55e';
      } else {
        els.nameHint.textContent = 'Mindestens 2 Zeichen';
        els.nameHint.style.color = '#94a3b8';
      }
      checkEnableSubmit();
    });
    els.submitBtn.addEventListener('click', submitConsent);
  }

  function checkEnableSubmit() {
    const nameOk = els.nameInput.value.trim().length >= 2;
    const scrolled = hasScrolledToBottom;
    const signed = hasSignature;
    const checksOk = allConsentChecksOk();
    const canSubmit = scrolled && nameOk && signed && checksOk;
    els.submitBtn.disabled = !canSubmit;
    if (canSubmit) {
      els.submitHint.textContent = 'Sie können das Dokument jetzt absenden.';
      els.submitHint.style.color = '#22c55e';
    } else {
      const missing = [];
      if (!scrolled) missing.push('Rest des Textes lesen');
      if (!nameOk) missing.push('Namen eingeben');
      if (!signed) missing.push('Unterschreiben');
      if (!checksOk) missing.push('Alle Checkboxen setzen');
      els.submitHint.textContent = 'Noch benötigt: ' + missing.join(', ');
      els.submitHint.style.color = '#94a3b8';
    }
  }

  // ─── Submit ───
  async function submitConsent() {
    const btn = els.submitBtn;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Wird übermittelt…';

    const svg = canvasToSvg(els.canvas);
    try {
      const res = await fetch(`${API}/api/consent/${encounterId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: els.nameInput.value.trim(),
          signatureSvg: svg,
          consentItems: collectConsentItems(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fehler bei der Übermittlung');
      }
      els.consent.classList.add('hidden');
      els.success.classList.remove('hidden');
      // Scroll to top
      window.scrollTo(0, 0);
    } catch (err) {
      console.error('[consent-submit]', err);
      btn.disabled = false;
      btn.textContent = originalText;
      alert('Fehler bei der Übermittlung: ' + err.message);
    }
  }

  function canvasToSvg(canvas) {
    // Export canvas as base64 PNG inside an SVG wrapper
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const png = canvas.toDataURL('image/png');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}"><image href="${png}" width="${Math.round(w)}" height="${Math.round(h)}"/></svg>`;
  }

  // ─── Start ───
  init();
})();
