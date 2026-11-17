# Alice brand assets

This page is the source of truth for Alice's logo, mascot and icons. It covers what exists, how each file
was made, and how to change one safely.

## Inventory

Deployable files live in `src/web/public/brand/`. Vite copies them to `/brand/…` in the build. Their
details (paths, sizes, intended surfaces, colour schemes and palette) are listed in
`src/web/public/brand/brand-assets.json`, which `npm run brand:build` writes.

| File | What it is | Made by |
|---|---|---|
| `alice-logo-horizontal-light.svg` | Head mark + navy `Alice` wordmark, transparent | `scripts/brand/build-vectors.mjs` |
| `alice-logo-horizontal-dark.svg` | Head mark with ivory halo + ivory wordmark, for dark surfaces | same |
| `alice-mark.svg` | Head mark only (header, compact uses) | same |
| `alice-mark-monochrome.svg` | One-colour mark in `currentColor` | same |
| `favicon.svg`, `favicon-32.png` | Browser tab icon | same |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | Opaque navy install icons with 12% safe padding | same |
| `alice-mascot-friendly.webp` | Full body, open smile (login, setup, invite) | `scripts/brand/extract-mascots.mjs` |
| `alice-mascot-peek.png`, `alice-mascot-peek.webp` | Transparent full-height pose gripping the authentication-card edge | Built-in ImageGen using the friendly production mascot and approved workspace-peek reference; optimized with `sharp` |
| `alice-mascot-neutral.webp` | Bust, calm smile (My Tasks empty) | same |
| `alice-mascot-curious.webp` | Bust, finger to cheek (Projects empty) | same |
| `alice-mascot-focused.webp` | Bust, thinking (Documents empty) | same |
| `alice-mascot-concerned.webp` | Bust, mildly worried, no tears (404, full-page error) | same |
| `alice-auth-workspace-dark.webp` | Subdued Board-and-desk background plate for dark authentication pages | Built-in ImageGen from the approved workspace-peek reference; optimized with `sharp` |
| `alice-auth-workspace-light.webp` | Warm ivory version of the same plate for light mode | `scripts/brand/derive-auth-light.mjs` (from the dark plate) |
| `src-tauri/app-icon.png` → `src-tauri/icons/*` | Desktop app icons | `build-vectors.mjs`, then `cargo tauri icon` |

## Palette

| Token | Value | Use |
|---|---|---|
| `brand-navy-900` | `#202A44` | Wordmark, primary controls in light mode, icon background |
| `brand-navy-700` | `#344466` | Hover and secondary navy |
| `brand-ivory` | `#FFF8EE` | Brand background, reversed wordmark, dark-surface halo |
| `brand-cocoa` | `#4A312E` | Hair and outline |
| `brand-coral` | `#EE715F` | Decoration only (the i dot, cheeks). Never body text on ivory. |
| `brand-coral-accessible` | `#B64336` | Coral wherever text contrast is required |

Character colours (skin `#FCE5D4`, eyes `#2E201E`) are fixed. They are never inverted or filtered in dark
mode.

## How the files were made

### Vectors: logos, marks, favicon, icons

The head mark is drawn by hand as plain SVG paths in `scripts/brand/mark-art.mjs`, on a 64×64 grid. It is
modelled on the approved logo board:

- cocoa bob with a side-swept fringe;
- ivory scalloped headband;
- dark eyes with highlights, coral cheeks and a small open smile.

The wordmark in `scripts/brand/wordmark.mjs` is built from geometric stroked paths with round caps. It
uses no font, so it renders the same everywhere. The i has a decorative coral dot, as on the board.
`build-vectors.mjs` assembles the files and renders the PNG icons from the same vectors with `sharp`
(librsvg).

The SVGs contain no bitmaps, scripts, external references, fonts or metadata. `tests/unit/brand-assets.test.ts`
enforces this.

### Raster mascots

`scripts/brand/extract-mascots.mjs` cuts the approved poses from the character sheet and then:

1. crops each pose at the coordinates in `POSES`;
2. finds the flat board background as the median colour of the crop's border;
3. flood-fills the background inwards from the border. The character's closed dark outline stops the
   fill, so ivory parts inside the outline (apron, headband) are kept;
4. removes the floor shadow under the full-body pose;
5. keeps only the main character, dropping fragments of neighbouring poses;
6. turns anti-aliased edge pixels (within 2 px of the background) into real alpha, removing the board
   colour from them;
7. trims to the character with 6 px padding;
8. writes WebP (quality 90, lossless alpha).

`--preview DIR` also writes each pose flattened on white and on navy so you can check the edges by eye.

The workspace-peek pose is a separate generated production asset because its two-hand edge-grip
pose does not exist on the original character sheet. Its identity reference is
`alice-mascot-friendly.webp`; its pose and composition reference is
`docs/design/auth-workspace-peek-approved.png`. The PNG is the transparent high-quality fallback/source
export and the WebP is the runtime asset. The auth background source is kept at
`docs/design/auth-workspace-background-dark-source.png`; the optimized WebP is the only background file
served at runtime. Both generated images contain no text, remote content, or watermark.

The concept boards are inputs to this script only. Nothing under `src/` refers to them, and they are not in
the build. A test checks this.

## Regenerating

```bash
npm run brand:build                                   # mascots → vectors/icons → brand-assets.json
node scripts/brand/extract-mascots.mjs --preview /tmp/brand   # optional edge inspection
(cd src-tauri && cargo tauri icon app-icon.png -o icons && rm -rf icons/android icons/ios)
npx vitest run tests/unit/brand-assets.test.ts
```

**To change one asset:**

- **Mascot crop.** Edit its rectangle in `POSES`, regenerate, then check the preview on white and on navy.
- **Head mark.** Edit `headArt()` in `mark-art.mjs`. Every logo, favicon and icon uses it.
- **Wordmark spacing.** Edit `wordmark.mjs`. The width of the horizontal logo follows automatically.
- **New expression.** Add a pose, add it to `ASSETS` in `build-manifest.mjs`, and add it to the typed asset
  map in `src/web/brand/`.
- **Light auth background.** It is derived automatically from the dark plate: the script inverts lightness
  and keeps hue, maps the navy structure to warm grey on ivory, and keeps coral and lamp warmth faintly.
  Re-run `node scripts/brand/derive-auth-light.mjs` whenever the dark plate changes. `npm run brand:build`
  does this too.
- **Workspace-peek pose/background.** Regenerate from the identity, pose and composition references and
  constraints documented above, export real alpha for the mascot, then optimize with `sharp`
  before rebuilding the manifest.

The size budget is 180 KiB per WebP and 300 KiB per file of any type.

## Copy and placement rules

The approved lines live only in `src/web/brand/copy.ts`. Alice speaks in exactly these places:

- login, setup and invite;
- the empty states of My Tasks, Projects and Documents;
- the signed-in 404 page;
- recoverable full-page errors.

Everything else stays plain text:

- form and permission errors;
- loading states;
- board columns, comments, activity, relationship and linked-document panels.

Never:

- write role-play phrasing such as "master" or "at your service";
- blame the user, or use crying or disappointed expressions;
- apply `invert()` or hue filters to the mascot;
- use coral for body text on ivory;
- reference files in `artifacts/` at runtime.

## Deviations from the concept boards

| Item | Deviation | Reason |
|---|---|---|
| Head mark and logos | Simplified hand-drawn vector instead of the board's detailed head | Clean scalable SVG that is still recognisable at 16–32 px. The board artwork is raster-only. |
| Wordmark | Rebuilt as geometric paths; letter shapes approximate the board | No licensed font matching the board; paths give deterministic rendering |
| Concerned expression | The board's worried bust has a small sweat drop | Calm concern, not tears; within the spec's "concerned, not crying" |
| Full-body sizes | Friendly pose is 265×547 px | Sharp up to about 130 CSS px wide at 2×. Wider uses would need re-generated art. |

Accepted by: the implementing agent. **Maintainer review is still open**: compare the exports with the
concept boards and record approval here.

## Verification

Automated checks:

| Check | Where |
|---|---|
| Asset contract: every required file exists, manifest paths resolve, size budgets, clean SVGs, real alpha, no concept boards | `tests/unit/brand-assets.test.ts` |
| Exact copy deck and no duplicated dialogue in pages | `tests/unit/brand-components.test.tsx` |
| Component semantics: logo named Alice exactly once, decorative mascot, `IllustratedState` structure | `tests/unit/brand-components.test.tsx` |
| WCAG 2.2 AA contrast of palette tokens, light and dark | `tests/unit/brand-contrast.test.ts` |
| Favicon, Apple touch icon, manifest and every manifest asset return 200 from the production build; no remote requests | `tests/e2e/brand.spec.ts` |
| Auth copy, a single logo name, mascot hidden from assistive technology, direct errors with no mascot | `tests/e2e/brand.spec.ts` |
| Header: mark + wordmark when wide, mark only at ≤ 720 px, name kept, height ≤ 56 px, mark 28–32 px, routes to Board | `tests/e2e/brand.spec.ts` |
| Logo switches with the colour scheme; mascot is never filtered | `tests/e2e/brand.spec.ts` |
| Empty states, 404, recoverable error, inline empties without mascot, no overflow at 320 px | `tests/e2e/illustrated-states.spec.ts` |
| axe WCAG 2.2 AA audit of login, invite, board, the three empty states and 404, in both schemes | `tests/e2e/brand-a11y.spec.ts` |
| Keyboard order (skip link → brand → navigation), visible focus, mascot not focusable, no animation | `tests/e2e/brand-a11y.spec.ts` |
| Reflow at 200% and 400% zoom (640 and 320 CSS px) | `tests/e2e/brand-a11y.spec.ts` |

Not automated, so check by hand before release:

- reading order with a real screen reader (VoiceOver, NVDA);
- 400% zoom on a real high-DPI display;
- Desktop app icons on each operating system.
