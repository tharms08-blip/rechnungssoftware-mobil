// Abgleich mit dem privaten Sync-Repository auf GitHub.
//
//   verbinden(repo, token, passwort)   einmalig je Gerät
//   abgleichen()                       holt Neues, schickt Eigenes
//
// Hochgeladen wird nur Verschlüsseltes. In ein öffentliches Repository wird
// nie geschrieben. Ändern zwei Geräte denselben Eintrag, gewinnt die jüngere
// Änderung; bei Rechnungen hat im Zweifel der Desktop recht.

import * as db from './db.js';
import { GitHub, KonfliktFehler, SpeicherFehler } from './github.js';
import { schluesselAbleiten, verschluesseln, entschluesseln, neuesSalt, b64, b64zurueck, KryptoFehler } from './krypto.js';
import { KOPF_DATEI, PRUEFTEXT, PRUEF_PFAD, FORMAT_VERSION, KDF_NAME, KDF_ITERATIONEN, MIN_PASSWORT,
  ENDUNG, pfad, idAusPfad, artAusPfad, jetzt } from './format.js';
import { Z, konfig, allesNeuHochladen } from './zustand.js';

export class SyncFehler extends Error {}

const text = new TextEncoder();
const lesbar = new TextDecoder();
let laeuft = false;

async function kopfLesen(gh, dateien) {
  if (!dateien.has(KOPF_DATEI)) return null;
  try {
    const kopf = JSON.parse(lesbar.decode(await gh.lesen(dateien.get(KOPF_DATEI))));
    if (kopf.format !== FORMAT_VERSION || kopf.kdf.name !== KDF_NAME) {
      throw new SyncFehler('Das Sync-Repository hat ein neueres Format. Bitte die App aktualisieren.');
    }
    return { salt: b64zurueck(kopf.kdf.salt), iterationen: Number(kopf.kdf.iterationen), pruefwert: b64zurueck(kopf.pruefwert) };
  } catch (e) {
    if (e instanceof SyncFehler || e instanceof SpeicherFehler) throw e;
    throw new SyncFehler(`Die Datei ${KOPF_DATEI} im Sync-Repository ist beschädigt.`);
  }
}

async function schluesselPasst(schluessel, kopf) {
  try {
    return lesbar.decode(await entschluesseln(schluessel, kopf.pruefwert, PRUEF_PFAD)) === PRUEFTEXT;
  } catch {
    return false;
  }
}

async function nurPrivat(gh) {
  if (!(await gh.repoInfo()).privat) {
    throw new SyncFehler(`Das Repository „${gh.repo}" ist öffentlich. Der Abgleich läuft nur mit einem privaten Repository.`);
  }
}

function alsFehler(e) {
  if (e instanceof SyncFehler) return e;
  if (e instanceof SpeicherFehler) return new SyncFehler(e.message);
  console.error(e);
  return new SyncFehler('Unerwarteter Fehler beim Abgleich.');
}

// Prüft Zugang und Passwort und merkt sich beides auf diesem Gerät.
// Ist das Repository noch leer, wird es mit diesem Passwort eingerichtet.
export async function verbinden(repo, token, passwort) {
  try {
    const gh = new GitHub(repo, token);
    await nurPrivat(gh);
    let schluessel = null;
    for (let versuch = 0; versuch < 2 && !schluessel; versuch++) {
      const dateien = await gh.liste();
      const kopf = await kopfLesen(gh, dateien);
      if (kopf) {
        const s = await schluesselAbleiten(passwort, kopf.salt, kopf.iterationen);
        if (!(await schluesselPasst(s, kopf))) {
          throw new SyncFehler('Das Passwort passt nicht zu den Daten in diesem Repository.');
        }
        schluessel = s;
        break;
      }
      if (passwort.length < MIN_PASSWORT) {
        throw new SyncFehler(`Das Passwort sollte mindestens ${MIN_PASSWORT} Zeichen haben.`);
      }
      const salt = neuesSalt();
      const s = await schluesselAbleiten(passwort, salt);
      const kopfNeu = {
        format: FORMAT_VERSION,
        kdf: { name: KDF_NAME, iterationen: KDF_ITERATIONEN, salt: b64(salt) },
        pruefwert: b64(await verschluesseln(s, text.encode(PRUEFTEXT), PRUEF_PFAD)),
        erstellt: jetzt(),
      };
      try {
        await gh.schreiben(KOPF_DATEI, text.encode(JSON.stringify(kopfNeu, null, 2)));
        schluessel = s;
      } catch (e) {
        if (!(e instanceof KonfliktFehler)) throw e;   // sonst: anderes Gerät war schneller → dessen Kopf lesen
      }
    }
    if (!schluessel) throw new SyncFehler('Das Repository konnte nicht eingerichtet werden. Bitte noch einmal versuchen.');
    await allesNeuHochladen();
    await konfig('repo', gh.repo);
    await konfig('token', gh.token);
    await konfig('schluessel', schluessel);
  } catch (e) {
    throw alsFehler(e);
  }
}

async function ablegen(eintrag) {
  Z.saetze.set(eintrag.pfad, eintrag);
  await db.setze('saetze', eintrag);
}

export const laeuftGerade = () => laeuft;

// Ein vollständiger Abgleich. Gibt eine kleine Statistik zurück.
export async function abgleichen() {
  if (laeuft) return null;
  laeuft = true;
  const erg = { empfangen: 0, gesendet: 0, konflikte: 0, unlesbar: 0 };
  try {
    const { repo, token, schluessel } = Z.konfig;
    if (!repo || !token || !schluessel) throw new SyncFehler('Der Abgleich ist noch nicht eingerichtet.');
    const gh = new GitHub(repo, token);
    await nurPrivat(gh);
    const dateien = await gh.liste();
    const kopf = await kopfLesen(gh, dateien);
    if (!kopf || !(await schluesselPasst(schluessel, kopf))) {
      throw new SyncFehler('Das Repository passt nicht mehr zum gespeicherten Passwort. Bitte neu verbinden.');
    }
    Z.dateien = dateien;

    // 1) Neues und Geändertes holen
    for (const [p, sha] of dateien) {
      const art = artAusPfad(p);
      if (!art || art === 'beleg' || !p.endsWith(ENDUNG)) continue;
      const lokal = Z.saetze.get(p);
      if (lokal && lokal.sha === sha) continue;
      let satz;
      try {
        satz = JSON.parse(lesbar.decode(await entschluesseln(schluessel, await gh.lesen(sha), p)));
        if (satz.typ !== art || satz.id !== idAusPfad(p)) throw new KryptoFehler('Kennung passt nicht.');
      } catch (e) {
        if (e instanceof SpeicherFehler) throw e;
        erg.unlesbar++;
        continue;
      }
      if (!lokal || !lokal.schmutzig) {
        await ablegen({ pfad: p, art, daten: satz, sha, basis: satz, schmutzig: false });
        erg.empfangen++;
      } else if (art === 'rechnung') {
        // Hier wurde nur der Status geändert. Hat der Desktop ihn inzwischen auch
        // geändert (oder die Rechnung gelöscht), gilt der Desktop.
        if (satz.geloescht || satz.status !== lokal.basis?.status) {
          await ablegen({ pfad: p, art, daten: satz, sha, basis: satz, schmutzig: false });
          erg.empfangen++;
        } else {
          const d = lokal.daten;
          await ablegen({ pfad: p, art, sha, basis: satz, schmutzig: true,
            daten: { ...satz, status: d.status, bezahlt_am: d.bezahlt_am, geaendert: d.geaendert, quelle: 'mobil' } });
        }
      } else if (String(satz.geaendert || '') >= String(lokal.daten.geaendert || '')) {
        await ablegen({ pfad: p, art, daten: satz, sha, basis: satz, schmutzig: false });
        erg.empfangen++;
      } else {
        await ablegen({ ...lokal, sha, basis: satz });      // eigene Änderung ist jünger
      }
    }

    // 2) Was im Repository nicht mehr existiert
    for (const e of [...Z.saetze.values()]) {
      if (!e.sha || dateien.has(e.pfad)) continue;
      if (e.schmutzig && e.art !== 'rechnung') {
        await ablegen({ ...e, sha: null, basis: null });    // wird neu angelegt
      } else {
        Z.saetze.delete(e.pfad);
        await db.loesche('saetze', e.pfad);
      }
    }

    // 3) Belegfotos hochladen – vor den Ausgaben, damit kein Verweis ins Leere zeigt
    for (const [id, schmutzig] of [...Z.belegeLokal]) {
      if (!schmutzig) continue;
      const p = pfad('beleg', id);
      const b = await db.hole('belege', id);
      if (!b) { Z.belegeLokal.delete(id); continue; }
      if (!dateien.has(p)) {
        try {
          dateien.set(p, await gh.schreiben(p, await verschluesseln(schluessel, new Uint8Array(b.bild), p)));
        } catch (e) {
          if (!(e instanceof KonfliktFehler)) throw e;      // liegt schon dort
        }
      }
      await db.setze('belege', { ...b, schmutzig: false });
      Z.belegeLokal.set(id, false);
    }

    // 4) Eigene Änderungen hochladen
    for (const e of [...Z.saetze.values()]) {
      if (!e.schmutzig) continue;
      try {
        const sha = await gh.schreiben(e.pfad,
          await verschluesseln(schluessel, text.encode(JSON.stringify(e.daten)), e.pfad), e.sha);
        dateien.set(e.pfad, sha);
        const aktuell = Z.saetze.get(e.pfad);
        // Wurde währenddessen weitergetippt, bleibt der Eintrag „noch hochzuladen".
        const unveraendert = aktuell && aktuell.daten.geaendert === e.daten.geaendert;
        await ablegen({ ...(aktuell || e), sha, basis: e.daten, schmutzig: !unveraendert });
        erg.gesendet++;
      } catch (err) {
        if (!(err instanceof KonfliktFehler)) throw err;
        erg.konflikte++;                                     // löst sich beim nächsten Abgleich
      }
    }

    await konfig('zuletzt', jetzt());
    return erg;
  } catch (e) {
    throw alsFehler(e);
  } finally {
    laeuft = false;
  }
}

// Belegfoto, das auf einem anderen Gerät aufgenommen wurde, bei Bedarf holen.
export async function belegHolen(id) {
  const lokal = await db.hole('belege', id);
  if (lokal) return lokal.bild;
  const { repo, token, schluessel } = Z.konfig;
  if (!repo || !token || !schluessel) return null;
  try {
    const gh = new GitHub(repo, token);
    const dateien = Z.dateien || (Z.dateien = await gh.liste());
    const p = pfad('beleg', id);
    if (!dateien.has(p)) return null;
    const bild = (await entschluesseln(schluessel, await gh.lesen(dateien.get(p)), p)).buffer;
    await db.setze('belege', { id, bild, schmutzig: false });
    Z.belegeLokal.set(id, false);
    return bild;
  } catch {
    return null;
  }
}
