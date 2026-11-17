# Alice UI

Alice UI is the internal design system of the Web dashboard and Alice Desktop. It lives in
`src/web/ui/` and is not a public package.

## Using it

```ts
import { Button, TextField, Dialog, Badge } from '../ui'
```

Load `src/web/ui/tokens.css` before `src/web/ui/alice-ui.css`. Pages compose primitives and may own their
layout, but never restyle controls or use colour values directly.

## Tokens

- **Semantic roles only.** Use `--ui-canvas`, `--ui-surface`, `--ui-text`, `--ui-border`,
  `--ui-action-primary`, `--ui-focus`, the status pairs (`--ui-success-bg` with `--ui-success-text`, and so
  on), and the type, space, radius, size, motion and layer tokens.
- **Primitive palette.** The `--p-*` values exist only inside `tokens.css`.
- **Themes.** Light, Dark and System are set with `<html data-theme="light|dark">`. Without the attribute,
  Alice follows the operating system. `ThemeProvider` stores the choice per device under
  `alice.ui.theme`.
- **Dark values.** The dark block appears twice in `tokens.css`, once for System and once for explicit
  Dark. A unit test keeps the two identical.
- **Coral.** Coral at `--ui-accent-decorative` is decorative. Actions use `--ui-action-primary`, which
  meets AA contrast with `--ui-text-on-action`.

## Primitives

| Group | Components |
|---|---|
| Controls | `Button` (primary, secondary, ghost, danger; loading), `IconButton` (required `label`), `LinkButton`, `TextLink`, `Spinner` |
| Fields | `TextField`, `TextArea`, `SelectField` (native), `Checkbox`, `Switch`, `RadioGroup`, `FieldMessage` |
| Display | `Badge`, `Avatar` (round for people, square for agents), `Card`, `SectionHeader`, `EmptyState`, `Skeleton`, `Banner`, `List`/`ListItem`, `Table` |
| Overlays | `Tooltip`, `Menu`, `Popover`, `Dialog`, `Sheet`, `ConfirmDialog` (Radix underneath) |
| Navigation | `Tabs`, `SegmentedControl` (radio semantics) |
| Feedback | `ToastProvider`/`useToast` (short confirmations only; errors stay next to the field or in a `Banner`) |
| Icons | `Icon` with Lucide glyphs, sizes 16, 20 and 24, decorative unless given a `label` |

### Behaviour every primitive keeps

- **Focus.** A visible focus ring with the same token everywhere.
- **Overlays.** Dialogs, sheets and menus trap focus, close on Escape and return focus to what opened
  them.
- **Status.** State is never shown by colour alone: there is always text, an icon or a shape.
- **Touch targets.** On touch screens (`pointer: coarse`), core controls are at least 44 px.
- **Reduced motion.** Removes overlay and skeleton animation.

## Storybook

```bash
npm run storybook          # local only, http://localhost:6006
npm run storybook:build    # static build in storybook-static/ (ignored)
npm run test:ui            # axe (both themes), keyboard, 320 px reflow against the static build
ALICE_UI_VISUAL=1 npm run test:ui                      # visual snapshots (macOS baselines)
ALICE_UI_VISUAL=1 npm run test:ui -- --update-snapshots
```

Storybook is never deployed and is not part of the production build. A browser test checks the
build and the server routes for this.

Stories use synthetic names and `example.test` addresses only. A unit test rejects real endpoints,
local paths and credential-like values.

## Adding or changing a component

1. Build it from tokens and existing primitives. Add no raw colours, no new icon set, and no new
   control style.
2. Add stories for its states: default, hover and focus by keyboard, disabled, loading, error, long
   content and narrow width.
3. Give it an accessible name and keyboard behaviour. Add a keyboard test in `tests/ui/` when the
   behaviour is more than a native control's.
4. Run `npm run storybook:build && npm run test:ui`, and update the visual baselines only after
   reviewing the difference.
