// Lokaler Speicher auf dem Gerät (IndexedDB).
//   saetze  – Fahrten, Ausgaben, Rechnungen:  { pfad, art, daten, sha, basis, schmutzig }
//   belege  – Belegfotos:                     { id, bild (ArrayBuffer), schmutzig }
//   konfig  – Repository, Token, Schlüssel …  { name, wert }

let dbVersprechen = null;

function oeffnen() {
  if (!dbVersprechen) {
    dbVersprechen = new Promise((ok, fehler) => {
      const auf = indexedDB.open('rechnungssoftware', 1);
      auf.onupgradeneeded = () => {
        const db = auf.result;
        db.createObjectStore('saetze', { keyPath: 'pfad' });
        db.createObjectStore('belege', { keyPath: 'id' });
        db.createObjectStore('konfig', { keyPath: 'name' });
      };
      auf.onsuccess = () => ok(auf.result);
      auf.onerror = () => fehler(auf.error);
    });
  }
  return dbVersprechen;
}

async function mit(lager, modus, tun) {
  const db = await oeffnen();
  return new Promise((ok, fehler) => {
    const ta = db.transaction(lager, modus);
    const anfrage = tun(ta.objectStore(lager));
    ta.oncomplete = () => ok(anfrage ? anfrage.result : undefined);
    ta.onerror = () => fehler(ta.error);
    ta.onabort = () => fehler(ta.error);
  });
}

export const alle = (lager) => mit(lager, 'readonly', (s) => s.getAll());
export const alleSchluessel = (lager) => mit(lager, 'readonly', (s) => s.getAllKeys());
export const hole = (lager, key) => mit(lager, 'readonly', (s) => s.get(key));
export const setze = (lager, wert) => mit(lager, 'readwrite', (s) => { s.put(wert); });
export const loesche = (lager, key) => mit(lager, 'readwrite', (s) => { s.delete(key); });
export const leere = (lager) => mit(lager, 'readwrite', (s) => { s.clear(); });

export async function konfigLesen() {
  const k = {};
  for (const { name, wert } of await alle('konfig')) k[name] = wert;
  return k;
}
export const konfigSetzen = (name, wert) => setze('konfig', { name, wert });
