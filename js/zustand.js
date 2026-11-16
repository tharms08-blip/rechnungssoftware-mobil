// Alle Daten der App im Arbeitsspeicher, dahinter die IndexedDB.
// Jede Änderung wird sofort auf dem Gerät gespeichert und als „noch
// hochzuladen" markiert – der Abgleich (sync.js) kümmert sich um den Rest.

import * as db from './db.js';
import { pfad, jetzt, neueId, KM_PAUSCHALE } from './format.js';

export const Z = {
  saetze: new Map(),        // Pfad → { pfad, art, daten, sha, basis, schmutzig }
  belegeLokal: new Map(),   // Beleg-ID → schmutzig (true/false); Bilder bleiben in der IndexedDB
  konfig: {},               // repo, token, schluessel, zuletzt
  dateien: null,            // letzte Dateiliste aus dem Repository (Pfad → Prüfsumme)
};

export async function laden() {
  Z.konfig = await db.konfigLesen();
  Z.saetze = new Map((await db.alle('saetze')).map((e) => [e.pfad, e]));
  Z.belegeLokal = new Map((await db.alle('belege')).map((b) => [b.id, !!b.schmutzig]));
}

export const verbunden = () => !!(Z.konfig.repo && Z.konfig.token && Z.konfig.schluessel);

export function liste(art) {
  const aus = [];
  for (const e of Z.saetze.values()) if (e.art === art && !e.daten.geloescht) aus.push(e.daten);
  return aus.sort((a, b) => (b.datum || '').localeCompare(a.datum || '')
    || (b.erstellt || b.nummer || '').localeCompare(a.erstellt || a.nummer || ''));
}

export const hole = (art, id) => Z.saetze.get(pfad(art, id))?.daten || null;

export function wartend() {
  let n = 0;
  for (const e of Z.saetze.values()) if (e.schmutzig) n++;
  for (const s of Z.belegeLokal.values()) if (s) n++;
  return n;
}

async function ablegen(eintrag) {
  Z.saetze.set(eintrag.pfad, eintrag);
  await db.setze('saetze', eintrag);
}

// Fahrt oder Ausgabe anlegen/ändern. felder ohne id → neuer Eintrag.
export async function speichern(art, felder) {
  const id = felder.id || neueId();
  const p = pfad(art, id);
  const alt = Z.saetze.get(p);
  const daten = {
    ...(alt?.daten || { erstellt: jetzt(), quelle: 'mobil' }),
    ...felder, typ: art, id, geaendert: jetzt(), geloescht: false,
  };
  await ablegen({ pfad: p, art, daten, sha: alt?.sha || null, basis: alt?.basis || null, schmutzig: true });
  return id;
}

export async function loeschen(art, id) {
  const e = Z.saetze.get(pfad(art, id));
  if (!e) return;
  if (!e.sha) {                         // nie hochgeladen → einfach weg
    Z.saetze.delete(e.pfad);
    await db.loesche('saetze', e.pfad);
    return;
  }
  await ablegen({ ...e, daten: { ...e.daten, geloescht: true, geaendert: jetzt() }, schmutzig: true });
}

// Rechnung als bezahlt/offen markieren – das Einzige, was das Handy an Rechnungen ändert.
export async function rechnungStatus(id, status, bezahltAm) {
  const e = Z.saetze.get(pfad('rechnung', id));
  if (!e) return;
  await ablegen({
    ...e,
    daten: { ...e.daten, status, bezahlt_am: status === 'bezahlt' ? bezahltAm : null, geaendert: jetzt(), quelle: 'mobil' },
    schmutzig: true,
  });
}

export async function belegSpeichern(bild) {
  const id = neueId();
  await db.setze('belege', { id, bild, schmutzig: true });
  Z.belegeLokal.set(id, true);
  return id;
}

export async function belegBild(id) {
  return (await db.hole('belege', id))?.bild || null;
}

export async function konfig(name, wert) {
  Z.konfig[name] = wert;
  await db.konfigSetzen(name, wert);
}

// Nach dem Verbinden mit einem (anderen) Repository: Eigenes gilt als neu,
// die Rechnungsliste kommt frisch vom Desktop.
export async function allesNeuHochladen() {
  for (const e of [...Z.saetze.values()]) {
    if (e.art === 'rechnung') {
      Z.saetze.delete(e.pfad);
      await db.loesche('saetze', e.pfad);
    } else {
      await ablegen({ ...e, sha: null, basis: null, schmutzig: true });
    }
  }
  for (const id of Z.belegeLokal.keys()) {
    const b = await db.hole('belege', id);
    if (b) await db.setze('belege', { ...b, schmutzig: true });
    Z.belegeLokal.set(id, true);
  }
}

export async function trennen(datenLoeschen) {
  for (const name of ['repo', 'token', 'schluessel', 'zuletzt']) {
    delete Z.konfig[name];
    await db.loesche('konfig', name);
  }
  Z.dateien = null;
  if (datenLoeschen) {
    await db.leere('saetze');
    await db.leere('belege');
    Z.saetze.clear();
    Z.belegeLokal.clear();
  }
}

// Zahlen eines Jahres – gerechnet wie am Desktop: Einnahme ist, was bezahlt
// wurde (Tag des Zahlungseingangs, ersatzweise Rechnungsdatum).
export function ueberblick(jahr) {
  const j = String(jahr);
  let einnahmen = 0, offen = 0, offenAnzahl = 0, ausgaben = 0, kmSumme = 0;
  for (const r of liste('rechnung')) {
    if (r.status === 'bezahlt' && String(r.bezahlt_am || r.datum).startsWith(j)) einnahmen += r.betrag || 0;
    if (r.status === 'offen') { offen += r.betrag || 0; offenAnzahl++; }
  }
  for (const a of liste('ausgabe')) if (String(a.datum).startsWith(j)) ausgaben += a.betrag || 0;
  for (const f of liste('fahrt')) if (String(f.datum).startsWith(j)) kmSumme += f.km || 0;
  const fahrtkosten = Math.round(kmSumme * KM_PAUSCHALE * 100) / 100;
  const rund = (n) => Math.round(n * 100) / 100;
  return { jahr: j, einnahmen: rund(einnahmen), offen: rund(offen), offenAnzahl, ausgaben: rund(ausgaben),
    km: kmSumme, fahrtkosten, gewinn: rund(einnahmen - ausgaben - fahrtkosten) };
}
