# Terminmanager — Implementierungsplan

## Ziel
Praxis kann Termine für Patienten bei externen Einrichtungen anfragen und über myhistree zur Verfügung stellen. Patient bestätigt Kenntnisnahme per DOB-verifiziertem Link.

---

## Architektur-Entscheidung

### Gewählter Ansatz: Option 1 (Direktversand) + Option 2 (Einrichtungs-Link) als erweiterte Phase

**Phase 1:** Option 1 implementieren (Praxis erstellt vollständigen Termin → Link an Patient)  
**Phase 2:** Option 2 erweitern (Praxis erstellt Vorlage → Einrichtung füllt aus → Patient erhält finalen Link)

---

## Datenmodell (SQLite)

### Tabelle: `appointments`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `id` | TEXT PK | UUID |
| `practice_id` | TEXT | z.B. 'demo-practice' |
| `patient_firstname` | TEXT | |
| `patient_lastname` | TEXT | |
| `patient_dob` | TEXT | TT.MM.JJJJ für Verifikation |
| `patient_email` | TEXT | optional |
| `title` | TEXT | Terminbezeichnung |
| `facility_name` | TEXT | Einrichtung (Praxis, KH, etc.) |
| `facility_location` | TEXT | Anmeldepunkt (Leitstelle, Patientenaufnahme) |
| `appointment_date` | TEXT | YYYY-MM-DD |
| `appointment_time` | TEXT | HH:MM |
| `notes` | TEXT | Hinweise (sanitized, Code-Injection-proof) |
| `checkmarks` | TEXT | JSON-Array: ["versichertenkarte","ueberweisung","nuechtern"] |
| `status` | TEXT | pending / acknowledged / cancelled |
| `created_at` | TEXT | ISO-Datetime |
| `acknowledged_at` | TEXT | ISO-Datetime |
| `created_by` | TEXT | 'practice' oder 'facility' |
| `template_mode` | INTEGER | 0 = vollständig (Phase 1), 1 = Vorlage (Phase 2) |
| `facility_link_token` | TEXT | UUID für Einrichtungs-Link (Phase 2) |

### Tabelle: `appointment_links`
(Für Audit-Trail, wer welchen Link wann geöffnet hat — optional Phase 3)

---

## Backend-Endpunkte (Fastify /api)

### Admin-Endpunkte (x-session-token required)

| Methode | Endpoint | Beschreibung |
|---------|----------|-------------|
| POST | `/api/admin/appointments` | Termin erstellen |
| GET | `/api/admin/appointments` | Alle Termine der Praxis |
| GET | `/api/admin/appointments/:id` | Einzelnen Termin abrufen |
| PUT | `/api/admin/appointments/:id` | Termin bearbeiten |
| DELETE | `/api/admin/appointments/:id` | Termin stornieren |
| POST | `/api/admin/appointments/:id/link` | Patienten-Link generieren |
| POST | `/api/admin/appointments/:id/facility-link` | Einrichtungs-Link generieren (Phase 2) |

### Patienten-Endpunkte (öffentlich, DOB-Verifikation)

| Methode | Endpoint | Beschreibung |
|---------|----------|-------------|
| GET | `/api/patient/appointments/:id/public` | Öffentliche Termin-Daten (ohne DOB) |
| POST | `/api/patient/appointments/:id/verify` | DOB prüfen, Session-Token zurück |
| POST | `/api/patient/appointments/:id/acknowledge` | Kenntnisnahme bestätigen |
| GET | `/api/patient/appointments/:id/ics` | ICS-Datei download |

### Einrichtungs-Endpunkte (Phase 2)

| Methode | Endpoint | Beschreibung |
|---------|----------|-------------|
| GET | `/api/facility/appointments/:token` | Vorlage abrufen (via facility_link_token) |
| POST | `/api/facility/appointments/:token` | Vorlage ausfüllen & finalisieren |

---

## Frontend-Seiten

### 1. Admin: Termin-Übersicht `/admin/appointments/index.html`
- Liste aller Termine mit Farbcodierung
- Button: Neuen Termin erstellen
- Button: Link kopieren / Per Email versenden
- Status-Filter: Alle / Pending / Acknowledged / Cancelled

### 2. Admin: Termin erstellen/bearbeiten `/admin/appointments/edit.html`
- Formularfelder:
  - Patient: Vorname, Nachname, DOB, Email (optional)
  - Termin: Titel, Datum, Uhrzeit
  - Einrichtung: Name, Anmeldepunkt
  - Checkmarks: ☑ Versichertenkarte, ☑ Überweisung, ☑ Einweisung, ☑ Nüchtern, ☑ Sonstiges (Freitext)
  - Hinweise: Freitext-Area (HTML-escaped, max 500 Zeichen)
- Button-Modi:
  - "Direkt an Patient versenden" → Option 1
  - "Link für Einrichtung erstellen" → Option 2

### 3. Patienten-Seite: `/termin.html?id={appointment_id}`
- Schritt 1: DOB-Eingabe → Verifikation
- Schritt 2: Termindaten anzeigen:
  - Titel, Datum, Uhrzeit
  - Einrichtung + Anmeldepunkt
  - Checkmarks als Liste mit Häkchen
  - Hinweise (escaped HTML)
- Aktionen:
  - Button: "Termin zur Kenntnis genommen" → POST acknowledge
  - Button: "Zum Kalender hinzufügen (ICS)" → Download .ics
  - Button: "Termin ausdrucken" → Print-CSS
- Nach Acknowledge: Grüne Bestätigung + ICS-Download bleibt verfügbar

### 4. Einrichtungs-Seite (Phase 2): `/facility/termin.html?token={facility_token}`
- Zeigt Patientennamen (ohne DOB) + Titel
- Eingabefelder: Datum, Uhrzeit, Checkmarks, Hinweise
- Button: "Termin finalisieren & an Patient senden"
- Nach Absenden: Bestätigung + Hinweis, dass Patient benachrichtigt wird

---

## Farbcodierung (Admin-Liste)

| Status | Farbe | Bedingung |
|--------|-------|-----------|
| 🟢 Grün | `acknowledged` | Patient hat Kenntnis genommen |
| 🟡 Gelb | `pending` + > 2 Tage bis Termin | Noch nicht bestätigt |
| 🔴 Rot | `pending` + ≤ 2 Tage bis Termin | Dringend — nicht bestätigt |
| ⚪ Grau | `cancelled` | Storniert |

---

## Sicherheitsmaßnahmen

1. **DOB-Verifikation** — Gleiches Schema wie Atteste (Session-Token in localStorage)
2. **HTML-Escaping** — Alle Freitext-Felder (Hinweise, Einrichtungsname) via `textContent` oder DOMPurify
3. **No-Code-Injection** — Kein `innerHTML` mit Benutzerdaten; Template-Literals nur mit escapten Werten
4. **Rate-Limiting** — 5 Versuche pro IP für DOB-Verifikation (1-Minuten-Fenster)
5. **UUIDs** — Nicht sequentielle IDs für Appointments (kein Scraping)

---

## ICS-Format (Kalender-Datei)

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hausärzte im Grillepark//Terminmanager//DE
BEGIN:VEVENT
DTSTART:20260915T090000
DTEND:20260915T093000
SUMMARY:Termin: MRT LWS
LOCATION:Radiologie Minden, Leitstelle 2
DESCRIPTION:Hinweise: Bitte nüchtern erscheinen.\nMitbringen: Versichertenkarte, Überweisung
END:VEVENT
END:VCALENDAR
```

---

## Print-Layout (Patientenseite)

- Print-CSS: Weißer Hintergrund, schwarze Schrift
- Header: Praxis-Logo / Name
- Termindaten in Boxen
- QR-Code zum Link (optional Phase 2)
- Footer: "Ausgedruckt am {Datum}"

---

## Implementierungs-Reihenfolge

### Phase 1: MVP (geschätzt 2-3 Stunden)
1. DB-Migration: `appointments`-Tabelle erstellen
2. Backend: Admin-CRUD-Endpunkte
3. Backend: Patienten-Endpunkte (public, verify, acknowledge, ics)
4. Frontend: `termin.html` (Patienten-Seite)
5. Frontend: Admin-Tab in bestehendem Admin-Panel
6. Test: E2E-Flow mit DOB-Verifikation

### Phase 2: Einrichtungs-Link (geschätzt 1-2 Stunden)
7. Backend: `facility_link_token` + Einrichtungs-Endpunkte
8. Frontend: `facility/termin.html`
9. Admin: Option "Link für Einrichtung erstellen"
10. Test: Praxis → Einrichtung → Patient Flow

### Phase 3: Erweiterungen (optional)
11. Email-Versand (wie Atteste)
12. SMS-Benachrichtigung (Twilio?)
13. QR-Code auf Print-Version
14. Kalender-Integration (Google Calendar API?)

---

## Offene Fragen

1. **Soll Phase 1 (Direktversand) zuerst implementiert werden?**
2. **Soll die Admin-UI ein neuer Tab im bestehenden Admin-Panel sein oder eine separate Seite wie Atteste?**
3. **Email-Versand gleich mit einbauen oder später?**
4. **Soll der Patient nach Acknowledge eine Bestätigungs-Email bekommen?**

---

*Plan erstellt: 2026-09-01*  
*Autor: Hermes Agent*  
*Status: Review ausstehend*
