// Gemeinsame Oberflächen-Helfer: Kurzschreibweise, Toast, Schnee
export const $ = (s, el = document) => el.querySelector(s)
export const $$ = (s, el = document) => [...el.querySelectorAll(s)]

let toastEl
let toastTimer
export function toast(text, dauer = 3200) {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.setAttribute('role', 'status')
    toastEl.setAttribute('aria-live', 'polite')
    toastEl.setAttribute('popover', 'manual')
    document.body.append(toastEl)
  }
  toastEl.textContent = text
  // neu öffnen, damit der Toast über einem gerade geöffneten Dialog liegt
  try { toastEl.hidePopover() } catch { /* war nicht offen */ }
  toastEl.showPopover()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { try { toastEl.hidePopover() } catch { /* egal */ } }, dauer)
}

export function schnee(canvas) {
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const ctx = canvas.getContext('2d')
  let flocken = []
  const groesse = () => {
    canvas.width = innerWidth * devicePixelRatio
    canvas.height = innerHeight * devicePixelRatio
    const n = Math.min(120, Math.floor(innerWidth / 12))
    flocken = Array.from({ length: n }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: (Math.random() * 1.6 + 0.4) * devicePixelRatio, v: (Math.random() * 0.5 + 0.2) * devicePixelRatio,
      d: Math.random() * Math.PI * 2, o: Math.random() < 0.08,
    }))
  }
  groesse()
  addEventListener('resize', groesse)
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const f of flocken) {
      f.y += f.v; f.d += 0.01; f.x += Math.sin(f.d) * 0.3
      if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width }
      ctx.fillStyle = f.o ? '#f7931a' : '#fff'
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill()
    }
    requestAnimationFrame(tick)
  }
  tick()
}
