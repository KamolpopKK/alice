// Self-contained so the same function can be embedded in a standalone HTML scene.
export function renderNativeMotion(t, { motion = 'reveal', duration = 5, accent = '#a94727', seed = 0 } = {}) {
  if (!Number.isFinite(t) || !Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(seed)) throw new Error('Invalid motion time/settings')
  const time = Math.max(0, Math.min(duration, t))
  const parts = [...document.querySelectorAll('[data-part]')]
  const entrance = Math.min(1.2, duration * 0.24), step = entrance / Math.max(1, parts.length)
  parts.forEach((node, i) => {
    const delay = motion === 'stagger' || motion === 'handoff' ? i * step * 0.45 : 0
    const p = motion === 'none' ? 1 : Math.min(1, Math.max(0, (time - delay) / Math.max(0.001, entrance * 0.55)))
    const eased = 1 - Math.pow(1 - p, 3)
    node.style.willChange = 'transform, opacity'
    node.style.backfaceVisibility = 'hidden'
    node.style.webkitFontSmoothing = 'antialiased'
    node.style.opacity = String(eased)
    node.style.transform = motion === 'focus' ? `scale(${0.94 + 0.06 * eased})` : `translateY(${(1 - eased) * (motion === 'stagger' ? 22 : 12)}px)`
    node.style.boxShadow = motion === 'handoff' && node.classList.contains('step') &&
      Math.floor(time / Math.max(0.001, duration / Math.max(1, document.querySelectorAll('.step').length))) === [...document.querySelectorAll('.step')].indexOf(node)
      ? `0 0 0 3px ${accent}` : 'none'
  })
}

export function motionScript(visual, duration = 5, seed = 0) {
  const settings = JSON.stringify({ motion: visual.motion, accent: visual.palette.accent, duration, seed }).replace(/</g, '\\u003c')
  return `window.renderAt=(t)=>(${renderNativeMotion.toString()})(t,${settings});window.renderAt(2)`
}
