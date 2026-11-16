// Gemeinsames Datenformat des Abgleichs (Formatversion 1).
// Dieselben Namen und Felder benutzt das Desktop-Programm (src/mobil/format.py).

export const APP_VERSION = '1.0.0';
export const FORMAT_VERSION = 1;
export const KOPF_DATEI = 'rs-sync.json';
export const PRUEFTEXT = 'rechnungssoftware';
export const PRUEF_PFAD = 'rs-sync.json#pruefwert';
export const KDF_NAME = 'PBKDF2-HMAC-SHA256';
export const KDF_ITERATIONEN = 600000;
export const MIN_PASSWORT = 10;

export const ORDNER = { fahrt: 'fahrten', ausgabe: 'ausgaben', rechnung: 'rechnungen', beleg: 'belege' };
export const ENDUNG = '.enc';
export const KM_PAUSCHALE = 0.30;   // € je gefahrenem Kilometer (Privatwagen)

export const KATEGORIEN = [
  ['material', 'Material & Waren'],
  ['ausstattung', 'Kamera & Ausstattung'],
  ['buero', 'Büro, Porto, Telefon'],
  ['software', 'Software & Abos'],
  ['werbung', 'Werbung & Webseite'],
  ['fortbildung', 'Fortbildung'],
  ['reise', 'Reise & Verpflegung'],
  ['versicherung', 'Versicherung & Beiträge'],
  ['miete', 'Miete & Räume'],
  ['sonstiges', 'Sonstiges'],
];
export const kategorieName = (k) => (KATEGORIEN.find(([s]) => s === k) || [, 'Sonstiges'])[1];

export const pfad = (art, id) => `${ORDNER[art]}/${id}${ENDUNG}`;
export const idAusPfad = (p) => p.slice(p.lastIndexOf('/') + 1, -ENDUNG.length);
export const artAusPfad = (p) => {
  const ordner = p.slice(0, p.indexOf('/'));
  return Object.keys(ORDNER).find((a) => ORDNER[a] === ordner) || null;
};

export const jetzt = () => new Date().toISOString().slice(0, 19) + 'Z';
export const heute = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const neueId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// ── Anzeige ────────────────────────────────────────────────────────────────
const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const euro = (n) => EURO.format(Number(n) || 0);
export const km = (n) => `${ZAHL.format(Number(n) || 0)} km`;
export const datumKurz = (iso) => {
  const [j, m, t] = String(iso || '').split('-');
  return t ? `${t}.${m}.${j}` : '';
};
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];
export const monatLang = (iso) => {
  const [j, m] = String(iso || '').split('-');
  return `${MONATE[Number(m) - 1] || ''} ${j}`;
};
// „12,5" und „12.5" gelten beide; Unsinn ergibt NaN
export const zahlLesen = (text) => {
  const t = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return t === '' || !/^-?\d*\.?\d+$/.test(t) ? NaN : Math.round(Number(t) * 100) / 100;
};
