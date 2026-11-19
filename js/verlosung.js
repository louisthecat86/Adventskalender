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

// ---------- Status (Festschreibung / Ergebnis) lesen ----------
export async function ladeVerlosungsStatus(tuer) {
  const evs = await pool.querySync(
    CONFIG.relays,
    { kinds: [1], authors: [tuer.event.pubkey], '#e': [tuer.id] },
    { maxWait: 6000 },
  )
  const gueltig = evs.filter(verifyEventSicher).sort((a, b) => b.created_at - a.created_at)
  const freezeEv = gueltig.find((e) => e.tags.some((t) => t[0] === 'raffle-freeze'))
  const gewinnerEv = gueltig.find((e) => e.tags.some((t) => t[0] === 'raffle-winner'))
  const freeze = freezeEv
    ? {
        event: freezeEv,
        hoehe: parseInt(freezeEv.tags.find((t) => t[0] === 'raffle-freeze')[1], 10),
        listenHash: freezeEv.tags.find((t) => t[0] === 'participants-hash')?.[1],
        teilnehmer: freezeEv.tags.filter((t) => t[0] === 'participant').map((t) => t[1]),
      }
    : null
  const w = gewinnerEv?.tags.find((t) => t[0] === 'raffle-winner')
  const ergebnis = gewinnerEv
    ? { event: gewinnerEv, gewinner: w[1], hoehe: parseInt(w[2], 10), hash: w[3], index: parseInt(w[4], 10) }
    : null
  return { freeze, ergebnis }
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

export async function ziehe(tuer, freeze) {
  const hash = await blockHash(freeze.hoehe)
  if (!hash) throw new Error(`Block #${freeze.hoehe} wurde noch nicht gefunden. Bitte ein paar Minuten warten.`)
  const { index, gewinner, anzahl } = berechneGewinner(freeze.teilnehmer, hash)
  const npub = nip19.npubEncode(gewinner)
  const preis = tuer.verlosung?.preis ? ` (${tuer.verlosung.preis})` : ''
  const content = [
    `🎉 Gewinner von Türchen ${tuer.nr}${preis}: nostr:${npub}`,
    '',
    `Glückwunsch! Bitte melde dich per DM beim Host.`,
    '',
    `Nachprüfbar: Block #${freeze.hoehe}, Hash ${hash}`,
    `${anzahl} Teilnehmer, Index = Hash mod ${anzahl} = ${index}`,
    `Prüfen im Kalender: ${CONFIG.seitenUrl}`,
    '',
    `#${CONFIG.hashtag}`,
  ].join('\n')
  return signiereUndSende({
    kind: 1,
    content,
    tags: [
      ['e', tuer.id, CONFIG.relays[0], 'root'],
      ['e', freeze.event.id, CONFIG.relays[0], 'mention'],
      ['p', gewinner],
      ['t', CONFIG.hashtag],
      ['raffle-winner', gewinner, String(freeze.hoehe), hash, String(index)],
    ],
  })
}

/** Unabhängige Prüfung einer Ziehung (für alle Besucher) */
export async function pruefeZiehung(freeze, ergebnis) {
  const schritte = []
  const hashListe = await listenHash(freeze.teilnehmer)
  schritte.push({ ok: hashListe === freeze.listenHash, text: `Prüfsumme der Teilnehmerliste (${freeze.teilnehmer.length} Npubs) stimmt` })
  schritte.push({ ok: freeze.event.created_at < ergebnis.event.created_at && ergebnis.hoehe === freeze.hoehe, text: `Block #${freeze.hoehe} wurde vor der Ziehung festgelegt` })
  const hash = await blockHash(freeze.hoehe)
  schritte.push({ ok: hash === ergebnis.hash, text: `Blockhash laut mempool.space: ${hash ? hash.slice(0, 16) + '…' : 'nicht gefunden'}` })
  if (hash) {
    const r = berechneGewinner(freeze.teilnehmer, hash)
    schritte.push({ ok: r.gewinner === ergebnis.gewinner && r.index === ergebnis.index, text: `Hash mod ${r.anzahl} = ${r.index} → Gewinner stimmt überein` })
  }
  return { ok: schritte.every((s) => s.ok), schritte }
}
