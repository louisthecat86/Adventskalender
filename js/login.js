// Login-Dialog (NIP-07 Erweiterung, NIP-46 Signer-App per QR, Bunker-Adresse) – genutzt von Kalender und Host-Bereich
import { qrcode } from '../vendor/nostr.bundle.js'
import { loginNip07, loginBunker, starteNostrConnect } from './nostr.js'
import { $, $$, toast } from './ui.js'

const MARKUP = `
<dialog id="login-dialog" class="dialog">
  <form method="dialog" class="dialog-schliessen"><button aria-label="Schließen">✕</button></form>
  <h2>Mit Nostr anmelden</h2>
  <p class="leise" id="login-hinweis">Die Türchen sind nur für Nostr-Nutzer. Dein privater Schlüssel verlässt nie deine Erweiterung oder Signer-App.</p>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="erweiterung" aria-selected="true">Browser-Erweiterung</button>
    <button type="button" role="tab" data-tab="qr" aria-selected="false">Signer-App</button>
    <button type="button" role="tab" data-tab="bunker" aria-selected="false">Bunker-Adresse</button>
  </div>
  <div class="tab-inhalt" data-panel="erweiterung">
    <p>Für Alby, nos2x, Nostr Connect und andere NIP-07-Erweiterungen.</p>
    <button type="button" class="knopf" id="login-nip07">Mit Erweiterung anmelden</button>
  </div>
  <div class="tab-inhalt" data-panel="qr" hidden>
    <p>Scanne den Code mit Amber, nsec.app oder einer anderen NIP-46-Signer-App. Auf dem Handy: Knopf antippen, in der Signer-App bestätigen und danach zurück in den Browser wechseln.</p>
    <div id="qr" class="qr"></div>
    <p id="qr-status" class="leise" style="text-align:center;font-size:.85rem"></p>
    <div class="zeile">
      <a class="knopf" id="qr-link" href="#">In Signer-App öffnen</a>
      <button type="button" class="knopf zweit" id="qr-kopieren">Link kopieren</button>
    </div>
  </div>
  <div class="tab-inhalt" data-panel="bunker" hidden>
    <p>Füge deine <code>bunker://</code>-Adresse oder die NIP-05 deines Bunkers ein.</p>
    <input id="bunker-eingabe" type="text" placeholder="bunker://… oder name@nsec.app" autocomplete="off" spellcheck="false">
    <button type="button" class="knopf" id="login-bunker">Verbinden</button>
  </div>
  <p id="login-fehler" class="fehler" hidden></p>
</dialog>`

/**
 * Baut den Login-Dialog ein.
 * @param {{ onLogin: (pubkey: string) => any, hinweis?: string }} opt
 * @returns {() => void} Funktion zum Öffnen des Dialogs
 */
export function initLogin({ onLogin, hinweis }) {
  document.body.insertAdjacentHTML('beforeend', MARKUP)
  if (hinweis) $('#login-hinweis').textContent = hinweis
  const dialog = $('#login-dialog')
  let nostrConnect = null

  const fehler = (text) => {
    const f = $('#login-fehler')
    f.textContent = text || ''
    f.hidden = !text
  }

  const fertig = async (pubkey) => {
    dialog.close()
    fehler('')
    await onLogin(pubkey)
  }

  const startQr = () => {
    nostrConnect?.abbrechen()
    nostrConnect = starteNostrConnect((text) => { $('#qr-status').textContent = text })
    const qr = qrcode(0, 'L')
    qr.addData(nostrConnect.uri)
    qr.make()
    $('#qr').innerHTML = qr.createImgTag(6, 0)
    $('#qr-link').href = nostrConnect.uri
    nostrConnect.fertig.then(fertig).catch((e) => {
      if (e?.name !== 'AbortError' && !/abort/i.test(e?.message || '')) fehler(e.message)
    })
  }

  const waehleTab = (name) => {
    $$('#login-dialog [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name))
    $$('#login-dialog .tab-inhalt').forEach((p) => { p.hidden = p.dataset.panel !== name })
    fehler('')
    if (name === 'qr') startQr()
    else nostrConnect?.abbrechen()
  }

  $$('#login-dialog [role=tab]').forEach((b) => { b.onclick = () => waehleTab(b.dataset.tab) })
  dialog.addEventListener('close', () => nostrConnect?.abbrechen())
  $('#qr-kopieren').onclick = async () => {
    try { await navigator.clipboard.writeText(nostrConnect.uri); toast('Link kopiert.') } catch { toast('Kopieren nicht möglich.') }
  }
  $('#login-nip07').onclick = async (ev) => {
    const b = ev.currentTarget
    b.disabled = true
    try { await fertig(await loginNip07()) } catch (e) { fehler(e.message || 'Login abgelehnt.') } finally { b.disabled = false }
  }
  $('#login-bunker').onclick = async (ev) => {
    const b = ev.currentTarget
    b.disabled = true
    b.innerHTML = '<span class="lade"></span> verbinde …'
    try {
      await fertig(await loginBunker($('#bunker-eingabe').value, (url) => window.open(url, '_blank', 'width=600,height=650')))
    } catch (e) {
      fehler(e.message || 'Verbindung fehlgeschlagen.')
    } finally {
      b.disabled = false
      b.textContent = 'Verbinden'
    }
  }

  return () => {
    // Ohne Erweiterung direkt die Signer-App anbieten (typisch auf dem Handy)
    waehleTab(window.nostr ? 'erweiterung' : 'qr')
    dialog.showModal()
  }
}
