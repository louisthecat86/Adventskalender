// Datumslogik: Welche Türchen dürfen heute geöffnet werden?
import { CONFIG } from '../config.js'

function berlinTeile(date) {
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: CONFIG.zeitzone,
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false,
  })
  const t = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]))
  return { jahr: +t.year, monat: +t.month, tag: +t.day, stunde: +t.hour % 24 }
}

/** Liefert die Vorschau-Datumsangabe aus der URL oder null */
export function vorschauDatum() {
  if (!CONFIG.vorschauErlaubt) return null
  const v = new URLSearchParams(location.search).get('vorschau')
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [jahr, monat, tag] = v.split('-').map(Number)
  return { jahr, monat, tag, stunde: 23 }
}

export function jetztTeile(ohneVorschau = false) {
  return (!ohneVorschau && vorschauDatum()) || berlinTeile(new Date())
}

/** Höchste Türchennummer, die aktuell geöffnet werden darf (0–24). ohneVorschau = echtes Datum */
export function offeneTuerchenBis(ohneVorschau = false) {
  const j = jetztTeile(ohneVorschau)
  if (j.jahr < CONFIG.jahr || (j.jahr === CONFIG.jahr && j.monat < 12)) return 0
  if (j.jahr > CONFIG.jahr) return 24
  const bis = j.stunde >= CONFIG.oeffnungsStunde ? j.tag : j.tag - 1
  return Math.max(0, Math.min(24, bis))
}

/** Tage bis zum 1. Dezember bzw. bis Heiligabend – für den Kopfbereich */
export function statusText() {
  const j = jetztTeile()
  const heute = Date.UTC(j.jahr, j.monat - 1, j.tag)
  const start = Date.UTC(CONFIG.jahr, 11, 1)
  const heiligabend = Date.UTC(CONFIG.jahr, 11, 24)
  const tage = (a, b) => Math.round((b - a) / 86400000)
  if (heute < start) {
    const n = tage(heute, start)
    return n === 1 ? 'Morgen geht das erste Türchen auf.' : `Noch ${n} Tage, dann geht das erste Türchen auf.`
  }
  if (heute < heiligabend) {
    const n = tage(heute, heiligabend)
    return n === 1 ? 'Morgen ist Heiligabend.' : `Noch ${n} Tage bis Heiligabend.`
  }
  if (heute === heiligabend) return 'Frohe Weihnachten! Alle Türchen sind offen.'
  return 'Der Kalender ist vorbei. Alle Türchen bleiben offen.'
}

/** Unix-Zeit (Sekunden) für den Beginn von Tag X im Dezember, Zeitzone Berlin (näherungsweise UTC+1) */
export function tagStartUnix(tag) {
  return Math.floor(Date.UTC(CONFIG.jahr, 11, tag, CONFIG.oeffnungsStunde - 1) / 1000)
}

export function formatDatum(unix) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: CONFIG.zeitzone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(unix * 1000)) + ' Uhr'
}
