import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitScale, scrollAfterZoom, zoomBounds, zoomIn, zoomOut, zoomPercent } from '../../src/web/components/mermaid-viewer-geometry'

describe('Mermaid viewer geometry', () => {
  it('fits the whole image and never enlarges a small one', () => {
    expect(fitScale({ width: 400, height: 200 }, { width: 800, height: 600 })).toBe(1)
    expect(fitScale({ width: 2000, height: 500 }, { width: 1000, height: 600 })).toBe(0.5)
    expect(fitScale({ width: 500, height: 3000 }, { width: 1000, height: 600 })).toBe(0.2)
  })

  it('treats missing sizes as 100% instead of dividing by zero', () => {
    expect(fitScale({ width: 0, height: 100 }, { width: 800, height: 600 })).toBe(1)
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1)
  })

  it('keeps zoom within finite bounds that always admit Fit', () => {
    expect(zoomBounds(0.5)).toEqual({ min: MIN_ZOOM, max: MAX_ZOOM })
    // แผนภาพยาวมาก: Fit ต่ำกว่าขั้นต่ำปกติ ต้องยังใช้ได้
    const tiny = fitScale({ width: 40000, height: 300 }, { width: 1000, height: 600 })
    expect(tiny).toBe(0.025)
    expect(zoomBounds(tiny).min).toBe(tiny)
    expect(clampZoom(tiny, tiny)).toBe(tiny)
    expect(zoomOut(tiny, tiny)).toBe(tiny)
    expect(clampZoom(100, 0.5)).toBe(MAX_ZOOM)
    expect(clampZoom(0.001, 0.5)).toBe(MIN_ZOOM)
  })

  it('steps zoom in and out and stops at the bounds', () => {
    expect(zoomIn(1, 1)).toBe(1.25)
    expect(zoomOut(1.25, 1)).toBe(1)
    let scale = 1
    for (let i = 0; i < 50; i++) scale = zoomIn(scale, 1)
    expect(scale).toBe(MAX_ZOOM)
    for (let i = 0; i < 50; i++) scale = zoomOut(scale, 1)
    expect(scale).toBe(MIN_ZOOM)
  })

  it('reports a rounded percentage', () => {
    expect(zoomPercent(1)).toBe('100%')
    expect(zoomPercent(0.3333)).toBe('33%')
    expect(zoomPercent(1.25)).toBe('125%')
  })

  it('keeps the viewport centre on the same image point across a zoom', () => {
    const viewport = { width: 800, height: 600 }
    const next = scrollAfterZoom({ left: 200, top: 100 }, viewport, 1, 2)
    // จุดกลางเดิม (600, 400) ที่ 100% อยู่ที่ (1200, 800) ที่ 200%
    expect(next).toEqual({ left: 800, top: 500 })
    expect(scrollAfterZoom({ left: 0, top: 0 }, viewport, 2, 1)).toEqual({ left: 0, top: 0 })
  })
})
