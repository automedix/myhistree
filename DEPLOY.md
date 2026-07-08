# myhistree Deploy Workflow

## Grundregel
- **.190** (Staging) = Entwicklung & Test. Nur .190 macht `git push`.
- **.237** (Production) = nur `git pull` + `docker compose`. Kein Coding auf .237.

## 1. Feature entwickeln (auf .190)
```bash
ssh root@localhost -p 8822   # via .237 Tunnel
cd /opt/myhistoree
# ... edit files ...
git add -A
git commit -m "feat: dein Feature"
git push origin main
```

## 2. Auf .237 ausrollen
```bash
ssh root@87.106.23.237
cd /opt/myhistree
bash deploy.sh
```

> Das Skript holt `origin/main`, baut TypeScript, baut das Docker-Image und
> startet den Container neu. Kein manuelles SCP mehr.

## 3. Hotfix auf .237 (nur wenn .190 nicht erreichbar)
```bash
ssh root@87.106.23.237
cd /opt/myhistree
# ... edit directly ...
git add -A
git commit -m "hotfix: beschreibung"
git push origin main
# Danach sofort auf .190 pullen:
# ssh .190 && cd /opt/myhistoree && git pull
```

## Umgebungsunterschiede (wichtig)
| | .190 Staging | .237 Produktion |
|---|---|---|
| Verzeichnis | `/opt/myhistoree` | `/opt/myhistree` |
| Git-Remote | `https://x-access-token:…@github.com/automedix/myhistree.git` | `https://x-access-token:…@github.com/automedix/myhistree.git` |

## Datenbank
- `.gitignore` schließt `data/` aus – DB wird niemals über Git synchronisiert.
- **DB-Name** in `server/src/db/index.ts` ist `myhistoree.db` (beide Systeme).
- **Docker Compose** überschreibt `DB_PATH` auf beide Systemen gleich.
