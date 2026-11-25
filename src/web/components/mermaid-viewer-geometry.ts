/** Pure zoom/fit geometry for the expanded Mermaid viewer (no DOM, so it is unit-testable). */

export type Size = { width: number; height: number }

export const ZOOM_STEP = 1.25
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

/** Scale at which the whole image fits inside the viewport, never above 100%. */
export function fitScale(image: Size, viewport: Size): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  return Math.min(1, viewport.width / image.width, viewport.height / image.height)
}

/** Zoom limits for an image. The lower bound always admits Fit, even for very wide or tall diagrams. */
export function zoomBounds(fit: number): { min: number; max: number } {
  return { min: Math.min(MIN_ZOOM, fit), max: Math.max(MAX_ZOOM, fit) }
}

export function clampZoom(scale: number, fit: number): number {
  const { min, max } = zoomBounds(fit)
  return Math.min(max, Math.max(min, scale))
}

export function zoomIn(scale: number, fit: number): number {
  return clampZoom(scale * ZOOM_STEP, fit)
}

export function zoomOut(scale: number, fit: number): number {
  return clampZoom(scale / ZOOM_STEP, fit)
}

export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

/**
 * Scroll offsets that keep the same image point under the viewport centre after a zoom, so zooming
 * does not jump to a corner.
 */
export function scrollAfterZoom(
  scroll: { left: number; top: number },
  viewport: Size,
  from: number,
  to: number,
): { left: number; top: number } {
  const cx = (scroll.left + viewport.width / 2) / from
  const cy = (scroll.top + viewport.height / 2) / from
  return { left: Math.max(0, cx * to - viewport.width / 2), top: Math.max(0, cy * to - viewport.height / 2) }
}
