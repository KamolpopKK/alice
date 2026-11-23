# Clean-machine checklist: Local release on macOS (Apple Silicon)

Use a Mac account that has never run Alice and has no Node.js installed (`which node` prints nothing).
Record the release version, the macOS version and the result of each step.

Automation already covers these on every release run:
- the artifact inspection (`desktop-verify-artifacts.mjs --local-runtime`: exact runtime, checksums,
  code signatures, arm64);
- the runtime, launcher, activation and rollback tests;
- the install-script tests.

This list covers what only a real machine can show.

## Install

1. **DMG.** Open the DMG and drag Alice to Applications, then open it. macOS blocks it once. In System
   Settings → Privacy & Security choose **Open Anyway**. Alice opens. Gatekeeper stays on:
   `spctl --status` prints `assessments enabled`.
2. **Install script.** On a second clean account, run the `install-macos.sh` command. Alice opens with no
   approval. `xattr -l /Applications/Alice.app` shows no `com.apple.quarantine`.

## First run and agents

3. **First run.** Setup asks only for names and tools, then opens a Task Pad with the cursor in the
   first line. Nothing asks for a URL, port, password or database path.
4. **Agent tools.** Keep Codex enabled. Afterwards:
   - `~/.local/bin/alice version` works from a new Terminal;
   - `~/.codex/skills/{alice,alice-think,alice-spec,alice-plan,alice-understand,alice-demo}/SKILL.md` all exist;
   - think, spec, plan, understand and demo each have `TEMPLATE.md`, and every installed skill has `PROJECT-FILES.md`
     and `OUTPUT-FORMATS.md`;
   - the Agents view lists all six skills, including `alice-demo`, with the current version;
   - `alice-demo` also includes `PRODUCTION.md`, `scene-template.html` and its five `.mjs` helpers.
     This installs the skill bundle, not Chromium, FFmpeg or Python speech packages.
5. **Desktop-closed CLI journey.**
   1. Quit Alice Desktop.
   2. In Terminal, create a ready task. Then `alice --as codex task claim ID`, then
      `alice --as codex task complete ID --summary "…"`.
   3. Reopen Desktop. The task shows Codex as its assignee and completer, with the summary.

## Security and storage

6. **Keychain.** Keychain Access shows `alice-local` items. Local use raised no Keychain prompts.
7. **Network.** `lsof -iTCP -sTCP:LISTEN | grep node` shows only `127.0.0.1` listeners. Opening that
   port in a browser returns 403/404, never a page.
8. **Files.** `~/Library/Application Support/Alice` and every workspace folder are `drwx------`.

## Shortcuts and switching

9. **Shortcuts and links.** The global capture shortcut opens a Task Pad in the active workspace.
   `alice open task ID` (Local) selects the right workspace.
10. **Local and Remote.** Add a Remote server and sign in. Switch between it and Personal; neither shows
    the other's tasks.

## Update and rollback

11. **Update.** Install the next build over this one through the updater, then:
    - `alice doctor` shows the new runtime as current and the old one as previous;
    - a pre-migration backup exists when the schema changed;
    - no Keychain prompt appears for Local workspaces;
    - Remote sign-ins are kept.

## Delete and uninstall

12. **Delete a workspace.** Delete a scratch workspace with `alice workspace delete … --confirm`. Its
    folder appears in the Trash.
13. **Uninstall.** Move Alice.app to the Trash. Then:
    - `alice task list` still works;
    - `alice workspace status` says updates are no longer managed;
    - the workspace data is untouched.
