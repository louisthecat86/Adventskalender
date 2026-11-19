// Host-Bereich: Türchen vorbereiten (verschlüsselte Entwürfe) und am Tag veröffentlichen
import { CONFIG } from '../config.js'
import {
  hostHex, aktuelleSession, logout, ladeTuerchen, ladeProfil, ladeProfile, anzeigeName, nip19,
  ladeEntwuerfe, speichereEntwurf, veroeffentlicheTuer, baueTuerEvent, neventLink, MODUS_TEXT,
} from './nostr.js'
import { offeneTuerchenBis, vorschauDatum, formatDatum } from './zeit.js'
import { esc, renderInhalt, TYP } from './inhalt.js'
import { sammleTeilnehmer, ladeVerlosungsStatus, schreibeTeilnehmerFest, ziehe, blockHash, hatProfil, ladeNetzwerk } from './verlosung.js'
import { gewinnerHtml, verbindePruefung } from './verlosung-ui.js'
import { $, $$, toast } from './ui.js'
import { initLogin } from './login.js'

const zustand = {
  entwuerfe: new Map(), // nr → Entwurf { titel, typ, bild, text, preis, modi, ende, gespeichert }
  live: new Map(), // nr → veröffentlichtes Türchen
  aktuell: 1,
  ungespeichert: false,
  manuell: new Map(), // nr → Map pubkey → true (aufnehmen) / false (ausschließen), überstimmt den Filter
  filter: { profil: CONFIG.spamFilter?.nurMitProfil ?? true, netzwerk: CONFIG.spamFilter?.nurNetzwerk ?? false },
}
let panelLauf = 0

let oeffneLogin = () => {}

// ---------- Hilfen ----------
const zwei = (n) => String(n).padStart(2, '0')
const lokalKey = (nr) => `e21-advent-lokal-${aktuelleSession()?.pubkey}-${nr}`

function leererEntwurf(nr) {
  return { titel: '', typ: 'text', bild: '', text: '', preis: '', modi: ['reaction', 'reply', 'zap'], ende: standardEnde(nr) }
}

/** Standard-Teilnahmeschluss: am Türchen-Tag um 23:59 (Browserzeit) */
function standardEnde(nr) {
  return Math.floor(new Date(`${CONFIG.jahr}-12-${zwei(nr)}T23:59`).getTime() / 1000)
}

function unixZuLokal(u) {
  if (!u) return ''
  const d = new Date(u * 1000)
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`
}

function lokalZuUnix(v) {
  return v ? Math.floor(new Date(v).getTime() / 1000) : null
}

function bestaetige(titel, html, jaText = 'Ja, veröffentlichen') {
  const d = $('#bestaetigen')
  $('#best-titel').textContent = titel
  $('#best-text').innerHTML = html
  $('#best-ja').textContent = jaText
  d.showModal()
  return new Promise((resolve) => {
    $('#best-ja').onclick = () => { d.close(); resolve(true) }
    $('#best-nein').onclick = () => { d.close(); resolve(false) }
    d.onclose = () => resolve(false)
  })
}

// ---------- Hinweis „Nächster Schritt“ ----------
function tipp(html, art = '') {
  const el = $('#naechster-schritt')
  el.className = `tipp ${art}`
  el.innerHTML = html ? `<strong>Nächster Schritt:</strong> ${html}` : ''
}

/** Grund-Hinweis aus Datum und Stand des Türchens (Verlosung überschreibt ihn später) */
function tippGrund() {
  const nr = zustand.aktuell
  const live = zustand.live.get(nr)
  const entwurf = zustand.entwuerfe.get(nr)
  const darf = nr <= offeneTuerchenBis()
  if (zustand.ungespeichert) return tipp('Du hast ungespeicherte Änderungen. Klicke <em>Entwurf speichern</em>.')
  if (live) {
    if (live.verlosung) return tipp('<span class="lade"></span> Stand der Verlosung wird geladen …', 'warte')
    return tipp('Nichts zu tun. Das Türchen ist live ✅', 'ok')
  }
  if (!entwurf) return tipp(`Titel und Inhalt eintragen, dann <em>Entwurf speichern</em>.${darf ? '' : ` Veröffentlichen geht ab dem ${nr}. Dezember.`}`)
  if (darf) return tipp('Heute ist dieses Türchen dran: Entwurf kurz prüfen und <em>Veröffentlichen</em> klicken.')
  return tipp(`Entwurf ist gespeichert. Am ${nr}. Dezember hier <em>Veröffentlichen</em> klicken.`, 'ok')
}

// ---------- Formular <-> Entwurf ----------
function formularLesen() {
  return {
    titel: $('#f-titel').value,
    typ: $('#f-typ').value,
    bild: $('#f-bild').value.trim(),
    text: $('#f-text').value,
    preis: $('#f-preis').value,
    modi: $$('.f-modus').filter((c) => c.checked).map((c) => c.value),
    ende: lokalZuUnix($('#f-ende').value),
  }
}

function formularFuellen(e) {
  $('#f-titel').value = e.titel || ''
  $('#f-typ').value = e.typ || 'text'
  $('#f-bild').value = e.bild || ''
  $('#f-text').value = e.text || ''
  $('#f-preis').value = e.preis || ''
  $$('.f-modus').forEach((c) => { c.checked = (e.modi || []).includes(c.value) })
  $('#f-ende').value = unixZuLokal(e.ende)
  $('#f-verlosung').hidden = $('#f-typ').value !== 'verlosung'
}

function pruefe(e) {
  if (!e.titel.trim()) return 'Bitte einen Titel eingeben.'
  if (!e.text.trim()) return 'Bitte einen Inhalt eingeben.'
  if (e.bild && !/^https:\/\/\S+$/.test(e.bild)) return 'Die Bild-URL muss mit https:// beginnen.'
  if (e.typ === 'verlosung') {
    if (!e.modi.length) return 'Bitte mindestens eine Teilnahme-Art wählen.'
    if (!e.ende) return 'Bitte ein Teilnahme-Ende festlegen.'
  }
  return null
}

// ---------- Darstellung ----------
function statusVon(nr) {
  if (zustand.live.has(nr)) return { klasse: 'live', text: 'Veröffentlicht' }
  if (zustand.entwuerfe.has(nr)) return { klasse: 'entwurf', text: 'Entwurf' }
  return { klasse: '', text: 'Leer' }
}

function renderListe() {
  const heute = offeneTuerchenBis()
  $('#tuerliste').innerHTML = Array.from({ length: 24 }, (_, i) => {
    const nr = i + 1
    const titel = zustand.live.get(nr)?.titel || zustand.entwuerfe.get(nr)?.titel
    const st = statusVon(nr)
    return `<button type="button" data-nr="${nr}" aria-current="${nr === zustand.aktuell}" class="${nr === heute ? 'heute' : ''}">
      <span class="lnr">${nr}</span>
      <span class="ltitel ${titel ? '' : 'leer'}">${esc(titel || 'noch leer')}</span>
      <span class="chip punkt ${st.klasse}" title="${st.text}"></span>
    </button>`
  }).join('')
  const anzE = [...Array(24).keys()].filter((i) => zustand.entwuerfe.has(i + 1) || zustand.live.has(i + 1)).length
  $('#admin-status').textContent = `${anzE} von 24 Türchen vorbereitet · ${zustand.live.size} veröffentlicht`
}

function renderVorschau() {
  const e = formularLesen()
  const nr = zustand.aktuell
  const typ = TYP[e.typ] || TYP.text
  const wie = e.modi.map((m) => MODUS_TEXT[m]).join(' oder ')
  $('#vorschau-kalender').innerHTML = `
    <div class="tuer-kopf"><span class="gross-nr">${nr}</span>
      <div><span class="badge">${typ.icon} ${typ.label}</span><h2>${esc(e.titel || 'Titel fehlt')}</h2></div></div>
    ${e.bild ? `<img class="titelbild" src="${esc(e.bild)}" alt="">` : ''}
    <div class="inhalt">${renderInhalt(e.text || '…')}</div>
    ${e.typ === 'verlosung' ? `
      <div class="verlosung">
        <h3>🎁 Verlosung${e.preis ? `: ${esc(e.preis)}` : ''}</h3>
        <div class="leise">Teilnahme ${e.ende ? `bis ${formatDatum(e.ende)}` : 'offen'}. So bist du dabei: ${esc(wie || '–')}.</div>
      </div>` : ''}`
  $('#vorschau-nostr').textContent = baueTuerEvent(nr, e).content
}

function renderKnoepfe() {
  const nr = zustand.aktuell
  const darf = nr <= offeneTuerchenBis()
  const live = zustand.live.get(nr)
  const b = $('#btn-veroeffentlichen')
  b.disabled = !darf
  b.textContent = !darf ? `Veröffentlichen ab ${nr}.12.` : live ? 'Korrektur veröffentlichen' : 'Veröffentlichen'
  const st = statusVon(nr)
  const chip = $('#ed-status')
  chip.className = `chip ${st.klasse}`
  chip.innerHTML = live
    ? `<a href="${neventLink(live.event)}" target="_blank" rel="noopener" style="color:inherit">Veröffentlicht ${formatDatum(live.erstellt)} ↗</a>`
    : st.text
  $('#ungespeichert').hidden = !zustand.ungespeichert
  tippGrund()
}

function waehleTuer(nr) {
  zustand.aktuell = nr
  $('#ed-titel').textContent = `Türchen ${nr}`
  // Reihenfolge: lokale ungespeicherte Änderung > Entwurf auf Relays > veröffentlichte Version > leer
  let e = zustand.entwuerfe.get(nr)
  const l = zustand.live.get(nr)
  if (!e && l) {
    e = { titel: l.titel, typ: l.typ, bild: l.bild || '', text: l.inhalt, preis: l.verlosung?.preis || '', modi: l.verlosung?.modi || ['reaction', 'reply', 'zap'], ende: l.verlosung?.ende || standardEnde(nr) }
  }
  zustand.ungespeichert = false
  try {
    const lokal = JSON.parse(localStorage.getItem(lokalKey(nr)) || 'null')
    if (lokal && (!e?.gespeichert || lokal.geaendert > e.gespeichert * 1000)) {
      e = lokal
      zustand.ungespeichert = true
    }
  } catch { /* egal */ }
  formularFuellen(e || leererEntwurf(nr))
  renderListe()
  renderVorschau()
  renderKnoepfe()
  renderVerlosung()
}

// ---------- Aktionen ----------
async function speichern({ still = false } = {}) {
  const nr = zustand.aktuell
  const e = formularLesen()
  if (!e.titel.trim() && !e.text.trim()) {
    toast('Leere Türchen werden nicht gespeichert.')
    return false
  }
  const b = $('#btn-speichern')
  b.disabled = true
  b.innerHTML = '<span class="lade"></span> verschlüssele …'
  try {
    const res = await speichereEntwurf(nr, e)
    zustand.entwuerfe.set(nr, { ...e, gespeichert: res.event.created_at })
    zustand.ungespeichert = false
    try { localStorage.removeItem(lokalKey(nr)) } catch { /* egal */ }
    if (!still) toast(`Entwurf ${nr} verschlüsselt gespeichert (${res.relaysOk}/${res.relaysGesamt} Relays).`)
    renderListe()
    renderKnoepfe()
    return true
  } catch (err) {
    toast(err.message || 'Speichern fehlgeschlagen.', 6000)
    return false
  } finally {
    b.disabled = false
    b.textContent = 'Entwurf speichern'
  }
}

async function veroeffentlichen() {
  const nr = zustand.aktuell
  const e = formularLesen()
  const fehler = pruefe(e)
  if (fehler) return toast(fehler, 5000)
  const alt = zustand.live.get(nr)
  const zuFrueh = nr > offeneTuerchenBis(true)
  let text = `Türchen ${nr} „${esc(e.titel)}“ wird jetzt als <strong>öffentlicher Nostr-Post</strong> mit deinem Schlüssel veröffentlicht. Es erscheint im Kalender und in allen Nostr-Apps unter #${esc(CONFIG.hashtag)}.`
  if (zuFrueh) text += `<br><br><strong class="fehler">Achtung: Du bist im Vorschau-Modus. Heute ist noch nicht der ${nr}. Dezember. Der Inhalt wäre sofort für alle sichtbar.</strong>`
  if (alt) text += `<br><br>Die bisherige Fassung wird gelöscht (NIP-09) und durch die neue ersetzt.${alt.verlosung ? ' <strong>Reaktionen und Antworten auf die alte Fassung hängen weiter an ihr. Korrigiere eine laufende Verlosung nur, wenn es nötig ist.</strong>' : ''}`
  if (!(await bestaetige(alt ? 'Korrektur veröffentlichen?' : 'Türchen veröffentlichen?', text))) return

  const b = $('#btn-veroeffentlichen')
  b.disabled = true
  b.innerHTML = '<span class="lade"></span> signiere …'
  try {
    if (!(await speichern({ still: true }))) throw new Error('Entwurf konnte nicht gespeichert werden.')
    const res = await veroeffentlicheTuer(nr, e, alt?.event)
    toast(`🎄 Türchen ${nr} ist live (${res.relaysOk}/${res.relaysGesamt} Relays).`, 5000)
    zustand.live = await ladeTuerchen()
  } catch (err) {
    toast(err.message || 'Veröffentlichen fehlgeschlagen.', 6000)
  } finally {
    renderListe()
    renderKnoepfe()
    renderVerlosung()
  }
}

function geaendert() {
  zustand.ungespeichert = true
  $('#f-verlosung').hidden = $('#f-typ').value !== 'verlosung'
  try {
    localStorage.setItem(lokalKey(zustand.aktuell), JSON.stringify({ ...formularLesen(), geaendert: Date.now() }))
  } catch { /* egal */ }
  renderVorschau()
  $('#ungespeichert').hidden = false
  tippGrund()
}

// ---------- Verlosung durchführen ----------
const ARTEN = { reaction: '🧡', reply: '💬', zap: '⚡' }

async function renderVerlosung() {
  const lauf = ++panelLauf
  const nr = zustand.aktuell
  const t = zustand.live.get(nr)
  const panel = $('#verlosung-panel')
  const box = $('#vl-inhalt')
  if (!t?.verlosung) {
    panel.hidden = true
    return
  }
  panel.hidden = false
  box.innerHTML = '<p class="leise"><span class="lade"></span> lade Verlosung …</p>'
  const aktuell = () => lauf === panelLauf
  try {
    const status = await ladeVerlosungsStatus(t)
    if (!aktuell()) return

    // 3. Ergebnis steht fest
    if (status.ergebnis) {
      if (!zustand.ungespeichert) tipp('Gewinner steht fest 🎉 Preis ausliefern, sobald er sich per Direktnachricht bei dir meldet.', 'ok')
      box.innerHTML = await gewinnerHtml(status.ergebnis)
      if (aktuell()) verbindePruefung(box, status.freeze, status.ergebnis)
      return
    }

    // 2. Liste ist festgeschrieben → auf Block warten und ziehen
    if (status.freeze) {
      const f = status.freeze
      const hash = await blockHash(f.hoehe).catch(() => null)
      if (!aktuell()) return
      if (!zustand.ungespeichert) {
        if (hash) tipp('Der Block ist da. Klicke unten <em>Gewinner ziehen</em>.')
        else tipp(`Warten, bis Bitcoin-Block #${f.hoehe} gefunden ist (meist 10 bis 30 Minuten), dann unten <em>Aktualisieren</em> und <em>Gewinner ziehen</em>.`, 'warte')
      }
      box.innerHTML = `
        <p>🔒 Teilnehmerliste festgeschrieben: <strong>${f.teilnehmer.length} Teilnehmer</strong>.<br>
        Gezogen wird mit Bitcoin-Block <strong>#${f.hoehe}</strong>:
        ${hash ? '✅ Block ist gefunden.' : '⏳ noch nicht gefunden. Das dauert meist 10 bis 30 Minuten.'}</p>
        <div class="zeile">
          <button type="button" class="knopf" id="vl-ziehen" ${hash ? '' : 'disabled'}>🎲 Gewinner ziehen</button>
          <button type="button" class="knopf zweit" id="vl-neu">Aktualisieren</button>
        </div>`
      $('#vl-neu').onclick = renderVerlosung
      $('#vl-ziehen').onclick = async () => {
        const ok = await bestaetige('Gewinner ziehen?',
          `Der Gewinner wird aus Block #${f.hoehe} berechnet und als öffentliche Antwort auf Türchen ${nr} veröffentlicht. Der Gewinner wird dabei erwähnt und benachrichtigt.`,
          'Ja, ziehen')
        if (!ok) return
        const b = $('#vl-ziehen')
        b.disabled = true
        b.innerHTML = '<span class="lade"></span> signiere …'
        try {
          await ziehe(t, f)
          toast('🎉 Gewinner gezogen und veröffentlicht!', 5000)
        } catch (err) {
          toast(err.message || 'Ziehung fehlgeschlagen.', 6000)
        }
        renderVerlosung()
      }
      return
    }

    // 1. Teilnahme läuft oder ist beendet → Teilnehmer prüfen (Spam-Filter) und festschreiben
    const teilnehmer = await sammleTeilnehmer(t)
    const keys = [...teilnehmer.keys()]
    const profile = await ladeProfile(keys)
    const netzwerk = zustand.filter.netzwerk ? await ladeNetzwerk(t.event.pubkey) : null
    if (!aktuell()) return
    if (!zustand.manuell.has(nr)) zustand.manuell.set(nr, new Map())
    const manuell = zustand.manuell.get(nr)
    const jetzt = Math.floor(Date.now() / 1000)
    const laeuft = t.verlosung.ende && jetzt <= t.verlosung.ende

    const eintraege = keys.map((pk, i) => {
      const p = profile[i]
      let grund = ''
      if (zustand.filter.profil && !hatProfil(p)) grund = 'kein Profil'
      else if (netzwerk && !netzwerk.has(pk)) grund = 'außerhalb des Netzwerks'
      return { pk, p, arten: [...teilnehmer.get(pk)], grund }
    }).sort((a, b) => anzeigeName(a.p, a.pk).localeCompare(anzeigeName(b.p, b.pk)))
    const istDrin = (e) => (manuell.has(e.pk) ? manuell.get(e.pk) : !e.grund)
    const anzahl = () => eintraege.filter(istDrin).length

    const zeilen = eintraege.map((e) => `
        <li class="${istDrin(e) ? '' : 'aus'}">
          <label class="check"><input type="checkbox" data-pk="${e.pk}" ${istDrin(e) ? 'checked' : ''} ${laeuft ? 'disabled' : ''}>
            <span class="tname" title="${nip19.npubEncode(e.pk)}">${esc(anzeigeName(e.p, e.pk))}</span></label>
          ${e.grund ? `<span class="grund">${esc(e.grund)}</span>` : ''}
          <span class="arten">${e.arten.map((a) => ARTEN[a]).join(' ')}</span>
        </li>`).join('')
    const aussortiert = eintraege.filter((e) => e.grund).length
    if (!zustand.ungespeichert) {
      if (laeuft) tipp(`Die Verlosung läuft bis ${formatDatum(t.verlosung.ende)}. Danach hier <em>Teilnahme schließen</em>.`, 'warte')
      else if (keys.length) tipp('Die Teilnahme ist beendet. Liste unten prüfen, Spam abwählen und <em>Teilnahme schließen</em> klicken.')
      else tipp('Noch keine Teilnehmer gefunden. Später unten <em>Aktualisieren</em> klicken.', 'warte')
    }

    box.innerHTML = `
      <p>${laeuft
        ? `⏳ Die Teilnahme läuft noch bis <strong>${formatDatum(t.verlosung.ende)}</strong>. Bisher <strong>${keys.length}</strong> Teilnehmer.`
        : `Die Teilnahme ist beendet. <strong>${keys.length}</strong> Teilnehmer gefunden. Prüfe die Liste und schreibe sie dann fest.`}</p>
      <div class="filter">
        <span class="feldname">Spam-Filter</span>
        <label class="check"><input type="checkbox" id="flt-profil" ${zustand.filter.profil ? 'checked' : ''}> Nur Npubs mit Profil (Name oder Bild)</label>
        <label class="check"><input type="checkbox" id="flt-netzwerk" ${zustand.filter.netzwerk ? 'checked' : ''}> Nur aus deinem Netzwerk (du folgst ihnen oder jemand, dem du folgst)</label>
        ${aussortiert ? `<span class="leise">${aussortiert} automatisch aussortiert. Per Haken kannst du einzelne trotzdem aufnehmen.</span>` : ''}
      </div>
      ${keys.length ? `<ul class="teilnehmer">${zeilen}</ul>` : '<p class="leise">Noch keine Teilnehmer.</p>'}
      <div class="zeile">
        ${laeuft ? '' : `<button type="button" class="knopf" id="vl-fest" ${anzahl() ? '' : 'disabled'}>🔒 Teilnahme schließen (${anzahl()})</button>`}
        <button type="button" class="knopf zweit" id="vl-neu">Aktualisieren</button>
      </div>
      <p class="leise" style="font-size:.8rem;margin-bottom:0">🧡 Reaktion · 💬 Antwort · ⚡ Zap. Der Host selbst ist ausgeschlossen.</p>`

    $('#vl-neu').onclick = renderVerlosung
    $('#flt-profil').onchange = (ev) => { zustand.filter.profil = ev.target.checked; renderVerlosung() }
    $('#flt-netzwerk').onchange = (ev) => {
      zustand.filter.netzwerk = ev.target.checked
      if (ev.target.checked) toast('Lade Kontaktlisten deines Netzwerks …')
      renderVerlosung()
    }
    box.querySelectorAll('input[data-pk]').forEach((c) => {
      c.onchange = () => {
        manuell.set(c.dataset.pk, c.checked)
        c.closest('li').classList.toggle('aus', !c.checked)
        const f = $('#vl-fest')
        if (f) {
          f.textContent = `🔒 Teilnahme schließen (${anzahl()})`
          f.disabled = !anzahl()
        }
      }
    })
    const fest = $('#vl-fest')
    if (fest) fest.onclick = async () => {
      const auswahl = eintraege.filter(istDrin).map((e) => e.pk)
      const filter = [
        ...(zustand.filter.profil ? ['nur mit Profil'] : []),
        ...(zustand.filter.netzwerk ? ['nur aus dem Netzwerk des Hosts'] : []),
        ...([...manuell.values()].some((v) => v === false) ? ['manuell geprüft'] : []),
      ]
      const weg = keys.length - auswahl.length
      const ok = await bestaetige('Teilnahme schließen?',
        `Die Liste mit <strong>${auswahl.length} Teilnehmern</strong> wird öffentlich als Antwort auf Türchen ${nr} festgeschrieben${weg ? ` (${weg} aussortiert)` : ''}. Danach lässt sie sich nicht mehr ändern. Gezogen wird mit dem übernächsten Bitcoin-Block.`,
        'Ja, festschreiben')
      if (!ok) return
      fest.disabled = true
      fest.innerHTML = '<span class="lade"></span> signiere …'
      try {
        await schreibeTeilnehmerFest(t, auswahl, { gesamt: keys.length, filter })
        toast('🔒 Teilnehmerliste festgeschrieben.', 5000)
      } catch (err) {
        toast(err.message || 'Festschreiben fehlgeschlagen.', 6000)
      }
      renderVerlosung()
    }
  } catch (err) {
    if (aktuell()) box.innerHTML = `<p class="fehler">${esc(err.message || 'Fehler beim Laden der Verlosung.')}</p>`
  }
}

// ---------- Login / Start ----------
async function renderNutzer() {
  const el = $('#nutzer')
  const s = aktuelleSession()
  if (!s) {
    el.innerHTML = ''
    return
  }
  const p = await ladeProfil(s.pubkey)
  el.innerHTML = `
    ${p.picture ? `<img class="avatar" src="${esc(p.picture)}" alt="">` : ''}
    <span>${esc(anzeigeName(p, s.pubkey))}</span>
    <button class="knopf zweit klein" id="logout-knopf">Abmelden</button>`
  $('#logout-knopf').onclick = async () => {
    await logout()
    location.reload()
  }
}

async function starteArbeitsbereich() {
  const s = aktuelleSession()
  await renderNutzer()
  if (!s) return
  const host = hostHex()
  if (!host) {
    $('#admin-status').innerHTML = '<span class="fehler">In config.js ist noch kein gültiger Host-npub eingetragen.</span>'
    return
  }
  if (s.pubkey !== host) {
    $('#admin-status').innerHTML = '<span class="fehler">Du bist nicht als Host angemeldet. Nur der in config.js eingetragene npub kann Türchen befüllen.</span>'
    $('#gesperrt').hidden = false
    return
  }
  $('#gesperrt').hidden = true
  $('#arbeitsbereich').hidden = false
  $('#admin-status').innerHTML = '<span class="lade"></span> lade Entwürfe und veröffentlichte Türchen …'
  try {
    const [entwuerfe, live] = await Promise.all([ladeEntwuerfe(), ladeTuerchen()])
    zustand.entwuerfe = entwuerfe
    zustand.live = live
  } catch (err) {
    toast(err.message || 'Laden fehlgeschlagen.', 6000)
  }
  // Heutiges Türchen vorauswählen
  waehleTuer(Math.min(24, Math.max(1, offeneTuerchenBis() || 1)))
}

function init() {
  $('#f-typ').innerHTML = Object.entries(TYP).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')
  const vd = vorschauDatum()
  if (vd) {
    const h = $('#vorschau-hinweis')
    h.hidden = false
    h.textContent = `Vorschau-Modus: Datum ${vd.tag}.${vd.monat}.${vd.jahr}. Veröffentlichte Türchen sind trotzdem sofort öffentlich!`
  }
  oeffneLogin = initLogin({
    onLogin: starteArbeitsbereich,
    hinweis: 'Melde dich mit dem Host-Schlüssel an. Für die verschlüsselten Entwürfe muss deine Erweiterung oder Signer-App NIP-44 unterstützen.',
  })
  $('#admin-login').onclick = () => oeffneLogin()
  if (CONFIG.anleitungUrl) {
    $('#anleitung').hidden = false
    $('#anleitung-link').href = CONFIG.anleitungUrl
  }
  $('#tuerliste').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-nr]')
    if (b) waehleTuer(+b.dataset.nr)
  })
  $('#editor').addEventListener('input', geaendert)
  $('#editor').addEventListener('submit', (ev) => ev.preventDefault())
  $('#btn-speichern').onclick = () => speichern()
  $('#btn-veroeffentlichen').onclick = veroeffentlichen
  addEventListener('beforeunload', (ev) => { if (zustand.ungespeichert) ev.preventDefault() })
  starteArbeitsbereich()
}

init()
