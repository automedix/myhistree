# 🏥 myhistree

> Digitale Patientenanamnese für Arztpraxen – sicher, barrierefrei, DSGVO-konform.

[![Version](https://img.shields.io/badge/version-0.6.6-blue.svg)](https://github.com/automedix/myhistree)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/deploy-Docker-2496ed.svg)](docker-compose.yml)

---

## ✨ Was ist myhistree?

**myhistree** ist eine webbasierte Anwendung zur digitalen Erfassung von Patientenanamnesen. Arztpraxen können Patienten vor dem Termin einen personalisierten Link per E-Mail oder QR-Code zusenden. Der Patient füllt die Anamnese bequem auf Smartphone, Tablet oder Desktop aus – die Praxis erhält die Daten strukturiert und kann sie in den Praxis-Workflow integrieren.

### Kernziele

- **Effizienz:** Weniger Wartezeit, bessere Vorbereitung auf den Patienten
- **Datenschutz:** Ende-zu-Ende-Verschlüsselung, keine Cloud-Abhängigkeit
- **Barrierefreiheit:** Klare Typografie, hoher Kontrast, mobile-first
- **Neutralität:** Praxis-unabhängig einsetzbar, kein Branded „Praxis-XYZ"-Look

---

## 🏗️ Architektur

```
myhistree/
├── server/              # Node.js + Fastify Backend (TypeScript)
│   ├── src/
│   │   ├── db/          # SQLite Schema & Queries (better-sqlite3)
│   │   ├── email/       # SMTP-Versand (nodemailer)
│   │   ├── routes/      # API & Auth Endpoints
│   │   └── index.ts     # Server-Einstieg
│   └── dist/            # Kompiliere JS (npm run build)
├── web/                 # Statisches Frontend (Vanilla JS + CSS)
│   ├── index.html       # Patienten-Anamnese (SPA)
│   ├── admin/           # Praxis-Admin Panel
│   ├── js/              # Client-Side JavaScript
│   └── css/             # Stylesheets
├── data/                # SQLite Datenbank (Docker-Volume)
├── Dockerfile           # Multi-Stage Build
└── docker-compose.yml   # Produktions-Deployment
```

### Tech-Stack

| Schicht | Technologie |
|---------|-------------|
| **Runtime** | Node.js 22 (Alpine) |
| **Framework** | Fastify 4 |
| **Datenbank** | SQLite 3 (better-sqlite3) |
| **Auth** | JWT (access_token Cookie), bcrypt, TOTP-ready |
| **E-Mail** | nodemailer (SMTP) |
| **Frontend** | Vanilla ES6, kein Build-Step |
| **Container** | Docker + Docker Compose |

---

## 🚀 Quickstart

### Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- SMTP-Zugangsdaten für E-Mail-Versand

### 1. Klonen

```bash
git clone https://github.com/automedix/myhistree.git
cd myhistree
```

### 2. Umgebungsvariablen

```bash
cp .env.example .env
# .env anpassen:
#   JWT_SECRET=<stark...>
#   SMTP_HOST=smtp.example.com
#   SMTP_USER=mail@example.com
#   SMTP_PASS=password
#   EMAIL_FROM_NAME="Myhistree Anamnese"
#   EMAIL_REPLY_TO=praxis@example.com
```

### 3. Starten

```bash
docker compose up -d --build
```

Die Anwendung ist dann unter `http://localhost:3456` erreichbar.

### 4. Erst-Login

- Admin-Panel: `http://localhost:3456/admin`
- Standard-Admin wird beim ersten Start automatisch angelegt (siehe Logs)

---

## 📋 Workflow

### Für die Praxis (Admin)

1. **Anmelden** im Admin-Panel
2. **Patient anlegen** (PVS-Patienten-ID, Geburtsdatum, E-Mail, optional PIN)
3. **Link versenden** per E-Mail oder QR-Code generieren
4. **Anamnese einsehen** sobald der Patient sie abgeschickt hat

### Für den Patienten

1. **E-Mail erhalten** mit personalisiertem Link
2. **E-Mail bestätigen** via Verifizierungscode (30 min gültig)
3. **Anamnese ausfüllen** – medizinische Vorgeschichte, Symptome, Medikamente etc.
4. **Absenden** – Daten werden verschlüsselt an die Praxis übermittelt

---

## 🔒 Sicherheit & Datenschutz

- **Security Headers** (CSP, HSTS, X-Frame-Options, …)
- **Rate-Limiting** auf API-Endpunkten
- **JWT-Cookies** mit httpOnly-fähigem Setup
- **E-Mail-Verifizierung** vor Anamnese-Start
- **SQLite** bleibt im Container/Volume – keine externe Datenbank nötig
- **DSGVO-konform:** Daten bleiben unter Kontrolle der Praxis

---

## 🛠️ Entwicklung

### Lokale Entwicklung (ohne Docker)

```bash
cd myhistree
npm install
npm run build
npm start
```

### Build

```bash
npm run build    # TypeScript → dist/
```

### Datenbank

SQLite-Datenbank liegt standardmäßig unter `./data/myhistree.db`. Das Schema wird automatisch beim Start initialisiert.

---

## 🐳 Docker-Deployment

### Produktion

```bash
docker compose -f docker-compose.yml up -d --build
```

### Staging

```bash
# Beispiel mit separaten Environment-Variablen
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

---

## 📄 Lizenz

Dieses Projekt steht unter der **GPL-3.0** Lizenz.

Siehe [LICENSE](LICENSE) für Details.

---

## 🤝 Mitwirken

Bug Reports und Feature Requests gerne als [GitHub Issue](https://github.com/automedix/myhistree/issues). Pull Requests sind willkommen!

---

<p align="center">
  <sub>Built with ❤️ for better healthcare workflows.</sub>
</p>
