// Sichere Darstellung von Türchen-Inhalten (Text aus Nostr-Events → HTML)
import { CONFIG } from '../config.js'

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const BILD = /\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i
const VIDEO = /\.(mp4|webm|mov)(\?\S*)?$/i
const AUDIO = /\.(mp3|m4a|ogg|wav)(\?\S*)?$/i

function inline(text) {
  // text ist bereits escaped
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>')
    .replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (url) => {
      if (BILD.test(url)) return `<img class="inhalt-bild" src="${url}" alt="" loading="lazy">`
      if (VIDEO.test(url)) return `<video class="inhalt-bild" src="${url}" controls preload="metadata"></video>`
      if (AUDIO.test(url)) return `<audio src="${url}" controls preload="none"></audio>`
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url.replace(/^https?:\/\//, '')}</a>`
    })
    .replace(/nostr:((npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]+)/g,
      (_, b) => `<a href="${CONFIG.nostrViewer}${b}" target="_blank" rel="noopener noreferrer">${b.slice(0, 12)}…</a>`)
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<span class="hashtag">#$2</span>')
}

/** Sehr kleines Markdown: Überschriften (#, ##), Listen (-), Absätze, **fett**, _kursiv_, Links, Medien */
export function renderInhalt(text) {
  const zeilen = esc(text).split('\n')
  let html = ''
  let liste = false
  let absatz = []
  const flush = () => {
    if (absatz.length) html += `<p>${absatz.map(inline).join('<br>')}</p>`
    absatz = []
  }
  for (const roh of zeilen) {
    const z = roh.trimEnd()
    const ueber = z.match(/^(#{1,3})\s+(.*)$/)
    const punkt = z.match(/^\s*[-*•]\s+(.*)$/)
    if (punkt) {
      flush()
      if (!liste) { html += '<ul>'; liste = true }
      html += `<li>${inline(punkt[1])}</li>`
      continue
    }
    if (liste) { html += '</ul>'; liste = false }
    if (ueber) {
      flush()
      const lvl = Math.min(4, ueber[1].length + 2)
      html += `<h${lvl}>${inline(ueber[2])}</h${lvl}>`
    } else if (z.trim() === '') {
      flush()
    } else {
      absatz.push(z)
    }
  }
  flush()
  if (liste) html += '</ul>'
  return html
}

export const TYP = {
  verlosung: { label: 'Verlosung', icon: '🎁' },
  artikel: { label: 'Artikel', icon: '📜' },
  podcast: { label: 'Podcast', icon: '🎙️' },
  gutschein: { label: 'Gutschein', icon: '🎟️' },
  video: { label: 'Video', icon: '🎬' },
  text: { label: 'Überraschung', icon: '✨' },
}
