// Verschlüsselung im Browser: AES-256-GCM, Schlüssel per PBKDF2 aus dem Passwort.
// Bitgleich mit src/mobil/krypto.py im Desktop-Programm.
//
// Datei:  4 Byte "RSV1" | 12 Byte Nonce | Chiffrat + 16 Byte Prüfwert
// Der Dateipfad geht als Zusatzdaten (AAD) in den Prüfwert ein.

import { KDF_ITERATIONEN } from './format.js';

const KENNUNG = new Uint8Array([0x52, 0x53, 0x56, 0x31]); // "RSV1"
const text = new TextEncoder();

export class KryptoFehler extends Error {}

export const neuesSalt = () => crypto.getRandomValues(new Uint8Array(16));

// Der Schlüssel lässt sich danach nicht mehr auslesen (extractable = false).
export async function schluesselAbleiten(passwort, salt, iterationen = KDF_ITERATIONEN) {
  const roh = await crypto.subtle.importKey(
    'raw', text.encode(passwort.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iterationen, hash: 'SHA-256' },
    roh, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function verschluesseln(schluessel, klartext, pfad) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const chiffrat = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: text.encode(pfad), tagLength: 128 },
    schluessel, klartext));
  const aus = new Uint8Array(16 + chiffrat.length);
  aus.set(KENNUNG, 0);
  aus.set(nonce, 4);
  aus.set(chiffrat, 16);
  return aus;
}

export async function entschluesseln(schluessel, daten, pfad) {
  daten = daten instanceof Uint8Array ? daten : new Uint8Array(daten);
  if (daten.length < 32 || KENNUNG.some((b, i) => daten[i] !== b)) {
    throw new KryptoFehler('Die Datei hat nicht das erwartete Format.');
  }
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: daten.subarray(4, 16), additionalData: text.encode(pfad), tagLength: 128 },
      schluessel, daten.subarray(16)));
  } catch {
    throw new KryptoFehler('Prüfwert stimmt nicht.');
  }
}

export const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};
export const b64zurueck = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
