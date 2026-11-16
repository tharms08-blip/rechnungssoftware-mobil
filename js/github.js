// Zugriff auf das Sync-Repository über die GitHub-Schnittstelle.
// Gebraucht wird ein Fine-grained Token nur für dieses eine Repository
// (Berechtigung „Contents: Read and write").

import { b64 } from './krypto.js';

export class SpeicherFehler extends Error {}
export class KonfliktFehler extends SpeicherFehler {}

const GITHUB_API = 'https://api.github.com';

// Nur beim lokalen Ausprobieren (localhost) darf eine andere Adresse gelten –
// im echten Betrieb geht das Token ausschließlich an api.github.com.
export function apiBasis() {
  const lokal = ['localhost', '127.0.0.1'].includes(location.hostname);
  let test = null;
  try { test = lokal ? localStorage.getItem('rs_test_api') : null; } catch { /* egal */ }
  return test || GITHUB_API;
}

export class GitHub {
  constructor(repo, token) {
    repo = String(repo || '').trim().replace(/^\/+|\/+$/g, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      throw new SpeicherFehler('Das Repository muss in der Form „konto/name" angegeben werden.');
    }
    this.repo = repo;
    this.token = String(token || '').trim();
    this.zweig = null;
  }

  async anfrage(methode, pfad, { daten, roh = false, erlaubt = [] } = {}) {
    let antwort;
    try {
      antwort = await fetch(`${apiBasis()}/repos/${this.repo}${pfad}`, {
        method: methode,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: roh ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          ...(daten ? { 'Content-Type': 'application/json' } : {}),
        },
        body: daten ? JSON.stringify(daten) : undefined,
      });
    } catch {
      throw new SpeicherFehler('Keine Verbindung zu GitHub. Besteht eine Internetverbindung?');
    }
    if (antwort.ok) return roh ? new Uint8Array(await antwort.arrayBuffer()) : antwort.json();
    if (erlaubt.includes(antwort.status)) return { status: antwort.status };
    let meldung = '';
    try { meldung = (await antwort.json()).message || ''; } catch { /* egal */ }
    if (antwort.status === 401) throw new SpeicherFehler('GitHub lehnt das Token ab. Ist es abgelaufen oder vertippt?');
    if (antwort.status === 403) {
      throw new SpeicherFehler('GitHub verweigert den Zugriff. Das Token braucht für dieses Repository die Berechtigung „Contents: Read and write".');
    }
    if (antwort.status === 404) {
      throw new SpeicherFehler(`Repository „${this.repo}" nicht gefunden – oder das Token gilt nicht für dieses Repository.`);
    }
    throw new SpeicherFehler(`GitHub meldet einen Fehler (${antwort.status}). ${meldung}`.trim());
  }

  async repoInfo() {
    const d = await this.anfrage('GET', '');
    this.zweig = d.default_branch || 'main';
    return { privat: !!d.private, zweig: this.zweig };
  }

  // Alle Dateien: Map Pfad → Prüfsumme
  async liste() {
    if (!this.zweig) await this.repoInfo();
    const d = await this.anfrage('GET', `/git/trees/${encodeURIComponent(this.zweig)}?recursive=1`,
      { erlaubt: [404, 409] });
    const dateien = new Map();
    if (d.status) return dateien;                 // leeres Repository
    if (d.truncated) throw new SpeicherFehler('Das Sync-Repository enthält zu viele Dateien für einen Abruf.');
    for (const e of d.tree || []) if (e.type === 'blob') dateien.set(e.path, e.sha);
    return dateien;
  }

  lesen(sha) {
    return this.anfrage('GET', `/git/blobs/${sha}`, { roh: true });
  }

  // Legt an (sha leer) oder ersetzt den Stand sha. Gibt die neue Prüfsumme zurück.
  async schreiben(pfad, bytes, sha) {
    const d = await this.anfrage('PUT', '/contents/' + pfad.split('/').map(encodeURIComponent).join('/'), {
      daten: { message: 'Abgleich', content: b64(bytes), ...(sha ? { sha } : {}) },
      erlaubt: [409, 422],
    });
    if (d.status) throw new KonfliktFehler(`${pfad} wurde zwischenzeitlich geändert.`);
    return d.content.sha;
  }
}
