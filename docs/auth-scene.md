# Authentication scene

Sign in, Setup and Accept Invite (valid and invalid) all render through one component, `AuthShell`
(`src/web/brand/AuthShell.tsx`, used by `src/web/pages/AuthPages.tsx`). Its styles are in the
`auth scene` and `auth controls` sections of `src/web/styles.css`. Desktop renders the same Web pages,
so it has no separate implementation.

## Approved reference

[`docs/design/auth-workspace-peek-approved.png`](design/auth-workspace-peek-approved.png) (1586×992, SHA-256
`5f57954caa92039587594946972a80836637b8495ddf13e45c9ae0ae00c092be`). It defines the composition, hierarchy
and mood. It is not a production asset and is never served.

## How the concept maps to production

| Concept element | Production primitive |
|---|---|
| Compact form surface, left of centre | `section.auth-surface`, max 420 px wide. The stage reserves 180 px on the right for Alice, which shifts the form left. |
| Alice gripping the form edge | `alice-mascot-peek.webp` (533×1100, alpha), absolutely positioned. The vertical grip bar in the art sits at 8.2% of its width and is aligned with the surface's right border. |
| Ambient Board + plant + lamp | `alice-auth-workspace-dark.webp` as a CSS background. In light mode, `alice-auth-workspace-light.webp` is derived from it by `scripts/brand/derive-auth-light.mjs`. |
| Logo, heading, Alice's line | `BrandLogo` (single accessible name), `h1`, `aliceSays(voice)` from `src/web/brand/copy.ts` |
| Eye button in the password field | `PasswordInput` (`src/web/components/ui.tsx`): Show/Hide name, `aria-pressed`, same input element |
| Coral action | Coral `#EE715F` with navy text (4.85:1). Hover `#F4897A`, active `#F6A699`. Disabled or busy at 60% opacity, with busy text. |

## Rules

- **Asset reuse.** Every image comes from `brand-assets.json` through `src/web/brand/assets.ts`. The peek
  pose is the only mascot used here, and only for flows that have a voice key (sign in, setup, valid
  invite). An invalid invite shows the surface and background with no Alice and no conversational copy.
- **Decorative only.** The mascot has `alt=""` and `aria-hidden`. The background is CSS, so it has no DOM
  node. Neither can receive focus or carries readable text, data or controls; tests check this.
- **Static.** No animation or parallax, and no motion-dependent states.
- **Local only.** Nothing is loaded from remote fonts, images or analytics. A test watches network traffic
  to confirm this.
- **Responsive order.** At 760 px and below the background is removed first and the form becomes one
  column. Alice shrinks to a head that peeks over the form's top edge (96×64, clipped to hide the grip bar),
  so the page never widens and the submit button stays near the top.
- **Labels.** Labels are always visible above their fields. There are no floating labels or
  placeholder-only fields. Errors stay plain `role="alert"` text with no Alice reaction.

## Screenshot matrix

`npm run build:web && npx tsx scripts/verify/capture-auth-screens.ts` writes 24 stable JPEGs to
`test-results/auth-screens/` (outside version control) for review against the reference:

- states: sign in, setup, invite, invalid invite;
- schemes: light, dark;
- viewports: 1440×900, 390×844, 320 px wide.

Reduced motion is on, caret and focus are hidden, and images are resized to at most 960 px.

## Intentional differences from the concept

| Difference | Reason |
|---|---|
| The surface is narrower than in the concept (420 px versus about 650 px at 1440) | The design sets the form column at 380–420 px. A compact surface is preferred to a wide card. |
| No coral "sparkle" strokes next to Alice | Decorative extra that is not in the asset contract; keeps the scene restrained |
| Light mode has its own ivory plate | The concept is dark only. The design requires an equivalent light treatment, derived from the same plate. |
| At ≤ 760 px only Alice's head peeks over the form, and there is no background | The design requires removing detail first on narrow screens, with no overflow or displaced primary action |
| The password field gets a visible label and an eye button with an accessible name | Accessibility requirements take precedence over the concept's minimal styling |

## Verification

| Check | Test |
|---|---|
| All four states share the shell; geometry (left of centre, Alice on the edge); no readable or interactive backdrop; decorative semantics; static art | `tests/e2e/auth-scene.spec.ts` |
| No overflow at 320, 390, 640, 720 and 1440 px; scenery dropped when narrow; reflow at 200% and 400% zoom | `tests/e2e/auth-scene.spec.ts`, `tests/e2e/brand-a11y.spec.ts` |
| Local-only network | `tests/e2e/auth-scene.spec.ts` |
| Password reveal/hide by keyboard keeps the value; autocomplete per flow; Tab order; busy state; direct error; sign-in and invite journeys | `tests/e2e/auth-controls.spec.ts`, `tests/e2e/identity.spec.ts` |
| Contrast of the primary action (rest and hover) and field borders, light and dark | `tests/e2e/auth-controls.spec.ts` |
| axe WCAG 2.2 AA audit of sign in, sign in with revealed password and error, setup, valid and invalid invite, light and dark | `tests/e2e/brand-a11y.spec.ts` |
| Desktop: the shared Web UI still works in the native-bridge harness | `tests/e2e/desktop.spec.ts` |
