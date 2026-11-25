# Document reading — native smoke and verification procedure

- Type: Verification procedure.
- Scope: the focus reader, wide tables, the expanded diagram viewer, **Expand to read** in previews and
  **Read draft**, in Alice Desktop on macOS and in the browser suites.
- Source: "Comfortable document reading and expanded previews" REQ-001–007 and "Comfortable document
  reading — Technical design" § Definition of Done / Testing design.
- Status: **procedure only.** Nothing below has been run as part of writing it. Results are recorded by
  the qualification step, under `.alice-test/document-reading/`, with the date, machine and build.

Use disposable data only. Never open a real workspace, a real Alice server or the operator's documents
for these checks, and never create, review or change real documents as a test.

## Automated checks

```sh
npm run typecheck
npm test
npm run build
npx playwright test tests/e2e/document-reading.spec.ts tests/e2e/document-preview.spec.ts \
  tests/e2e/document-links.spec.ts tests/e2e/document-editor.spec.ts tests/e2e/document-navigation.spec.ts \
  tests/e2e/document-save-recovery.spec.ts tests/e2e/mermaid.spec.ts tests/e2e/frozen-prototype.spec.ts \
  --output .alice-test/document-reading/e2e-results
npm run storybook:build
npm run test:ui -- --output .alice-test/document-reading/ui-results
```

Run concurrent Playwright runners with separate `--output` folders. These suites use Chromium (desktop
and a Pixel-sized phone). They do not qualify Safari, Firefox or physical phones and tablets, and a
browser run or the Desktop bridge fake is not a substitute for the native check below.

## Native smoke on Alice Desktop (macOS)

### 1. Isolated build and data

```sh
npm run desktop:build
export ALICE_HOME="$(mktemp -d /tmp/alice-reading-smoke.XXXXXX)"
ALICE_HOME="$ALICE_HOME" src-tauri/target/release/bundle/macos/Alice.app/Contents/MacOS/alice-desktop
```

`ALICE_HOME` keeps the Local workspace, its database and logs in the temporary folder, so the operator's
real workspaces are not touched. In setup, create a Local workspace and **do not** enable the `alice`
command, Codex or Claude Code integrations (they would write to the real home folder). Record the
macOS version, Mac model and the commit the app was built from.

### 2. Fixtures

Create the documents in the app: **New document → Markdown**, paste, then **Create document**.

```sh
node --import tsx tests/manual/document-reading-fixtures.ts reading | LANG=en_US.UTF-8 pbcopy   # "Reading fixture"
node --import tsx tests/manual/document-reading-fixtures.ts draft | LANG=en_US.UTF-8 pbcopy     # "Draft check"
```

Create a third document, "Link source", whose body links to the first one:
`[Reading fixture](/documents/<id of Reading fixture>#wide-table)`.

### 3. Steps and expected results

| # | Do | Expect |
|---|---|---|
| 1 | Open "Reading fixture", scroll halfway, Tab to **Focus reader** and press Enter | Near-full-window reader with title, "Saved document · … · Revision N" and Close in view; no page change underneath |
| 2 | In the reader, scroll; resize the window narrower and wider | Content scrolls on its own; header and Close stay visible; text keeps its line length; no sideways page scroll |
| 3 | Tab to the wide table, use the arrow keys; then scroll it with the trackpad | Only the table moves sideways; Column 20 is reachable |
| 4 | **Expand diagram** on the large diagram | Viewer opens fitted (whole diagram visible), zoom % shown |
| 5 | **Zoom in** ×3, + and −, 0; pinch on the trackpad and ⌘ + scroll over a node; scroll with two fingers; resize the window while fitted, then while zoomed | Zoom changes instantly with no redraw flash and stays around the pointer; plain scrolling moves the diagram; 0 fits again; resize refits only when fitted |
| 6 | Escape, Escape | Viewer closes (focus on Expand diagram), then the reader closes (focus on Focus reader, same scroll position) |
| 7 | Switch Settings → Appearance to Dark and repeat 1, 4 | Both views readable in dark |
| 8 | Open "Link source", press the preview icon, then **Expand to read** | Full document opens above the preview, starting at "Wide table", with actual status/revision/reviewed revision |
| 9 | Escape ×2 | Reader, then preview close; focus returns to the preview icon |
| 10 | Edit "Draft check", type a word and immediately press **Read draft** | Reader labelled "Unsaved draft · not a saved revision" shows the new word |
| 11 | Close, press ⌘Z in the editor, open **Read draft** again; switch to Markdown and repeat | The undone word is gone; Markdown mode stays selected; no save happened (revision unchanged) |
| 12 | In the draft reader, follow a link to another document | Reader closes and **Discard unsaved changes?** appears; **Stay and keep editing** keeps the draft |
| 13 | Quit Alice Desktop | No unsaved-changes prompt unless the draft still has changes |

Capture a screenshot for steps 1, 4, 5, 8 and 10 into `.alice-test/document-reading/native/` and note
anything that differs from the browser suites.

### 4. Clean up

```sh
rm -rf "$ALICE_HOME"
```

## Rollback

The feature is frontend only: no migration, no schema, Client API or MCP change, and nothing is stored
for it (the focus reader is not remembered between visits). Rolling back means shipping the previous
frontend build; no data needs converting.
