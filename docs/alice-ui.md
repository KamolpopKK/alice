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
| Fields | `TextField`, `TextArea`, `SelectField` (native), `InlineSelect` (compact, change one value in place), `Checkbox`, `Switch`, `RadioGroup`, `FieldMessage` |
| Display | `Badge`, `Avatar` (round for people, square for agents), `Card`, `SectionHeader`, `EmptyState` (optionally a real heading), `Skeleton`, `Banner`, `List`/`ListItem`, `Table`, `ResourceList`/`ResourceItem` (projects, documents, search results) |
| Tasks | `TaskItem` (card or row with a fixed content budget: title, status, assignee, high or urgent priority, relevant due date, project when needed, open blockers), `PriorityBadge`, `DueLabel`, `AssigneeChip`, `ProjectLabel`, `BlockedBadge` |
| Overlays | `Tooltip`, `Menu`, `Popover`, `Dialog`, `Sheet` (`size="lg"` for detail views), `ConfirmDialog` (Radix underneath) |
| Navigation | `Tabs`, `SegmentedControl` (radio semantics) |
| Feedback | `ToastProvider`/`useToast` (short confirmations only; errors stay next to the field or in a `Banner`) |
| Icons | `Icon` with Lucide glyphs, sizes 16, 20 and 24, decorative unless given a `label` |

Older pages keep a few helpers in `src/web/components/ui.tsx` (`ErrorMessage`, `Loading`, `Field`,
`ActorBadge`). They render Alice UI components and classes, so they look the same; new code imports
from `src/web/ui` directly.

### Behaviour every primitive keeps

- **Focus.** A visible focus ring with the same token everywhere.
- **Overlays.** Dialogs, sheets and menus trap focus, close on Escape and return focus to what opened
  them.
- **Status.** State is never shown by colour alone: there is always text, an icon or a shape.
- **Touch targets.** On touch screens (`pointer: coarse`), core controls are at least 44 px.
- **Form controls.** Text, select and date fields share one height, border, radius and focus ring.
  Selects and date fields stay native elements (platform keyboard, screen reader and mobile pickers)
  but drop the platform look: every `<select>` shows the Alice chevron and date fields show a
  calendar icon, both from theme tokens. The opened option list, the calendar and the date format
  stay the platform's. An empty date field (`value=""` on `TextField`) is muted, because WebKit
  fills it with today's date as an example. The Fields / Side by side story shows every state.
- **Reduced motion.** Removes overlay and skeleton animation.

- **Errors.** A `FieldMessage` with an `id` belongs to a field (read through its `aria-describedby`);
  without an `id` it is announced at once (`role="alert"`). `ConfirmDialog` focuses Cancel first for
  destructive actions.

## Page patterns

These compositions are shared so that every area behaves the same way.

- **Tasks** (`src/web/tasks/`). My Work, Board and List are views of one task list (`?view=`). They
  share one toolbar: view switch, search, filters, sort and saved views. Filters live in the URL.
  Saved views are kept on the device under `alice.tasks.savedViews`. Rows and cards use `TaskItem`.
- **Task Detail** (`TaskDetail`). One component renders three ways:
  - a side panel beside a work view on screens of 1180 px and wider (`?task=`, so Back closes it);
  - a full-height `Sheet` on narrower screens and beside a Task Pad;
  - the full page at `/tasks/:id`.

  Closing it returns focus to the task that opened it. Each field shows "Saving…", "Saved" or its error
  next to itself. If someone else changes a task while it is being edited, the editor says who and lets
  the person choose which version to keep.
- **Resource pages** (Projects, Documents, Search, Agents, Activity). A heading row with the primary
  action, an optional toolbar, then `ResourceList` or a `Table`. Loading, empty and error states use
  `Skeleton`, `EmptyState` and a `Banner` with Try again.
- **Board.** Clicking anywhere on a card opens its task; its controls keep their own action. Cards
  move between columns by mouse or trackpad (after 8 px of movement) or a 250 ms long press on touch,
  through `@dnd-kit` sensors; the status control stays the keyboard way. A drag never opens the card.
- **Document authoring** (`src/web/documents/`, `pages/DocumentAuthoringPage.tsx`). Full pages for Create
  and Edit with the rich text / Markdown editor, the Markdown bridge, in-memory drafts and the shared
  leave dialog (`documents/leave.tsx`). The app uses a React Router data router so `useBlocker` can
  guard unsaved drafts. Behaviour: [document-authoring.md](document-authoring.md).
- **Project Detail.** Tabs for Overview, Tasks, Documents and Activity; the tab is in the URL (`?tab=`).
- **Settings** (`src/web/settings/`). Categories show as a list beside the detail, or as list then
  detail with Back on narrow screens. A category appears only where it applies: Devices & Sessions on
  Remote, Workspaces in Desktop, Administration for Remote owners. The server still checks every
  permission.
- **Quick and full search.** The command palette and Search use the same result vocabulary
  (`src/web/search/results.tsx`); "Search everything" in the palette opens full Search.

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
