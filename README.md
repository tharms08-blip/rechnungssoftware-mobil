# Rechnungssoftware mobil

Die Handy-Seite der Rechnungssoftware – eine Web-App für den Home-Bildschirm (iPhone/Android):

- **Fahrten** erfassen, einem Auftrag (Rechnung) zugeordnet oder als allgemeine Fahrt
- **Ausgaben** erfassen, mit Belegfoto aus der Kamera
- **Rechnungen** ansehen und als bezahlt markieren
- **Überblick**: Einnahmen, Ausgaben, Fahrtkosten (0,30 €/km) und Gewinn des Jahres

Rechnungen geschrieben werden weiterhin am Rechner.

## Wo die Daten liegen

Dieser Ordner enthält **nur Programmcode** – keine Daten, keine Zugangsdaten. Er darf
öffentlich sein (z. B. für GitHub Pages).

Die Daten liegen auf dem Gerät und – verschlüsselt – in einem **privaten** GitHub-Repository,
das jeder Nutzer selbst besitzt. Verschlüsselt wird im Browser (AES-256-GCM, Schlüssel aus
dem Passwort per PBKDF2), bevor irgendetwas das Gerät verlässt. Repository, Token und
Passwort gibt der Nutzer in der App ein; sie bleiben auf dem Gerät. Die App spricht mit
keinem anderen Server als `api.github.com` (in `index.html` per Content-Security-Policy
festgelegt) und lädt keinen fremden Code.

Format und Regeln des Abgleichs: `MOBIL_SYNC.md` im Desktop-Projekt.

## Aufbau

```
index.html, app.css          Seite und Gestaltung
js/app.js                    Oberfläche
js/zustand.js, js/db.js      Daten im Arbeitsspeicher und auf dem Gerät (IndexedDB)
js/sync.js, js/github.js     Abgleich mit dem Repository
js/krypto.js, js/format.js   Verschlüsselung, gemeinsames Datenformat
sw.js, manifest.webmanifest  Start ohne Netz, Symbol für den Home-Bildschirm
icons/                       erzeugt mit werkzeuge/symbole_erzeugen.py im Desktop-Projekt
```

Kein Build-Schritt, keine Abhängigkeiten: Die Dateien werden so ausgeliefert, wie sie hier liegen.

## Veröffentlichen (GitHub Pages)

1. Auf GitHub ein Repository anlegen, z. B. `rechnungssoftware-mobil` (öffentlich – mit
   einem kostenlosen Konto geht GitHub Pages nur aus öffentlichen Repositories).
2. Den **Inhalt** dieses Ordners hochladen.
3. Im Repository: *Settings → Pages → Deploy from a branch → `main` / `(root)` → Save*.
4. Nach ein, zwei Minuten ist die App unter `https://<konto>.github.io/rechnungssoftware-mobil/` erreichbar.

**Nach jeder Änderung** die Versionsnummer in `sw.js` (`VERSION`) und `js/format.js`
(`APP_VERSION`) hochzählen – sonst behalten die Geräte die alten Dateien im Vorrat.

## Lokal ausprobieren

Mit der GitHub-Attrappe aus dem Desktop-Projekt (kein echtes Repository nötig):

```bash
python3 werkzeuge/github_attrappe.py --port 8765 --seiten ../../Rechnungssoftware_Mobil
```

Dann `http://127.0.0.1:8765/` öffnen, siehe `MOBIL_SYNC.md` („Testen ohne Internet").

## Nie hier hinein

Daten, Fotos, Token, Passwörter, `.enc`-Dateien. Die `.gitignore` fängt das Gröbste ab.
