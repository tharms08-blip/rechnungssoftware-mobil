// Oberfläche der Handy-App: Überblick · Fahrten · Ausgaben · Rechnungen.
// Angezeigte Texte werden nie als HTML eingesetzt (immer textContent) –
// nur die festen Symbole unten kommen als SVG-Text ins Dokument.

import { APP_VERSION, KATEGORIEN, KM_PAUSCHALE, kategorieName, euro, km, datumKurz, monatLang,
  heute, zahlLesen } from './format.js';
import { Z, laden, verbunden, liste, hole, wartend, speichern, loeschen, rechnungStatus,
  belegSpeichern, ueberblick, trennen } from './zustand.js';
import { verbinden, abgleichen, belegHolen, laeuftGerade, SyncFehler } from './sync.js';

// ── Symbole ──────────────────────────────────────────────────────────────────
const SYMBOL = {
  ueberblick: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  fahrt: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  ausgabe: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  rechnung: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  zahnrad: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5" stroke-dasharray="3.2 2.69" stroke-width="2.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  kamera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  bild: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16l4.5-4.5 4 4 2.5-2.5 5 5"/>',
  haken: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  rechts: '<path d="M9 6l6 6-6 6"/>',
  links: '<path d="M15 6l-6 6 6 6"/>',
};
const symbol = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    s.setAttribute(k, v);
  }
  s.innerHTML = SYMBOL[name];
  return s;
};

// ── Kleines Werkzeug zum Bauen von Elementen ─────────────────────────────────
function h(tag, eig = {}, ...kinder) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(eig || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && !['list', 'form'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kind of kinder.flat(Infinity)) {
    if (kind != null && kind !== false) el.append(kind.nodeType ? kind : String(kind));
  }
  return el;
}

// ── Zustand der Oberfläche ───────────────────────────────────────────────────
const ui = {
  reiter: 'ueberblick',
  jahr: new Date().getFullYear(),
  filter: 'offen',
  syncFehler: '',
  letzterVersuch: 0,
  nachfassen: 0,
};
const REITER = [
  ['ueberblick', 'Überblick', 'ueberblick'],
  ['fahrten', 'Fahrten', 'fahrt'],
  ['ausgaben', 'Ausgaben', 'ausgabe'],
  ['rechnungen', 'Rechnungen', 'rechnung'],
];
let wurzel, inhalt, titel, syncKnopf, plusKnopf, reiterLeiste;

function rahmenBauen() {
  wurzel = document.getElementById('app');
  titel = h('h1');
  syncKnopf = h('button', { class: 'rund', 'aria-label': 'Abgleichen', onclick: () => syncJetzt(true) });
  inhalt = h('main', { class: 'inhalt' });
  plusKnopf = h('button', { class: 'plus', 'aria-label': 'Neuer Eintrag', onclick: () =>
    (ui.reiter === 'ausgaben' ? blattAusgabe() : blattFahrt()) }, symbol('plus'));
  reiterLeiste = h('nav', { class: 'reiter' }, REITER.map(([key, name, sym]) =>
    h('button', { 'data-reiter': key, onclick: () => { ui.reiter = key; zeichnen(); scrollTo(0, 0); } },
      symbol(sym), name)));
  wurzel.replaceChildren(
    h('header', { class: 'kopf' }, titel, h('div', { class: 'kopf-knoepfe' }, syncKnopf,
      h('button', { class: 'rund', 'aria-label': 'Einstellungen', onclick: blattEinstellungen }, symbol('zahnrad')))),
    inhalt, plusKnopf, reiterLeiste);
}

function zeichnen() {
  titel.textContent = REITER.find(([k]) => k === ui.reiter)[1];
  for (const b of reiterLeiste.children) b.classList.toggle('aktiv', b.dataset.reiter === ui.reiter);
  plusKnopf.hidden = !['fahrten', 'ausgaben'].includes(ui.reiter);
  inhalt.replaceChildren(...{ ueberblick: seiteUeberblick, fahrten: seiteFahrten, ausgaben: seiteAusgaben,
    rechnungen: seiteRechnungen }[ui.reiter]());
  syncKnopfZeichnen();
}

function syncKnopfZeichnen() {
  const n = wartend();
  syncKnopf.replaceChildren(symbol('sync'), ...(n ? [h('span', { class: 'marke' }, n)] : []));
  syncKnopf.classList.toggle('dreht', laeuftGerade());
  syncKnopf.classList.toggle('fehler', !!ui.syncFehler);
}

// ── Meldungen und Rückfragen ─────────────────────────────────────────────────
let meldungUhr;
function melden(text, fehler = false) {
  document.querySelector('.meldung')?.remove();
  clearTimeout(meldungUhr);
  const el = h('div', { class: 'meldung' + (fehler ? ' fehler' : ''), role: 'status' }, text);
  document.body.append(el);
  meldungUhr = setTimeout(() => el.remove(), fehler ? 6000 : 2600);
}

function fragen(ueberschrift, text, antworten) {
  return new Promise((ok) => {
    const zu = (wert) => { ebene.remove(); ok(wert); };
    const ebene = h('div', { class: 'ebene' },
      h('div', { class: 'grund', onclick: () => zu(null) }),
      h('div', { class: 'frage', role: 'alertdialog', 'aria-label': ueberschrift },
        h('h2', {}, ueberschrift), h('p', {}, text),
        antworten.map(([name, wert, art]) =>
          h('button', { class: 'taste ' + (art || 'leise'), onclick: () => zu(wert) }, name)),
        h('button', { class: 'taste leise', onclick: () => zu(null) }, 'Abbrechen')));
    document.body.append(ebene);
  });
}

// Blatt von unten. inhaltBauen(zu) liefert die Kinder; fertig = { name, tun }.
function blatt(ueberschrift, kinder, fertig) {
  const zu = () => ebene.remove();
  const fertigKnopf = fertig && h('button', { class: 'fertig', onclick: async () => {
    fertigKnopf.disabled = true;
    try { if (await fertig.tun() !== false) zu(); } finally { fertigKnopf.disabled = false; }
  } }, fertig.name);
  const ebene = h('div', { class: 'ebene' },
    h('div', { class: 'grund', onclick: zu }),
    h('section', { class: 'blatt', role: 'dialog', 'aria-label': ueberschrift },
      h('div', { class: 'blatt-kopf' },
        h('button', { onclick: zu }, fertig ? 'Abbrechen' : 'Schließen'),
        h('h2', {}, ueberschrift), fertigKnopf || h('span')),
      kinder));
  document.body.append(ebene);
  return zu;
}

const feld = (name, eingabe) => h('label', { class: 'feld' }, h('span', {}, name), eingabe);

// ── Überblick ────────────────────────────────────────────────────────────────
function seiteUeberblick() {
  const u = ueberblick(ui.jahr);
  const dieses = new Date().getFullYear();
  const teile = [
    h('div', { class: 'jahr' },
      h('button', { 'aria-label': 'Vorjahr', onclick: () => { ui.jahr--; zeichnen(); } }, symbol('links')),
      h('strong', {}, ui.jahr),
      h('button', { 'aria-label': 'Folgejahr', disabled: ui.jahr >= dieses,
        onclick: () => { ui.jahr++; zeichnen(); } }, symbol('rechts'))),
    h('section', { class: 'karte' },
      h('p', { class: 'klein' }, `Gewinn ${u.jahr}`),
      h('p', { class: 'gross zahl' + (u.gewinn < 0 ? ' minus' : '') }, euro(u.gewinn)),
      h('div', { class: 'posten' }, h('span', {}, 'Einnahmen'), h('span', { class: 'zahl' }, euro(u.einnahmen))),
      h('div', { class: 'posten' }, h('span', {}, 'Ausgaben'), h('span', { class: 'zahl' }, '− ' + euro(u.ausgaben))),
      h('div', { class: 'posten' }, h('span', {}, `Fahrten · ${km(u.km)}`),
        h('span', { class: 'zahl' }, '− ' + euro(u.fahrtkosten)))),
    h('button', { class: 'karte knopf', onclick: () => { ui.reiter = 'rechnungen'; ui.filter = 'offen'; zeichnen(); } },
      h('div', { class: 'neben' },
        h('div', {},
          h('p', { class: 'klein' }, 'Noch offen'),
          h('p', { class: 'zahl' }, h('strong', {}, euro(u.offen)),
            ` · ${u.offenAnzahl} ${u.offenAnzahl === 1 ? 'Rechnung' : 'Rechnungen'}`)),
        h('span', { class: 'pfeil' }, symbol('rechts')))),
    h('div', { class: 'zwei' },
      h('button', { class: 'taste', onclick: () => blattFahrt() }, symbol('fahrt'), 'Fahrt'),
      h('button', { class: 'taste', onclick: () => blattAusgabe() }, symbol('ausgabe'), 'Ausgabe')),
  ];
  if (!verbunden()) {
    teile.push(h('section', { class: 'karte hinweis-karte' },
      h('h3', {}, 'Abgleich einrichten'),
      h('p', {}, 'Damit deine Einträge am Rechner ankommen und die Rechnungen hier erscheinen, verbinde die App einmal mit deinem privaten Repository.'),
      h('button', { class: 'taste', onclick: blattEinstellungen }, 'Einrichten')));
  }
  const iosSafari = /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone;
  if (iosSafari && !merker('homeHinweis')) {
    teile.push(h('section', { class: 'karte hinweis-karte' },
      h('h3', {}, 'Auf den Home-Bildschirm legen'),
      h('p', {}, 'Tippe in Safari auf das Teilen-Symbol und dann auf „Zum Home-Bildschirm". Dann öffnet sich die App wie jede andere – auch ohne Netz.'),
      h('button', { class: 'taste leise', onclick: () => { merker('homeHinweis', '1'); zeichnen(); } }, 'Verstanden')));
  }
  teile.push(standZeile());
  return teile;
}

function merker(name, wert) {
  try {
    if (wert !== undefined) localStorage.setItem('rs_' + name, wert);
    return localStorage.getItem('rs_' + name);
  } catch { return null; }
}

function standZeile() {
  if (!verbunden()) return h('p', { class: 'stand' }, 'Noch nicht verbunden – Einträge bleiben auf diesem Gerät.');
  if (ui.syncFehler) return h('p', { class: 'stand fehler' }, ui.syncFehler);
  const n = wartend();
  const zuletzt = Z.konfig.zuletzt
    ? new Date(Z.konfig.zuletzt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  return h('p', { class: 'stand' },
    n ? `${n} ${n === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf den Abgleich`
      : zuletzt ? `Abgeglichen am ${zuletzt.replace(',', ' um')} Uhr` : 'Noch nicht abgeglichen');
}

// ── Listen ───────────────────────────────────────────────────────────────────
function nachMonat(eintraege, zeile, summe) {
  const teile = [];
  let monat = null, box = null, sammel = [];
  const abschliessen = () => {
    if (!box) return;
    teile.push(h('div', { class: 'gruppe' }, h('span', {}, monatLang(monat + '-01')), h('span', { class: 'zahl' }, summe(sammel))), box);
  };
  for (const e of eintraege) {
    const m = String(e.datum).slice(0, 7);
    if (m !== monat) { abschliessen(); monat = m; box = h('div', { class: 'liste' }); sammel = []; }
    sammel.push(e);
    box.append(zeile(e));
  }
  abschliessen();
  return teile;
}

const leer = (sym, kopf, text) => h('div', { class: 'leer' }, symbol(sym), h('h3', {}, kopf), h('p', {}, text));

function seiteFahrten() {
  const fahrten = liste('fahrt');
  if (!fahrten.length) {
    return [leer('fahrt', 'Noch keine Fahrten', 'Tippe auf das Plus, um deine erste Fahrt einzutragen.')];
  }
  const kunden = new Map(liste('rechnung').map((r) => [r.nummer, r.kunde]));
  const summe = (l) => km(l.reduce((s, f) => s + (f.km || 0), 0));
  return nachMonat(fahrten, (f) => h('button', { class: 'zeile', onclick: () => blattFahrt(f.id) },
    h('div', { class: 'mitte' },
      h('div', { class: 'titel' }, f.ziel || 'Fahrt'),
      h('div', { class: 'unter' }, [datumKurz(f.datum), f.zweck,
        f.rechnung ? (kunden.get(f.rechnung) || `Rechnung ${f.rechnung}`) : null].filter(Boolean).join(' · '))),
    h('div', { class: 'rechts' },
      h('div', { class: 'titel zahl' }, km(f.km)),
      h('div', { class: 'unter zahl' }, euro((f.km || 0) * KM_PAUSCHALE)))), summe);
}

function seiteAusgaben() {
  const ausgaben = liste('ausgabe');
  if (!ausgaben.length) {
    return [leer('ausgabe', 'Noch keine Ausgaben', 'Tippe auf das Plus und fotografiere gleich den Beleg dazu.')];
  }
  const summe = (l) => euro(l.reduce((s, a) => s + (a.betrag || 0), 0));
  return nachMonat(ausgaben, (a) => h('button', { class: 'zeile', onclick: () => blattAusgabe(a.id) },
    h('div', { class: 'mitte' },
      h('div', { class: 'titel' }, a.bezeichnung || 'Ausgabe'),
      h('div', { class: 'unter' }, `${datumKurz(a.datum)} · ${kategorieName(a.kategorie)}`)),
    h('div', { class: 'rechts' },
      h('div', { class: 'titel zahl' }, euro(a.betrag)),
      h('div', { class: 'unter' }, a.beleg ? [symbol('kamera'), 'Beleg'] : 'ohne Beleg'))), summe);
}

function seiteRechnungen() {
  const alle = liste('rechnung');
  const teile = [h('div', { class: 'segment' }, [['offen', 'Offen'], ['bezahlt', 'Bezahlt'], ['alle', 'Alle']]
    .map(([key, name]) => h('button', { class: ui.filter === key ? 'aktiv' : '',
      onclick: () => { ui.filter = key; zeichnen(); } }, name)))];
  if (!alle.length) {
    teile.push(leer('rechnung', 'Noch keine Rechnungen', verbunden()
      ? 'Die Liste kommt vom Rechner, sobald dort abgeglichen wurde.'
      : 'Die Liste kommt vom Rechner, sobald der Abgleich eingerichtet ist.'));
    return teile;
  }
  const gefiltert = alle.filter((r) => ui.filter === 'alle' || r.status === ui.filter)
    .sort((a, b) => String(b.nummer).localeCompare(String(a.nummer)));
  if (!gefiltert.length) {
    teile.push(leer('haken', ui.filter === 'offen' ? 'Alles bezahlt' : 'Nichts gefunden',
      ui.filter === 'offen' ? 'Es gibt keine offenen Rechnungen.' : 'In dieser Ansicht gibt es keine Rechnungen.'));
    return teile;
  }
  if (ui.filter !== 'alle') {
    teile.push(h('div', { class: 'gruppe' },
      h('span', {}, `${gefiltert.length} ${gefiltert.length === 1 ? 'Rechnung' : 'Rechnungen'}`),
      h('span', { class: 'zahl' }, euro(gefiltert.reduce((s, r) => s + (r.betrag || 0), 0)))));
  }
  teile.push(h('div', { class: 'liste' }, gefiltert.map((r) =>
    h('button', { class: 'zeile', onclick: () => blattRechnung(r.id) },
      h('div', { class: 'mitte' },
        h('div', { class: 'titel' }, r.kunde || '–'),
        h('div', { class: 'unter' }, `${r.nummer} · ${datumKurz(r.datum)}`)),
      h('div', { class: 'rechts' },
        h('div', { class: 'titel zahl' }, euro(r.betrag)),
        h('div', { class: 'unter' }, h('span', { class: 'chip ' + r.status }, statusName(r.status))))))));
  return teile;
}

const statusName = (s) => ({ offen: 'offen', bezahlt: 'bezahlt', storniert: 'storniert' }[s] || s);

// ── Fahrt ────────────────────────────────────────────────────────────────────
function vorschlaege(id, werte) {
  return h('datalist', { id }, [...new Set(werte.filter(Boolean))].slice(0, 30).map((w) => h('option', { value: w })));
}

function blattFahrt(id) {
  const alt = id ? hole('fahrt', id) : null;
  const fahrten = liste('fahrt');
  const rechnungen = liste('rechnung').filter((r) => r.status !== 'storniert')
    .sort((a, b) => String(b.nummer).localeCompare(String(a.nummer)));
  const datum = h('input', { type: 'date', value: alt?.datum || heute(), max: '2099-12-31' });
  const ziel = h('input', { type: 'text', value: alt?.ziel || '', placeholder: 'z. B. Siegburg, Standesamt',
    list: 'v-ziel', autocomplete: 'off', maxLength: 200 });
  const zweck = h('input', { type: 'text', value: alt?.zweck || '', placeholder: 'z. B. Hochzeit, Einkauf',
    list: 'v-zweck', autocomplete: 'off', maxLength: 200 });
  const strecke = h('input', { type: 'text', inputMode: 'decimal', placeholder: '0',
    value: alt ? String(alt.km).replace('.', ',') : '' });
  const auftrag = h('select', {},
    h('option', { value: '' }, 'Allgemeine Fahrt'),
    alt?.rechnung && !rechnungen.some((r) => r.nummer === alt.rechnung)
      ? h('option', { value: alt.rechnung }, `Rechnung ${alt.rechnung}`) : null,
    rechnungen.map((r) => h('option', { value: r.nummer }, `${r.nummer} · ${r.kunde}`)));
  auftrag.value = alt?.rechnung || '';
  const notiz = h('textarea', { value: alt?.notiz || '', placeholder: 'optional', maxLength: 1000 });
  const fehler = h('p', { class: 'fehlertext', hidden: true });

  blatt(alt ? 'Fahrt' : 'Neue Fahrt', [
    h('div', { class: 'felder' },
      feld('Datum', datum), feld('Ziel', ziel), feld('Zweck', zweck),
      h('div', { class: 'feld mit-taste' },
        h('label', {}, h('span', {}, 'Kilometer (gesamte Strecke)'), strecke),
        h('button', { class: 'mini', type: 'button', onclick: () => {
          const n = zahlLesen(strecke.value);
          if (n > 0) strecke.value = String(Math.round(n * 2 * 10) / 10).replace('.', ',');
        } }, '× 2 hin & zurück'))),
    h('div', { class: 'felder' }, feld('Gehört zu', auftrag), feld('Notiz', notiz)),
    fehler,
    vorschlaege('v-ziel', fahrten.map((f) => f.ziel)), vorschlaege('v-zweck', fahrten.map((f) => f.zweck)),
    alt ? h('button', { class: 'taste gefahr', onclick: async (ev) => {
      if (await fragen('Fahrt löschen?', 'Der Eintrag wird auch am Rechner entfernt.', [['Löschen', true, 'gefahr']])) {
        await loeschen('fahrt', id);
        ev.target.closest('.ebene').remove();
        geaendert('Fahrt gelöscht');
      }
    } }, 'Fahrt löschen') : null,
  ], { name: 'Sichern', tun: async () => {
    const strecken = zahlLesen(strecke.value);
    const meldung = !datum.value ? 'Bitte ein Datum wählen.'
      : !ziel.value.trim() ? 'Wohin ging die Fahrt?'
        : !(strecken > 0) ? 'Bitte die Kilometer eintragen, z. B. 23,5.'
          : strecken > 5000 ? 'So viele Kilometer an einem Tag? Bitte prüfen.' : '';
    if (meldung) { fehler.textContent = meldung; fehler.hidden = false; return false; }
    await speichern('fahrt', { id, datum: datum.value, ziel: ziel.value.trim(), zweck: zweck.value.trim(),
      km: strecken, rechnung: auftrag.value || null, notiz: notiz.value.trim() });
    geaendert(alt ? 'Fahrt geändert' : 'Fahrt gespeichert');
  } });
  if (!alt) ziel.focus();
}

// ── Ausgabe ──────────────────────────────────────────────────────────────────
async function bildVerkleinern(datei) {
  const url = URL.createObjectURL(datei);
  try {
    const bild = new Image();
    bild.src = url;
    await bild.decode();
    const faktor = Math.min(1, 1600 / Math.max(bild.naturalWidth, bild.naturalHeight));
    const flaeche = h('canvas', { width: Math.round(bild.naturalWidth * faktor), height: Math.round(bild.naturalHeight * faktor) });
    flaeche.getContext('2d').drawImage(bild, 0, 0, flaeche.width, flaeche.height);
    const blob = await new Promise((ok) => flaeche.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Bild konnte nicht umgewandelt werden.');
    return await blob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const bildAdresse = (puffer) => URL.createObjectURL(new Blob([puffer], { type: 'image/jpeg' }));

function blattAusgabe(id) {
  const alt = id ? hole('ausgabe', id) : null;
  const ausgaben = liste('ausgabe');
  let belegId = alt?.beleg || null;
  let neuesBild = null;              // frisch aufgenommen, noch nicht gespeichert

  const datum = h('input', { type: 'date', value: alt?.datum || heute(), max: '2099-12-31' });
  const bezeichnung = h('input', { type: 'text', value: alt?.bezeichnung || '', placeholder: 'z. B. Speicherkarte',
    list: 'v-bez', autocomplete: 'off', maxLength: 200 });
  const betrag = h('input', { type: 'text', inputMode: 'decimal', placeholder: '0,00',
    value: alt ? alt.betrag.toFixed(2).replace('.', ',') : '' });
  const kategorie = h('select', {}, KATEGORIEN.map(([k, name]) => h('option', { value: k }, name)));
  kategorie.value = alt?.kategorie || 'sonstiges';
  const notiz = h('textarea', { value: alt?.notiz || '', placeholder: 'optional', maxLength: 1000 });
  const fehler = h('p', { class: 'fehlertext', hidden: true });

  const vorschau = h('img', { alt: 'Belegfoto', hidden: true });
  const zeigen = (puffer) => {
    if (vorschau.src) URL.revokeObjectURL(vorschau.src);
    vorschau.hidden = !puffer;
    if (puffer) vorschau.src = bildAdresse(puffer);
    entfernen.hidden = !puffer;
  };
  const gewaehlt = async (ev) => {
    const datei = ev.target.files?.[0];
    ev.target.value = '';
    if (!datei) return;
    try {
      neuesBild = await bildVerkleinern(datei);
      zeigen(neuesBild);
    } catch {
      melden('Das Foto konnte nicht gelesen werden.', true);
    }
  };
  const kamera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'f-kamera', onchange: gewaehlt });
  const mediathek = h('input', { type: 'file', accept: 'image/*', id: 'f-mediathek', onchange: gewaehlt });
  const entfernen = h('button', { class: 'taste gefahr', type: 'button', hidden: true,
    onclick: () => { neuesBild = null; belegId = null; zeigen(null); } }, 'Foto entfernen');
  vorschau.addEventListener('click', () => vorschau.src && blatt('Beleg', [h('img', { class: 'beleg-gross', src: vorschau.src, alt: 'Belegfoto' })]));
  if (belegId) belegHolen(belegId).then((puffer) => { if (puffer && !neuesBild && belegId) zeigen(puffer); });

  blatt(alt ? 'Ausgabe' : 'Neue Ausgabe', [
    h('div', { class: 'felder' },
      feld('Datum', datum), feld('Wofür', bezeichnung), feld('Betrag in €', betrag), feld('Kategorie', kategorie)),
    h('div', { class: 'felder' },
      h('div', { class: 'beleg' }, vorschau,
        h('div', { class: 'tasten' },
          kamera, h('label', { class: 'taste', for: 'f-kamera' }, symbol('kamera'), 'Beleg fotografieren'),
          mediathek, h('label', { class: 'taste leise', for: 'f-mediathek' }, symbol('bild'), 'Aus Fotos wählen'))),
      entfernen),
    h('div', { class: 'felder' }, feld('Notiz', notiz)),
    fehler,
    vorschlaege('v-bez', ausgaben.map((a) => a.bezeichnung)),
    alt ? h('button', { class: 'taste gefahr', onclick: async (ev) => {
      if (await fragen('Ausgabe löschen?', 'Der Eintrag wird auch am Rechner entfernt.', [['Löschen', true, 'gefahr']])) {
        await loeschen('ausgabe', id);
        ev.target.closest('.ebene').remove();
        geaendert('Ausgabe gelöscht');
      }
    } }, 'Ausgabe löschen') : null,
  ], { name: 'Sichern', tun: async () => {
    const summe = zahlLesen(betrag.value);
    const meldung = !datum.value ? 'Bitte ein Datum wählen.'
      : !bezeichnung.value.trim() ? 'Wofür war die Ausgabe?'
        : !(summe > 0) ? 'Bitte den Betrag eintragen, z. B. 34,99.' : '';
    if (meldung) { fehler.textContent = meldung; fehler.hidden = false; return false; }
    if (neuesBild) belegId = await belegSpeichern(neuesBild);
    await speichern('ausgabe', { id, datum: datum.value, bezeichnung: bezeichnung.value.trim(), betrag: summe,
      kategorie: kategorie.value, beleg: belegId, notiz: notiz.value.trim() });
    geaendert(alt ? 'Ausgabe geändert' : 'Ausgabe gespeichert');
  } });
  if (!alt) bezeichnung.focus();
}

// ── Rechnung ─────────────────────────────────────────────────────────────────
function blattRechnung(id) {
  const r = hole('rechnung', id);
  if (!r) return;
  const fahrten = liste('fahrt').filter((f) => f.rechnung === r.nummer);
  const strecke = fahrten.reduce((s, f) => s + (f.km || 0), 0);
  const tag = h('input', { type: 'date', value: heute(), max: heute() });
  const zeile = (name, wert) => h('div', { class: 'posten' }, h('span', {}, name), h('span', { class: 'zahl' }, wert));
  const setzen = async (status, ev) => {
    if (status === 'bezahlt' && !tag.value) return melden('Bitte den Tag des Zahlungseingangs wählen.', true);
    await rechnungStatus(id, status, tag.value);
    ev.target.closest('.ebene').remove();
    geaendert(status === 'bezahlt' ? 'Als bezahlt markiert' : 'Wieder offen');
  };
  blatt(`Rechnung ${r.nummer}`, [
    h('section', { class: 'karte' },
      h('p', { class: 'klein' }, r.kunde || '–'),
      h('p', { class: 'gross zahl' }, euro(r.betrag)),
      h('span', { class: 'chip ' + r.status }, statusName(r.status))),
    h('div', { class: 'daten' },
      zeile('Rechnungsnummer', r.nummer), zeile('Datum', datumKurz(r.datum)),
      r.status === 'bezahlt' ? zeile('Bezahlt am', r.bezahlt_am ? datumKurz(r.bezahlt_am) : 'ohne Datum') : null,
      fahrten.length ? zeile(`${fahrten.length} ${fahrten.length === 1 ? 'Fahrt' : 'Fahrten'}`,
        `${km(strecke)} · ${euro(strecke * KM_PAUSCHALE)}`) : null),
    r.status === 'offen' ? [
      h('div', { class: 'felder' }, feld('Geld eingegangen am', tag)),
      h('button', { class: 'taste', onclick: (ev) => setzen('bezahlt', ev) }, symbol('haken'), 'Als bezahlt markieren'),
    ] : null,
    r.status === 'bezahlt'
      ? h('button', { class: 'taste leise', onclick: (ev) => setzen('offen', ev) }, 'Doch noch offen') : null,
    r.status === 'storniert' ? h('p', { class: 'erklaerung' }, 'Diese Rechnung wurde am Rechner storniert.') : null,
    h('p', { class: 'erklaerung' }, 'Rechnungen werden am Rechner geschrieben. Hier siehst du sie und hältst fest, wenn das Geld da ist.'),
  ]);
}

// ── Einstellungen / Abgleich ─────────────────────────────────────────────────
function blattEinstellungen() {
  let zu;
  const neu = () => { zu(); blattEinstellungen(); };
  if (!verbunden()) {
    const repo = h('input', { type: 'text', placeholder: 'konto/rechnungssoftware-daten', autocomplete: 'off',
      autocapitalize: 'none', spellcheck: false, value: merker('repo') || '' });
    const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
    const passwort = h('input', { type: 'password', placeholder: 'dasselbe wie am Rechner', autocomplete: 'current-password' });
    const fehler = h('p', { class: 'fehlertext', hidden: true });
    const knopf = h('button', { class: 'taste', onclick: async () => {
      if (!repo.value.trim() || !token.value.trim() || !passwort.value) {
        fehler.textContent = 'Bitte alle drei Felder ausfüllen.'; fehler.hidden = false; return;
      }
      knopf.disabled = true; knopf.textContent = 'Prüfe Zugang …'; fehler.hidden = true;
      try {
        await verbinden(repo.value, token.value, passwort.value);
        merker('repo', repo.value.trim());
        navigator.storage?.persist?.();
        zu(); zeichnen(); melden('Verbunden'); syncJetzt(true);
      } catch (e) {
        fehler.textContent = e.message; fehler.hidden = false;
        knopf.disabled = false; knopf.textContent = 'Verbinden';
      }
    } }, 'Verbinden');
    zu = blatt('Abgleich einrichten', [
      h('p', { class: 'erklaerung' }, 'Die App gleicht sich über ein ', h('strong', {}, 'privates'),
        ' GitHub-Repository mit dem Rechner ab. Alles wird auf diesem Gerät verschlüsselt, bevor es hochgeladen wird.'),
      h('div', { class: 'felder' }, feld('Repository', repo), feld('Token', token), feld('Passwort', passwort)),
      fehler, knopf,
      h('p', { class: 'erklaerung wichtig' }, 'Geht das Passwort verloren, sind die Daten auf GitHub nicht mehr lesbar. Bewahre es gut auf.'),
      h('p', { class: 'erklaerung' }, 'Das Token gilt nur für dieses eine Repository (Fine-grained Token, Berechtigung „Contents: Read and write"). Token und Schlüssel bleiben auf diesem Gerät.'),
      versionZeile(),
    ]);
    return;
  }
  const n = wartend();
  zu = blatt('Abgleich', [
    h('div', { class: 'daten' },
      h('div', { class: 'posten' }, h('span', {}, 'Repository'), h('span', {}, Z.konfig.repo)),
      h('div', { class: 'posten' }, h('span', {}, 'Letzter Abgleich'), h('span', {}, Z.konfig.zuletzt
        ? new Date(Z.konfig.zuletzt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie')),
      h('div', { class: 'posten' }, h('span', {}, 'Wartet auf Abgleich'), h('span', {}, n ? `${n} ${n === 1 ? 'Eintrag' : 'Einträge'}` : 'nichts'))),
    ui.syncFehler ? h('p', { class: 'fehlertext' }, ui.syncFehler) : null,
    h('button', { class: 'taste', onclick: async () => { await syncJetzt(true); neu(); } }, symbol('sync'), 'Jetzt abgleichen'),
    h('p', { class: 'erklaerung' }, 'Die App gleicht von selbst ab, sobald sie geöffnet wird oder du etwas einträgst. Ohne Netz bleibt alles auf dem Gerät und wird später nachgereicht.'),
    h('button', { class: 'taste gefahr', onclick: async () => {
      const wahl = await fragen('Verbindung trennen?', n
        ? `Achtung: ${n} ${n === 1 ? 'Eintrag ist' : 'Einträge sind'} noch nicht hochgeladen.`
        : 'Token und Schlüssel werden von diesem Gerät entfernt.',
      [['Nur trennen', 'trennen'], ['Trennen und Daten hier löschen', 'loeschen', 'gefahr']]);
      if (!wahl) return;
      await trennen(wahl === 'loeschen');
      ui.syncFehler = '';
      zu(); zeichnen(); melden('Getrennt');
    } }, 'Verbindung trennen'),
    versionZeile(),
  ]);
}

const versionZeile = () => h('p', { class: 'stand' }, `Rechnungssoftware mobil ${APP_VERSION}`);

let syncUhr;
function geaendert(text) {
  zeichnen();
  if (text) melden(text);
  clearTimeout(syncUhr);
  syncUhr = setTimeout(() => syncJetzt(false), 1500);
}

async function syncJetzt(laut) {
  if (!verbunden()) { if (laut) blattEinstellungen(); return; }
  if (laeuftGerade()) return;
  if (!navigator.onLine) {
    if (laut) melden('Kein Netz – der Abgleich läuft, sobald du wieder online bist.');
    return;
  }
  ui.letzterVersuch = Date.now();
  const lauf = abgleichen();
  syncKnopfZeichnen();
  try {
    const erg = await lauf;
    ui.syncFehler = '';
    if (erg && laut) {
      melden(erg.empfangen || erg.gesendet
        ? [erg.empfangen ? `${erg.empfangen} empfangen` : '', erg.gesendet ? `${erg.gesendet} gesendet` : ''].filter(Boolean).join(' · ')
        : 'Alles auf dem neuesten Stand');
    }
    // Konflikte lösen sich im nächsten Lauf – höchstens zweimal direkt nachfassen.
    if (erg?.konflikte && ui.nachfassen < 2) { ui.nachfassen++; setTimeout(() => syncJetzt(false), 800); }
    else ui.nachfassen = 0;
  } catch (e) {
    ui.syncFehler = e instanceof SyncFehler ? e.message : 'Abgleich fehlgeschlagen.';
    if (laut) melden(ui.syncFehler, true);
  }
  if (!document.querySelector('.ebene')) zeichnen(); else syncKnopfZeichnen();
}

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  rahmenBauen();
  try {
    await laden();
  } catch {
    inhalt.replaceChildren(leer('ausgabe', 'Speicher nicht verfügbar',
      'Die App kann auf diesem Gerät nichts speichern. Im privaten Modus von Safari geht das nicht.'));
    return;
  }
  zeichnen();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  syncJetzt(false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - ui.letzterVersuch > 30000) syncJetzt(false);
  });
  addEventListener('online', () => syncJetzt(false));
}

start();
