// Gemeinsame Darstellung von Gewinner und Prüfung (Kalender + Host-Bereich)
import { CONFIG } from '../config.js'
import { ladeProfil, anzeigeName, neventLink, nip19 } from './nostr.js'
import { pruefeZiehung } from './verlosung.js'
import { esc } from './inhalt.js'

export async function gewinnerHtml(ergebnis, runde) {
  const p = await ladeProfil(ergebnis.gewinner)
  const npub = nip19.npubEncode(ergebnis.gewinner)
  const neu = runde && runde.nr > 1
  return `
    <div class="gewinner-box">
      ${p.picture ? `<img class="avatar" src="${esc(p.picture)}" alt="">` : '<span style="font-size:2rem">🎉</span>'}
      <div>
        <div class="leise" style="font-size:.8rem">${neu ? `Gewinner · neu gezogen (Runde ${runde.nr})` : 'Gewinner'}</div>
        <a href="${CONFIG.nostrViewer}${npub}" target="_blank" rel="noopener">${esc(anzeigeName(p, ergebnis.gewinner))}</a>
      </div>
    </div>
    <div class="leise" style="margin-top:.5rem;font-size:.85rem">
      Gezogen mit Bitcoin-Block #${ergebnis.hoehe} ·
      <a href="${neventLink(ergebnis.event)}" target="_blank" rel="noopener">Ergebnis auf Nostr ↗</a>
    </div>
    <div class="zeile"><button type="button" class="knopf zweit klein" data-aktion="pruefen">🔍 Ziehung nachprüfen</button></div>
    <ul class="pruef-liste" data-ziel="pruefung"></ul>`
}

/** Hängt die Prüf-Funktion an den Knopf innerhalb von container */
export function verbindePruefung(container, freeze, runde) {
  const knopf = container.querySelector('[data-aktion=pruefen]')
  const liste = container.querySelector('[data-ziel=pruefung]')
  if (!knopf) return
  if (!freeze) {
    knopf.disabled = true
    knopf.title = 'Festschreibung der Teilnehmerliste nicht gefunden'
    return
  }
  knopf.onclick = async () => {
    knopf.disabled = true
    liste.innerHTML = '<li><span class="lade"></span> prüfe …</li>'
    try {
      const r = await pruefeZiehung(freeze, runde)
      liste.innerHTML = r.schritte.map((s) => `<li>${s.ok ? '✅' : '❌'} ${esc(s.text)}</li>`).join('')
        + `<li><strong>${r.ok ? '✅ Die Ziehung ist korrekt.' : '❌ Die Ziehung lässt sich nicht bestätigen.'}</strong></li>`
    } catch (e) {
      liste.innerHTML = `<li class="fehler">${esc(e.message)}</li>`
    } finally {
      knopf.disabled = false
    }
  }
}
