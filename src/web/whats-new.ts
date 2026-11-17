/**
 * The one-time "What's new" note for people who used Alice before the new interface. People who
 * just finished first-run setup on this device never see it.
 */
const KEY = 'alice.whatsNew'
const CURRENT = 'alice-ui-1'

export function whatsNewSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === CURRENT
  } catch {
    return true
  }
}

export function markWhatsNewSeen(): void {
  try {
    localStorage.setItem(KEY, CURRENT)
  } catch {
    /* nothing to remember */
  }
}
