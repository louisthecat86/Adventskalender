// Einundzwanzig Adventskalender – Kalenderseite
import { CONFIG } from '../config.js'
import {
  hostHex, aktuelleSession, logout, ladeTuerchen, ladeProfil, anzeigeName,
  eigeneTeilnahme, reaktion, antwort, neventLink, MODUS_TEXT,
} from './nostr.js'
import { offeneTuerchenBis, statusText, vorschauDatum, formatDatum } from './zeit.js'
import { esc, renderInhalt, TYP } from './inhalt.js'
import { $, toast, schnee } from './ui.js'
import { initLogin } from './login.js'
import { ladeVerlosungsStatus } from './verlosung.js'
import { gewinnerHtml, verbindePruefung } from './verlosung-ui.js'

// Feste, „zufällige“ Anordnung und Größen der Türchen
const REIHENFOLGE = [7, 15, 1, 22, 10, 3, 18, 24, 12, 5, 20, 9, 2, 16, 13, 6, 23, 11, 19, 4, 14, 8, 21, 17]
const BREIT = new Set([1, 4, 6, 9, 12, 15, 17, 20, 22])
const GROSS = new Set([24])

const zustand = {
  tuerchen: new Map(), // nr → Türchen (erst nach Login geladen)
  geladen: false,
  offenBis: offeneTuerchenBis(),
}

let oeffneLogin = () => {}

// ---------- Gemerkte geöffnete Türchen ----------
const offenKey = () => `e21-advent-offen-${aktuelleSession()?.pubkey}`
function geoeffnet() {
  try { return new Set(JSON.parse(localStorage.getItem(offenKey()) || '[]')) } catch { return new Set() }
}
function merkeGeoeffnet(nr) {
  const s = geoeffnet()
  s.add(nr)
  try { localStorage.setItem(offenKey(), JSON.stringify([...s])) } catch { /* egal */ }
}

// ---------- Kopf ----------
async function renderHost() {
  const host = hostHex()
  const el = $('#host')
  if (!host) {
    el.innerHTML = '<span class="fehler">Kein Host-npub in config.js eingetragen.</span>'
    return
  }
  const p = await ladeProfil(host)
  el.innerHTML = `
    ${p.picture ? `<img class="avatar" src="${esc(p.picture)}" alt="">` : ''}
    <span>Präsentiert von <a href="${CONFIG.nostrViewer}${CONFIG.hostNpub}" target="_blank" rel="noopener">${esc(anzeigeName(p, host))}</a></span>`
}

async function renderNutzer() {
  const el = $('#nutzer')
  const s = aktuelleSession()
  if (!s) {
    el.innerHTML = '<button class="knopf klein" id="login-knopf">Mit Nostr anmelden</button>'
    $('#login-knopf').onclick = () => oeffneLogin()
    return
  }
  el.innerHTML = '<span class="leise"><span class="lade"></span></span>'
  const p = await ladeProfil(s.pubkey)
  el.innerHTML = `
    ${p.picture ? `<img class="avatar" src="${esc(p.picture)}" alt="">` : ''}
    <span>${esc(anzeigeName(p, s.pubkey))}</span>
    <button class="knopf zweit klein" id="logout-knopf">Abmelden</button>`
  $('#logout-knopf').onclick = async () => {
    await logout()
    zustand.tuerchen = new Map()
    zustand.geladen = false
    renderNutzer()
    renderKalender()
    toast('Abgemeldet.')
  }
}

// ---------- Kalender ----------
function renderKalender() {
  const offen = geoeffnet()
  const angemeldet = !!aktuelleSession()
  $('#kalender').innerHTML = REIHENFOLGE.map((nr) => {
    const darf = nr <= zustand.offenBis
    const t = zustand.tuerchen.get(nr)
    const klassen = ['tuer']
    if (BREIT.has(nr)) klassen.push('breit')
    if (GROSS.has(nr)) klassen.push('gross')
    let meta
    if (!darf) {
      klassen.push('zu')
      meta = `<span>🔒</span><span>${nr}.12.</span>`
    } else if (!angemeldet) {
      klassen.push('bereit')
      meta = '<span>Login</span><span>⚡</span>'
    } else if (zustand.geladen && !t) {
      klassen.push('leer')
      meta = '<span>noch leer</span><span>…</span>'
    } else {
      klassen.push('bereit')
      meta = `<span>${t ? esc(TYP[t.typ]?.label || '') : ''}</span><span>${t ? TYP[t.typ]?.icon || '' : ''}</span>`
    }
    if (nr === zustand.offenBis && darf) klassen.push('heute')
    if (t && offen.has(nr)) klassen.push('offen')
    const innen = t
      ? `${t.bild ? `<img class="vorschaubild" src="${esc(t.bild)}" alt="" loading="lazy">` : ''}
         <span class="typ">${TYP[t.typ]?.icon || ''} ${esc(TYP[t.typ]?.label || '')}</span>
         <span class="titel">${esc(t.titel)}</span>`
      : ''
    return `
      <button class="${klassen.join(' ')}" data-nr="${nr}" aria-label="Türchen ${nr}${darf ? '' : ', noch verschlossen'}">
        <span class="innen">${innen}</span>
        <span class="deckel"><span class="nr">${nr}</span><span class="meta">${meta}</span></span>
      </button>`
  }).join('')
}

function klickTuer(btn) {
  const nr = +btn.dataset.nr
  if (nr > zustand.offenBis) {
    btn.classList.remove('wackeln')
    void btn.offsetWidth
    btn.classList.add('wackeln')
    toast(`Geduld, Stacker! Türchen ${nr} geht am ${nr}. Dezember auf.`)
    return
  }
  if (!aktuelleSession()) return oeffneLogin()
  if (!zustand.geladen) {
    toast('Türchen werden noch von den Relays geladen …')
    return
  }
  const t = zustand.tuerchen.get(nr)
  if (!t) {
    toast(`Türchen ${nr} hat der Host noch nicht befüllt. Schau später nochmal vorbei.`)
    return
  }
  const warSchonOffen = btn.classList.contains('offen')
  btn.classList.add('offen')
  merkeGeoeffnet(nr)
  setTimeout(() => zeigeTuer(t), warSchonOffen ? 0 : 700)
}

async function ladeUndZeige() {
  if (!aktuelleSession()) return
  try {
    zustand.tuerchen = await ladeTuerchen()
    // Nur Türchen anzeigen, deren Datum erreicht ist
    for (const nr of [...zustand.tuerchen.keys()]) if (nr > zustand.offenBis) zustand.tuerchen.delete(nr)
    zustand.geladen = true
    renderKalender()
  } catch (e) {
    toast(e.message, 6000)
  }
}

// ---------- Türchen-Dialog ----------
function zeigeTuer(t) {
  const typ = TYP[t.typ] || TYP.text
  const v = t.verlosung
  const jetzt = Math.floor(Date.now() / 1000)
  const vorbei = v?.ende && jetzt > v.ende
  $('#tuer-dialog').dataset.nr = String(t.nr)
  $('#tuer-inhalt').innerHTML = `
    <div class="tuer-kopf"><span class="gross-nr">${t.nr}</span>
      <div><span class="badge">${typ.icon} ${typ.label}</span><h2>${esc(t.titel)}</h2></div></div>
    ${t.bild ? `<img class="titelbild" src="${esc(t.bild)}" alt="">` : ''}
    <div class="inhalt">${renderInhalt(t.inhalt)}</div>
    ${v ? `
      <div class="verlosung">
        <h3>🎁 Verlosung${v.preis ? `: ${esc(v.preis)}` : ''}</h3>
        <div class="leise" id="vl-text">${vorbei
          ? `Beendet am ${formatDatum(v.ende)}. Der Gewinner wird auf Nostr bekannt gegeben.`
          : `Teilnahme ${v.ende ? `bis ${formatDatum(v.ende)}` : 'offen'}. So bist du dabei: ${v.modi.map((m) => MODUS_TEXT[m] || m).join(' oder ')}.`}</div>
        <div id="vl-ergebnis" style="margin-top:.8rem"></div>
        ${vorbei ? '' : `<div id="vl-mitmachen">
          <div id="teilnahme-status" class="leise" style="margin-top:.5rem"><span class="lade"></span> prüfe deine Teilnahme …</div>
          <div class="zeile">
            ${v.modi.includes('reaction') ? '<button class="knopf" id="btn-reaktion">🧡 Reagieren</button>' : ''}
            ${v.modi.includes('zap') ? `<a class="knopf zweit" href="${neventLink(t.event)}" target="_blank" rel="noopener">⚡ In Nostr-App zappen</a>` : ''}
          </div>
          ${v.modi.includes('reply') ? `
            <textarea id="antwort-text" placeholder="Deine Antwort auf das Türchen …" maxlength="1000"></textarea>
            <div class="zeile"><button class="knopf zweit" id="btn-antwort">Antwort senden</button></div>` : ''}
        </div>`}
      </div>` : ''}
    <div class="tuer-fuss">
      <span>Veröffentlicht ${formatDatum(t.erstellt)}</span>
      <a href="${neventLink(t.event)}" target="_blank" rel="noopener">Auf Nostr ansehen ↗</a>
    </div>`
  $('#tuer-dialog').showModal()
  if (v && !vorbei) verlosungAktionen(t)
  if (v) zeigeVerlosungsStatus(t)
}

/** Zeigt Festschreibung bzw. Gewinner (inkl. Nachprüfung) im Türchen an */
async function zeigeVerlosungsStatus(t) {
  try {
    const { freeze, ergebnis } = await ladeVerlosungsStatus(t)
    const ziel = $('#vl-ergebnis')
    if (!ziel || $('#tuer-dialog').dataset.nr !== String(t.nr)) return
    if (ergebnis || freeze) $('#vl-mitmachen')?.remove()
    if (ergebnis) {
      if (t.verlosung.ende) $('#vl-text').textContent = `Beendet am ${formatDatum(t.verlosung.ende)}.`
      ziel.innerHTML = await gewinnerHtml(ergebnis)
      verbindePruefung(ziel, freeze, ergebnis)
    } else if (freeze) {
      ziel.innerHTML = `<p class="leise">🔒 Die Teilnahme ist geschlossen. ${freeze.teilnehmer.length} Teilnehmer sind im Lostopf. Gezogen wird mit Bitcoin-Block #${freeze.hoehe}.</p>`
    }
  } catch { /* Status ist optional */ }
}

function verlosungAktionen(t) {
  const s = aktuelleSession()
  const status = $('#teilnahme-status')
  const aktualisiere = (tn) => {
    const dabei = tn.reagiert || tn.geantwortet
    status.innerHTML = dabei ? '✅ Du bist im Lostopf.' : 'Du bist noch nicht dabei.'
    const r = $('#btn-reaktion')
    if (r && tn.reagiert) {
      r.disabled = true
      r.classList.add('erledigt')
      r.textContent = '🧡 Reagiert'
    }
  }
  eigeneTeilnahme(t.id, s.pubkey).then(aktualisiere).catch(() => { status.textContent = '' })

  const r = $('#btn-reaktion')
  if (r) r.onclick = async () => {
    r.disabled = true
    r.innerHTML = '<span class="lade"></span> signiere …'
    try {
      await reaktion(t)
      aktualisiere({ reagiert: true })
      toast('Reaktion gesendet. Du bist im Lostopf!')
    } catch (e) {
      r.disabled = false
      r.textContent = '🧡 Reagieren'
      toast(e.message || 'Signieren abgelehnt.', 5000)
    }
  }
  const a = $('#btn-antwort')
  if (a) a.onclick = async () => {
    const text = $('#antwort-text').value.trim()
    if (!text) return toast('Schreib erst etwas.')
    a.disabled = true
    a.innerHTML = '<span class="lade"></span> sende …'
    try {
      await antwort(t, text)
      $('#antwort-text').value = ''
      aktualisiere({ geantwortet: true })
      a.textContent = 'Gesendet ✓'
      toast('Antwort veröffentlicht!')
    } catch (e) {
      a.disabled = false
      a.textContent = 'Antwort senden'
      toast(e.message || 'Senden fehlgeschlagen.', 5000)
    }
  }
}

// ---------- Start ----------
function init() {
  document.title = CONFIG.titel
  $('#jahr').textContent = CONFIG.jahr
  $('#status').textContent = statusText()
  $('#hashtag-info').textContent = '#' + CONFIG.hashtag
  $('#podcast-link').href = CONFIG.podcastUrl
  const vd = vorschauDatum()
  if (vd) {
    const h = $('#vorschau-hinweis')
    h.hidden = false
    h.textContent = `Vorschau-Modus: angezeigt wie am ${vd.tag}.${vd.monat}.${vd.jahr}`
  }
  oeffneLogin = initLogin({
    onLogin: async () => {
      await renderNutzer()
      renderKalender()
      toast('Willkommen! Die Türchen werden geladen …')
      await ladeUndZeige()
    },
  })
  $('#kalender').addEventListener('click', (e) => {
    const b = e.target.closest('.tuer')
    if (b) klickTuer(b)
  })
  renderKalender()
  renderNutzer()
  renderHost()
  schnee($('#schnee'))
  ladeUndZeige()
  // Um Mitternacht automatisch das neue Türchen freischalten
  setInterval(() => {
    const neu = offeneTuerchenBis()
    if (neu !== zustand.offenBis) {
      zustand.offenBis = neu
      $('#status').textContent = statusText()
      ladeUndZeige()
      renderKalender()
    }
  }, 60000)
}

init()
