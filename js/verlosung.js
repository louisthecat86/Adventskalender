// Verlosung: Teilnehmer sammeln, Liste festschreiben, Gewinner nachprüfbar per Bitcoin-Blockhash ziehen
//
// Regel (für jeden nachrechenbar):
//   1. Host schreibt die Teilnehmerliste fest (Antwort auf das Türchen, Tag "raffle-freeze").
//      Darin steht die Blockhöhe H = aktuelle Höhe + 2 – dieser Block existiert noch nicht.
//   2. Teilnehmer-Pubkeys (hex) werden aufsteigend sortiert.
//   3. Gewinner-Index = Blockhash(H) als Zahl  mod  Anzahl Teilnehmer.
import { CONFIG } from '../config.js'
import { pool, signiereUndSende, verifyEventSicher } from './nostr.js'
import { nip19 } from '../vendor/nostr.bundle.js'

const API = () => CONFIG.mempoolApi.replace(/\/$/, '')

// ---------- Bitcoin-Blöcke (mempool.space) ----------
export async function aktuelleBlockhoehe() {
  const r = await fetch(`${API()}/blocks/tip/height`)
  if (!r.ok) throw new Error('Blockhöhe konnte nicht von mempool.space geladen werden.')
  return parseInt(await r.text(), 10)
}

/** Hash des Blocks auf Höhe h, oder null, wenn er noch nicht gefunden wurde */
export async function blockHash(h) {
  const r = await fetch(`${API()}/block-height/${h}`)
  if (r.status === 404 || r.status === 400) return null
  if (!r.ok) throw new Error('Block konnte nicht von mempool.space geladen werden.')
  const t = (await r.text()).trim()
  return /^[0-9a-f]{64}$/.test(t) ? t : null
}

// ---------- Rechnen ----------
export async function listenHash(pubkeys) {
  const daten = new TextEncoder().encode([...pubkeys].sort().join('\n'))
  const h = await crypto.subtle.digest('SHA-256', daten)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function berechneGewinner(pubkeys, hash) {
  const sortiert = [...pubkeys].sort()
  const index = Number(BigInt('0x' + hash) % BigInt(sortiert.length))
  return { index, gewinner: sortiert[index], anzahl: sortiert.length }
}

// ---------- Teilnehmer sammeln ----------
/**
 * Sammelt alle Teilnehmer eines Türchens.
 * @returns Map pubkey → Set der Teilnahme-Arten ('reaction' | 'reply' | 'zap')
 */
export async function sammleTeilnehmer(tuer) {
  const { verlosung: v, id, event } = tuer
  const host = event.pubkey
  const evs = await pool.querySync(CONFIG.relays, { kinds: [1, 7, 9735], '#e': [id] }, { maxWait: 8000 })
  const teilnehmer = new Map()
  const dazu = (pk, art) => {
    if (!pk || pk === host) return
    if (!teilnehmer.has(pk)) teilnehmer.set(pk, new Set())
    teilnehmer.get(pk).add(art)
  }
  for (const ev of evs) {
    if (v.ende && ev.created_at > v.ende) continue
    if (!verifyEventSicher(ev)) continue
    if (ev.kind === 7 && v.modi.includes('reaction')) {
      if (ev.content === '-') continue // „Daumen runter“ zählt nicht
      dazu(ev.pubkey, 'reaction')
    } else if (ev.kind === 1 && v.modi.includes('reply')) {
      dazu(ev.pubkey, 'reply')
    } else if (ev.kind === 9735 && v.modi.includes('zap')) {
      // Zapper steht in der signierten Zap-Anfrage (NIP-57, Tag "description")
      try {
        const anfrage = JSON.parse(ev.tags.find((t) => t[0] === 'description')?.[1] || '')
        if (anfrage.kind === 9734 && verifyEventSicher(anfrage) && anfrage.tags.some((t) => t[0] === 'e' && t[1] === id)) {
          dazu(anfrage.pubkey, 'zap')
        }
      } catch { /* ungültige Quittung */ }
    }
  }
  return teilnehmer
}

// ---------- Spam-Filter ----------
/** Hat das Profil irgendeinen Inhalt (Name, Anzeigename, Bild, Beschreibung)? */
export function hatProfil(p) {
  return !!(p && (p.name || p.display_name || p.picture || p.about || p.nip05))
}

let netzwerkCache = null
/**
 * Netzwerk des Hosts: Npubs, denen der Host folgt, plus Npubs, denen diese folgen (2 Ebenen).
 * Nutzt die Kontaktlisten (kind 3).
 */
export async function ladeNetzwerk(host) {
  if (netzwerkCache?.host === host) return netzwerkCache.menge
  const neueste = (evs) => {
    const m = new Map()
    for (const e of evs) if (verifyEventSicher(e) && (!m.has(e.pubkey) || m.get(e.pubkey).created_at < e.created_at)) m.set(e.pubkey, e)
    return [...m.values()]
  }
  const folgt = (ev) => ev.tags.filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1])).map((t) => t[1])
  const eigene = neueste(await pool.querySync(CONFIG.relays, { kinds: [3], authors: [host] }, { maxWait: 6000 }))
  const ebene1 = eigene.length ? folgt(eigene[0]) : []
  const menge = new Set(ebene1)
  for (let i = 0; i < ebene1.length; i += 150) {
    const evs = neueste(await pool.querySync(CONFIG.relays, { kinds: [3], authors: ebene1.slice(i, i + 150) }, { maxWait: 8000 }))
    for (const ev of evs) for (const pk of folgt(ev)) menge.add(pk)
  }
  netzwerkCache = { host, menge }
  return menge
}

// ---------- Status (Festschreibung / Runden / Ergebnisse) lesen ----------
//
// Runde 1: Block aus der Festschreibung ("raffle-freeze").
// Runde 2, 3, …: Neuziehung ("raffle-redraw", Runde, Blockhöhe) – nötig, wenn sich ein Gewinner nicht meldet.
// Lostopf einer Runde = festgeschriebene Liste ohne die Gewinner aller früheren Runden.
const tagW = (ev, name) => ev.tags.find((t) => t[0] === name)

export async function ladeVerlosungsStatus(tuer) {
  const evs = await pool.querySync(
    CONFIG.relays,
    { kinds: [1], authors: [tuer.event.pubkey], '#e': [tuer.id] },
    { maxWait: 6000 },
  )
  const gueltig = evs.filter(verifyEventSicher).sort((a, b) => a.created_at - b.created_at)
  const freezeEv = gueltig.find((e) => tagW(e, 'raffle-freeze'))
  if (!freezeEv) return { freeze: null, runden: [], ergebnis: null, aktuelle: null }
  const freeze = {
    event: freezeEv,
    hoehe: parseInt(tagW(freezeEv, 'raffle-freeze')[1], 10),
    listenHash: tagW(freezeEv, 'participants-hash')?.[1],
    teilnehmer: freezeEv.tags.filter((t) => t[0] === 'participant').map((t) => t[1]),
  }

  // Runden aufbauen
  const runden = new Map([[1, { nr: 1, hoehe: freeze.hoehe, ankuendigung: freezeEv, ergebnis: null }]])
  for (const ev of gueltig) {
    const r = tagW(ev, 'raffle-redraw')
    if (!r) continue
    const nr = parseInt(r[1], 10)
    if (nr >= 2 && !runden.has(nr)) runden.set(nr, { nr, hoehe: parseInt(r[2], 10), ankuendigung: ev, ergebnis: null })
  }
  for (const ev of gueltig) {
    const w = tagW(ev, 'raffle-winner')
    if (!w) continue
    const nr = parseInt(w[5] || '1', 10)
    const runde = runden.get(nr)
    if (runde && !runde.ergebnis) {
      runde.ergebnis = { event: ev, gewinner: w[1], hoehe: parseInt(w[2], 10), hash: w[3], index: parseInt(w[4], 10), runde: nr }
    }
  }
  const liste = [...runden.values()].sort((a, b) => a.nr - b.nr)
  // Nur lückenlose Runden zählen (Runde n braucht ein Ergebnis in Runde n-1)
  const gueltigeRunden = []
  for (const r of liste) {
    if (r.nr > 1 && !gueltigeRunden[gueltigeRunden.length - 1]?.ergebnis) break
    gueltigeRunden.push(r)
  }
  const aktuelle = gueltigeRunden[gueltigeRunden.length - 1]
  // Lostopf je Runde
  const bisherige = []
  for (const r of gueltigeRunden) {
    r.ausgeschlossen = [...bisherige]
    r.lostopf = freeze.teilnehmer.filter((pk) => !bisherige.includes(pk))
    if (r.ergebnis) bisherige.push(r.ergebnis.gewinner)
  }
  return { freeze, runden: gueltigeRunden, aktuelle, ergebnis: aktuelle?.ergebnis || null }
}

// ---------- Schreiben (nur Host) ----------
/**
 * @param {string[]} pubkeys  festgeschriebene Teilnehmer
 * @param {{ gesamt: number, filter: string[] }} info  Anzahl gefundener Teilnehmer und aktive Spam-Filter (für Transparenz)
 */
export async function schreibeTeilnehmerFest(tuer, pubkeys, info = { gesamt: pubkeys.length, filter: [] }) {
  if (!pubkeys.length) throw new Error('Keine Teilnehmer ausgewählt.')
  const hoehe = (await aktuelleBlockhoehe()) + 2
  const hash = await listenHash(pubkeys)
  const n = pubkeys.length
  const aussortiert = info.gesamt - n
  const content = [
    `🔒 Türchen ${tuer.nr}: Die Teilnahme ist geschlossen.`,
    '',
    `${n} Teilnehmer sind im Lostopf. Gezogen wird mit dem Hash von Bitcoin-Block #${hoehe}, der jetzt noch nicht existiert.`,
    ...(aussortiert > 0
      ? [`Spam-Schutz: ${aussortiert} von ${info.gesamt} Npubs aussortiert${info.filter.length ? ` (${info.filter.join(', ')})` : ''}.`]
      : []),
    `Regel: Teilnehmer-Pubkeys sortieren, Gewinner = Blockhash mod ${n}.`,
    `Prüfsumme der Liste (SHA-256): ${hash}`,
    '',
    `#${CONFIG.hashtag}`,
  ].join('\n')
  return signiereUndSende({
    kind: 1,
    content,
    tags: [
      ['e', tuer.id, CONFIG.relays[0], 'root'],
      ['t', CONFIG.hashtag],
      ['raffle-freeze', String(hoehe)],
      ['participants-hash', hash],
      ...[...pubkeys].sort().map((pk) => ['participant', pk]),
    ],
  })
}

/** Neuziehung ankündigen: bisherige Gewinner raus, neuer (noch nicht existierender) Block wird festgelegt */
export async function kuendigeNeuziehungAn(tuer, status) {
  const letzte = status.aktuelle
  if (!letzte?.ergebnis) throw new Error('Erst muss die laufende Runde gezogen sein.')
  const ausgeschlossen = [...letzte.ausgeschlossen, letzte.ergebnis.gewinner]
  const rest = status.freeze.teilnehmer.length - ausgeschlossen.length
  if (rest < 1) throw new Error('Es ist niemand mehr im Lostopf.')
  const runde = letzte.nr + 1
  const hoehe = (await aktuelleBlockhoehe()) + 2
  const vorher = nip19.npubEncode(letzte.ergebnis.gewinner)
  const content = [
    `🔁 Türchen ${tuer.nr}: Neuziehung (Runde ${runde}).`,
    '',
    `Der bisherige Gewinner nostr:${vorher} hat sich nicht gemeldet und ist ausgeschlossen.`,
    `${rest} Teilnehmer bleiben im Lostopf. Gezogen wird mit dem Hash von Bitcoin-Block #${hoehe}, der jetzt noch nicht existiert.`,
    `Regel: festgeschriebene Liste ohne bisherige Gewinner, Pubkeys sortieren, Gewinner = Blockhash mod ${rest}.`,
    '',
    `#${CONFIG.hashtag}`,
  ].join('\n')
  return signiereUndSende({
    kind: 1,
    content,
    tags: [
      ['e', tuer.id, CONFIG.relays[0], 'root'],
      ['e', status.freeze.event.id, CONFIG.relays[0], 'mention'],
      ['t', CONFIG.hashtag],
      ['raffle-redraw', String(runde), String(hoehe)],
      ...ausgeschlossen.map((pk) => ['excluded', pk]),
    ],
  })
}

/** Zieht den Gewinner der aktuellen Runde */
export async function ziehe(tuer, status) {
  const runde = status.aktuelle
  if (!runde || runde.ergebnis) throw new Error('In dieser Runde wurde schon gezogen.')
  const hash = await blockHash(runde.hoehe)
  if (!hash) throw new Error(`Block #${runde.hoehe} wurde noch nicht gefunden. Bitte ein paar Minuten warten.`)
  const { index, gewinner, anzahl } = berechneGewinner(runde.lostopf, hash)
  const npub = nip19.npubEncode(gewinner)
  const preis = tuer.verlosung?.preis ? ` (${tuer.verlosung.preis})` : ''
  const content = [
    runde.nr > 1
      ? `🎉 Neuer Gewinner von Türchen ${tuer.nr}${preis} (Runde ${runde.nr}): nostr:${npub}`
      : `🎉 Gewinner von Türchen ${tuer.nr}${preis}: nostr:${npub}`,
    '',
    `Glückwunsch! Bitte melde dich per DM beim Host.`,
    '',
    `Nachprüfbar: Block #${runde.hoehe}, Hash ${hash}`,
    `${anzahl} Teilnehmer im Lostopf, Index = Hash mod ${anzahl} = ${index}`,
    `Prüfen im Kalender: ${CONFIG.seitenUrl}`,
    '',
    `#${CONFIG.hashtag}`,
  ].join('\n')
  return signiereUndSende({
    kind: 1,
    content,
    tags: [
      ['e', tuer.id, CONFIG.relays[0], 'root'],
      ['e', runde.ankuendigung.id, CONFIG.relays[0], 'mention'],
      ['p', gewinner],
      ['t', CONFIG.hashtag],
      ['raffle-winner', gewinner, String(runde.hoehe), hash, String(index), String(runde.nr)],
    ],
  })
}

/** Unabhängige Prüfung einer Runde (für alle Besucher) */
export async function pruefeZiehung(freeze, runde) {
  const e = runde.ergebnis
  const schritte = []
  const hashListe = await listenHash(freeze.teilnehmer)
  schritte.push({ ok: hashListe === freeze.listenHash, text: `Prüfsumme der Teilnehmerliste (${freeze.teilnehmer.length} Npubs) stimmt` })
  if (runde.nr > 1) {
    schritte.push({ ok: true, text: `Runde ${runde.nr}: ${runde.ausgeschlossen.length} frühere${runde.ausgeschlossen.length === 1 ? 'r' : ''} Gewinner ausgeschlossen, ${runde.lostopf.length} im Lostopf` })
  }
  schritte.push({
    ok: runde.ankuendigung.created_at < e.event.created_at && e.hoehe === runde.hoehe,
    text: `Block #${runde.hoehe} wurde vor der Ziehung festgelegt`,
  })
  const hash = await blockHash(runde.hoehe)
  schritte.push({ ok: hash === e.hash, text: `Blockhash laut mempool.space: ${hash ? hash.slice(0, 16) + '…' : 'nicht gefunden'}` })
  if (hash) {
    const r = berechneGewinner(runde.lostopf, hash)
    schritte.push({ ok: r.gewinner === e.gewinner && r.index === e.index, text: `Hash mod ${r.anzahl} = ${r.index} → Gewinner stimmt überein` })
  }
  return { ok: schritte.every((s) => s.ok), schritte }
}
