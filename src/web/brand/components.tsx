import type { ReactNode } from 'react'
import { LOGOS, MASCOTS, type MascotPose } from './assets'
import { ALICE_COPY, type AliceCopyKey } from './copy'

/**
 * The Alice logo. `full` shows the horizontal logo (light/dark variant chosen by the colour scheme,
 * never by filtering the art). `compact` shows the head mark plus a text wordmark that CSS hides at
 * 720 px and below; the accessible name stays "Alice" in every mode and is announced once.
 */
export function BrandLogo({ variant = 'full', height = 40 }: { variant?: 'full' | 'compact'; height?: number }) {
  if (variant === 'compact') {
    return (
      <span className="brand-logo brand-logo-compact">
        <img src={LOGOS.mark.src} width={30} height={30} alt="" aria-hidden="true" className="brand-mark" />
        <span className="brand-wordmark">Alice</span>
      </span>
    )
  }
  const width = Math.round((LOGOS.light.width / LOGOS.light.height) * height)
  return (
    <picture className="brand-logo">
      <source srcSet={LOGOS.dark.src} media="(prefers-color-scheme: dark)" />
      <img src={LOGOS.light.src} width={width} height={height} alt="Alice" />
    </picture>
  )
}

/** Approved mascot art only (typed pose keys). Decorative by default: adjacent text carries the meaning. */
export function MascotImage({ pose, width, loading = 'lazy', className }: { pose: MascotPose; width: number; loading?: 'lazy' | 'eager'; className?: string }) {
  const art = MASCOTS[pose]
  const height = Math.round((art.height / art.width) * width)
  return <img src={art.src} width={width} height={height} alt="" aria-hidden="true" loading={loading} decoding="async" className={`mascot${className ? ` ${className}` : ''}`} draggable={false} />
}

/**
 * Page-level state with Alice: heading, her approved line, and an optional action. Use only for the
 * approved surfaces; inline empty states stay text-only.
 */
export function IllustratedState({
  pose,
  copy,
  title,
  action,
  imageWidth = 140,
  headingLevel = 2,
}: {
  pose: MascotPose
  copy: AliceCopyKey
  title: string
  action?: ReactNode
  imageWidth?: number
  headingLevel?: 1 | 2
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const id = `state-${copy}`
  return (
    <section className="illustrated-state" aria-labelledby={id}>
      <MascotImage pose={pose} width={imageWidth} />
      <div className="illustrated-state-text">
        <Heading id={id}>{title}</Heading>
        <p className="alice-says">{ALICE_COPY[copy]}</p>
        {action && <div className="row">{action}</div>}
      </div>
    </section>
  )
}
