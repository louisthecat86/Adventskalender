// Nostr-Anbindung: Relays, Login (NIP-07 / NIP-46), Türchen lesen/schreiben, Entwürfe
import { CONFIG } from '../config.js'
import {
  SimplePool, verifyEvent, generateSecretKey, getPublicKey, nip19,
  BunkerSigner, parseBunkerInput, createNostrConnectURI, bytesToHex, hexToBytes,
} from '../vendor/nostr.bundle.js'
import { tagStartUnix, formatDatum } from './zeit.js'

export const pool = new SimplePool()
export { nip19 }

const SESSION_KEY = 'e21-advent-session'
const TRENNER = '\n\n———\n'

// ---------- Host ----------
export function hostHex() {
  try {
    const d = nip19.decode(CONFIG.hostNpub)
    return d.type === 'npub' ? d.data : null
  } catch {
    return null
  }
}

// ---------- Session / Signer ----------
let signer = null
let session = null // { methode, pubkey, bunker?, clientSk? }

export function aktuelleSession() {
  if (session) return session
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    session = null
  }
  return session
}

function speichereSession(s) {
  session = s
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* privater Modus o. ä. */ }
}

function nip07Signer() {
  if (!window.nostr) throw new Error('Keine Nostr-Browsererweiterung gefunden (z. B. Alby oder nos2x).')
  const nip44 = () => {
    if (!window.nostr.nip44) throw new Error('Deine Erweiterung unterstützt keine NIP-44-Verschlüsselung. Bitte aktualisieren oder per Signer-App anmelden.')
    return window.nostr.nip44
  }
  return {
    getPublicKey: () => window.nostr.getPublicKey(),
    signEvent: (e) => window.nostr.signEvent(e),
    nip44Encrypt: (pk, txt) => nip44().encrypt(pk, txt),
    nip44Decrypt: (pk, txt) => nip44().decrypt(pk, txt),
  }
}

/** Liefert einen nutzbaren Signer zur aktuellen Session (stellt NIP-46 bei Bedarf wieder her) */
export async function holeSigner() {
  if (signer) return signer
  const s = aktuelleSession()
  if (!s) throw new Error('Nicht angemeldet.')
  if (s.methode === 'nip07') {
    signer = nip07Signer()
  } else if (s.methode === 'nip46') {
    signer = BunkerSigner.fromBunker(hexToBytes(s.clientSk), s.bunker, {
      pool,
      onauth: (url) => window.open(url, '_blank', 'width=600,height=650'),
    })
  }
  return signer
}

/** Login-Nachweis: der Nutzer signiert ein kurzes Event, das lokal geprüft wird */
async function beweiseBesitz(sig, pubkey) {
  const ev = await sig.signEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', bytesToHex(generateSecretKey()).slice(0, 32)], ['client', CONFIG.titel]],
    content: `Login beim ${CONFIG.titel}`,
  })
  if (!verifyEvent(ev) || ev.pubkey !== pubkey) throw new Error('Login-Signatur ungültig.')
}

export async function loginNip07() {
  const sig = nip07Signer()
  const pubkey = await sig.getPublicKey()
  await beweiseBesitz(sig, pubkey)
  signer = sig
  speichereSession({ methode: 'nip07', pubkey })
  return pubkey
}

/** Login mit bunker://-Adresse oder NIP-05 eines Bunkers */
export async function loginBunker(eingabe, onauth) {
  const bp = await parseBunkerInput(eingabe.trim())
  if (!bp) throw new Error('Ungültige Bunker-Adresse.')
  const sk = generateSecretKey()
  const b = BunkerSigner.fromBunker(sk, bp, { pool, onauth })
  await b.connect()
  const pubkey = await b.getPublicKey()
  signer = b
  speichereSession({ methode: 'nip46', pubkey, bunker: b.bp, clientSk: bytesToHex(sk) })
  return pubkey
}

/** Erstellt eine nostrconnect://-URI (QR-Code / Signer-App) und wartet auf die Verbindung */
export function starteNostrConnect() {
  const sk = generateSecretKey()
  const secret = bytesToHex(generateSecretKey()).slice(0, 16)
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(sk),
    relays: CONFIG.signerRelays,
    secret,
    perms: ['sign_event:1', 'sign_event:7', 'sign_event:5', 'sign_event:22242', 'sign_event:30078', 'nip44_encrypt', 'nip44_decrypt'],
    name: CONFIG.titel,
    url: location.origin,
  })
  const abbruch = new AbortController()
  const fertig = (async () => {
    const b = await BunkerSigner.fromURI(sk, uri, { pool }, abbruch.signal)
    const pubkey = await b.getPublicKey()
    signer = b
    speichereSession({ methode: 'nip46', pubkey, bunker: b.bp, clientSk: bytesToHex(sk) })
    return pubkey
  })()
  return { uri, fertig, abbrechen: () => abbruch.abort() }
}

export async function logout() {
  try {
    if (signer && signer.close) await signer.close()
  } catch { /* egal */ }
  signer = null
  speichereSession(null)
}

// ---------- Türchen-Format ----------
const tagWert = (ev, name) => ev.tags.find((t) => t[0] === name)?.[1]

export const MODUS_TEXT = { reply: 'antworten', reaction: 'reagieren', zap: 'zappen' }

/**
 * Baut aus einem Entwurf das Nostr-Event (Vorlage, noch unsigniert).
 * Inhalt für Nostr-Apps:  Kopfzeile, Text, ——— , Bild, Verlosung, Link, Hashtag
 * Die Website zeigt nur den Text zwischen Kopfzeile und Trenner.
 */
export function baueTuerEvent(nr, e) {
  const kopf = `🎄 Türchen ${nr}: ${e.titel.trim()}`
  const fuss = []
  if (e.bild) fuss.push(e.bild.trim())
  if (e.typ === 'verlosung') {
    const wie = e.modi.map((m) => MODUS_TEXT[m]).join(', ').replace(/, ([^,]*)$/, ' oder $1')
    fuss.push(`🎁 Verlosung${e.preis ? `: ${e.preis.trim()}` : ''}. Zum Mitmachen ${wie}${e.ende ? ` bis ${formatDatum(e.ende)}` : ''}.`)
  }
  fuss.push(`👉 Zum Kalender: ${CONFIG.seitenUrl}`)
  fuss.push(`#${CONFIG.hashtag}`)

  const tags = [
    ['t', CONFIG.hashtag],
    ['calendar', CONFIG.kalenderId],
    ['door', String(nr)],
    ['title', e.titel.trim()],
    ['door-type', e.typ],
    ['r', CONFIG.seitenUrl],
  ]
  if (e.bild) tags.push(['image', e.bild.trim()])
  if (e.typ === 'verlosung') tags.push(['raffle', e.modi.join(','), String(e.ende || ''), e.preis?.trim() || ''])
  return { kind: 1, content: `${kopf}\n\n${e.text.trim()}${TRENNER}${fuss.join('\n')}`, tags }
}

/** Entfernt Kopfzeile und Fußbereich, damit die Website nur den eigentlichen Text zeigt */
function nurText(content) {
  let c = content
  const t = c.lastIndexOf(TRENNER)
  if (t >= 0) c = c.slice(0, t)
  c = c.replace(/^🎄 Türchen \d+:[^\n]*\n+/, '')
  return c.replace(new RegExp(`\\s*#${CONFIG.hashtag}\\s*$`, 'i'), '').trim()
}

/** Wandelt ein Host-Event in ein Türchen-Objekt um (oder null, wenn ungültig) */
export function parseTuerchen(ev, host) {
  if (!ev || ev.pubkey !== host || ev.kind !== 1) return null
  if (tagWert(ev, 'calendar') !== CONFIG.kalenderId) return null
  const nr = parseInt(tagWert(ev, 'door'), 10)
  if (!(nr >= 1 && nr <= 24)) return null
  if (!verifyEvent(ev)) return null
  const raffle = ev.tags.find((t) => t[0] === 'raffle')
  return {
    nr,
    id: ev.id,
    event: ev,
    titel: tagWert(ev, 'title') || `Türchen ${nr}`,
    typ: tagWert(ev, 'door-type') || 'text',
    bild: tagWert(ev, 'image') || null,
    inhalt: nurText(ev.content),
    erstellt: ev.created_at,
    verlosung: raffle
      ? { modi: (raffle[1] || 'reply,reaction,zap').split(','), ende: parseInt(raffle[2], 10) || null, preis: raffle[3] || '' }
      : null,
  }
}

// ---------- Lesen ----------
const SINCE = () => tagStartUnix(1) - 86400 * 40 // großzügig: Tests im November erlauben

/** Lädt alle veröffentlichten Türchen des Hosts. Gelöschte (NIP-09) werden ausgeblendet. */
export async function ladeTuerchen() {
  const host = hostHex()
  if (!host) throw new Error('In config.js ist kein gültiger Host-npub eingetragen.')
  const since = SINCE()
  const [events, loeschungen] = await Promise.all([
    pool.querySync(CONFIG.relays, { kinds: [1], authors: [host], '#t': [CONFIG.hashtag], since }, { maxWait: 6000 }),
    pool.querySync(CONFIG.relays, { kinds: [5], authors: [host], since }, { maxWait: 6000 }),
  ])
  const geloescht = new Set(loeschungen.filter(verifyEvent).flatMap((e) => e.tags.filter((t) => t[0] === 'e').map((t) => t[1])))
  const proTuer = new Map()
  for (const ev of events) {
    if (geloescht.has(ev.id)) continue
    const t = parseTuerchen(ev, host)
    if (!t) continue
    const alt = proTuer.get(t.nr)
    if (!alt || alt.erstellt < t.erstellt) proTuer.set(t.nr, t) // neueste Version gewinnt
  }
  return proTuer
}

const profilCache = new Map()
export async function ladeProfil(pubkey) {
  if (profilCache.has(pubkey)) return profilCache.get(pubkey)
  const p = (async () => {
    const ev = await pool.get(CONFIG.relays, { kinds: [0], authors: [pubkey] }, { maxWait: 4000 })
    try {
      return ev && verifyEvent(ev) ? JSON.parse(ev.content) : {}
    } catch {
      return {}
    }
  })()
  profilCache.set(pubkey, p)
  return p
}

/** Lädt viele Profile mit einer Abfrage in den Cache */
export async function ladeProfile(pubkeys) {
  const fehlend = pubkeys.filter((pk) => !profilCache.has(pk))
  for (let i = 0; i < fehlend.length; i += 200) {
    const teil = fehlend.slice(i, i + 200)
    const evs = await pool.querySync(CONFIG.relays, { kinds: [0], authors: teil }, { maxWait: 5000 })
    const neueste = new Map()
    for (const ev of evs) {
      if (!verifyEventSicher(ev)) continue
      if (!neueste.has(ev.pubkey) || neueste.get(ev.pubkey).created_at < ev.created_at) neueste.set(ev.pubkey, ev)
    }
    for (const pk of teil) {
      let p = {}
      try { p = neueste.has(pk) ? JSON.parse(neueste.get(pk).content) : {} } catch { /* egal */ }
      profilCache.set(pk, Promise.resolve(p))
    }
  }
  return Promise.all(pubkeys.map((pk) => profilCache.get(pk)))
}

export function verifyEventSicher(ev) {
  try {
    return verifyEvent(ev)
  } catch {
    return false
  }
}

export function anzeigeName(profil, pubkey) {
  return profil?.display_name || profil?.name || nip19.npubEncode(pubkey).slice(0, 14) + '…'
}

// ---------- Schreiben ----------
export async function signiereUndSende(vorlage) {
  const sig = await holeSigner()
  const ev = await sig.signEvent({ created_at: Math.floor(Date.now() / 1000), ...vorlage })
  if (!verifyEvent(ev)) throw new Error('Signatur ungültig.')
  const ergebnisse = await Promise.allSettled(pool.publish(CONFIG.relays, ev))
  const ok = ergebnisse.filter((r) => r.status === 'fulfilled').length
  if (ok === 0) throw new Error('Kein Relay hat das Event angenommen.')
  return { event: ev, relaysOk: ok, relaysGesamt: CONFIG.relays.length }
}

/** Eigene Teilnahme (Reaktion/Antwort) an einem Türchen prüfen */
export async function eigeneTeilnahme(eventId, pubkey) {
  const evs = await pool.querySync(CONFIG.relays, { kinds: [1, 7], authors: [pubkey], '#e': [eventId] }, { maxWait: 4000 })
  return {
    reagiert: evs.some((e) => e.kind === 7),
    geantwortet: evs.some((e) => e.kind === 1),
  }
}

export function reaktion(tuer) {
  return signiereUndSende({
    kind: 7,
    content: '🧡',
    tags: [['e', tuer.id, CONFIG.relays[0]], ['p', tuer.event.pubkey], ['k', '1']],
  })
}

export function antwort(tuer, text) {
  return signiereUndSende({
    kind: 1,
    content: text,
    tags: [['e', tuer.id, CONFIG.relays[0], 'root'], ['p', tuer.event.pubkey]],
  })
}

/** Türchen veröffentlichen. Gibt es schon eine Version, wird diese per NIP-09 gelöscht. */
export async function veroeffentlicheTuer(nr, entwurf, altesEvent) {
  const res = await signiereUndSende(baueTuerEvent(nr, entwurf))
  if (altesEvent) {
    await signiereUndSende({
      kind: 5,
      content: `Korrigierte Fassung von Türchen ${nr}`,
      tags: [['e', altesEvent.id], ['k', '1']],
    }).catch(() => { /* neue Version gewinnt ohnehin */ })
  }
  return res
}

// ---------- Entwürfe (NIP-78, NIP-44 an sich selbst verschlüsselt) ----------
const entwurfD = (nr) => `${CONFIG.kalenderId}:entwurf:${String(nr).padStart(2, '0')}`

export async function speichereEntwurf(nr, entwurf) {
  const sig = await holeSigner()
  const ich = aktuelleSession().pubkey
  const geheim = await sig.nip44Encrypt(ich, JSON.stringify(entwurf))
  return signiereUndSende({ kind: 30078, content: geheim, tags: [['d', entwurfD(nr)]] })
}

/** Lädt alle Entwürfe des angemeldeten Hosts und entschlüsselt sie */
export async function ladeEntwuerfe() {
  const ich = aktuelleSession().pubkey
  const ds = Array.from({ length: 24 }, (_, i) => entwurfD(i + 1))
  const evs = await pool.querySync(CONFIG.relays, { kinds: [30078], authors: [ich], '#d': ds }, { maxWait: 6000 })
  const neueste = new Map()
  for (const ev of evs) {
    if (!verifyEvent(ev)) continue
    const d = tagWert(ev, 'd')
    if (!neueste.has(d) || neueste.get(d).created_at < ev.created_at) neueste.set(d, ev)
  }
  const sig = await holeSigner()
  const ergebnis = new Map()
  for (const [d, ev] of neueste) {
    try {
      const daten = JSON.parse(await sig.nip44Decrypt(ich, ev.content))
      ergebnis.set(parseInt(d.split(':').pop(), 10), { ...daten, gespeichert: ev.created_at })
    } catch { /* nicht entschlüsselbar – überspringen */ }
  }
  return ergebnis
}

export function neventLink(ev) {
  return CONFIG.nostrViewer + nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: CONFIG.relays.slice(0, 2) })
}
