import type { CSSProperties, ReactNode } from 'react'
import { AUTH_BACKGROUNDS, MASCOTS } from './assets'
import { BrandLogo } from './components'
import { aliceSays, type AliceCopyKey } from './copy'

export type AuthVoice = Extract<AliceCopyKey, 'login' | 'setup' | 'invite'>

/**
 * Shared authentication scene ("workspace peek"): a compact form surface over a quiet
 * suggestion of the Board, with Alice peeking from the surface's right edge. With a `voice`, Alice
 * greets the person with the approved line; without one (e.g. an invalid invite) the surface stays
 * factual and she does not appear. All scenery is decorative and outside the accessibility tree.
 */
export function AuthShell({ title, intro, voice, children }: { title: string; intro?: string; voice?: AuthVoice; children?: ReactNode }) {
  const scene = {
    '--auth-scene-dark': `url(${AUTH_BACKGROUNDS.dark.src})`,
    '--auth-scene-light': `url(${AUTH_BACKGROUNDS.light.src})`,
  } as CSSProperties
  const peek = MASCOTS.peek
  return (
    <main className="auth-scene" style={scene}>
      <div className={`auth-stage${voice ? ' auth-stage-peek' : ''}`}>
        <section className="auth-surface" aria-labelledby="auth-title">
          <div className="auth-logo">
            <BrandLogo height={36} />
          </div>
          <h1 id="auth-title">{title}</h1>
          {voice && <p className="alice-says">{aliceSays(voice)}</p>}
          {intro && <p className="muted">{intro}</p>}
          {children}
          {voice && (
            // ภาพมีขอบแนวตั้งที่ Alice จับอยู่: จัดให้ทับขอบขวาของ surface พอดี
            <img
              className="mascot auth-peek"
              src={peek.src}
              width={peek.width}
              height={peek.height}
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="eager"
              draggable={false}
            />
          )}
        </section>
      </div>
    </main>
  )
}
