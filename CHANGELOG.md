# Changelog

## 0.2.6 — 2026-11-23

### Added

- **Video presentations with `alice-demo`.** Agree the story and presentation style, review one
  editable Storyboard Document, approve production, then create real web capture, HTML presentations
  or mixed scenes. Narration and subtitles are separate choices; gTTS, edge-tts and user-selected
  alternatives are supported. Deliver MP4 plus editable/reproducible sources in chat.
- **Bundled production helpers and guides.** Playwright capture, explicit-time HTML rendering,
  measured narration/subtitles and FFmpeg assembly include source-revision checks and offline
  reproduction. Production tools are installed in the job environment, not Alice's runtime.

### Changed

- **Desktop and CLI distribute all six skills.** `alice-demo` is included in the existing Codex and
  Claude Code installers. Updating Alice refreshes the enabled Local integrations; restart the agent
  session to load the new skill. No schema, Client API or MCP contract change is required.

### Fixed

- **Media verification in CI.** Chromium and FFmpeg are prepared before the unit/system media tests,
  and browser discovery preserves the installed cache while each test keeps an isolated HOME.

## 0.2.5 — 2026-11-23

### Added

- **Full-page document writing with rich text.** Documents are created and edited on their own pages
  with a rich text editor and a Markdown view a click away. Markdown stays the saved format: untouched
  blocks keep their exact text, unsupported content stays as written, and pasted scripts and unsafe links
  are dropped. Interrupted saves can be retried without duplicates, a newer version saved meanwhile is
  flagged before you overwrite it, and leaving, signing out, switching workspace or closing Alice Desktop
  with unsaved changes asks first. See [Writing documents](docs/document-authoring.md).
- **Board cards open and move more easily.** Click anywhere on a card to open it; drag cards by mouse,
  trackpad or a long press on touch, including to columns off screen.
- **README quick start.** The README opens with a concept illustration and four copyable prompts that let
  Codex or Claude Code set up the app, the `alice` command or the skills.

### Changed

- **`alice-plan` writes plans directly.** Once discovery and its checks pass, the plan goes straight to
  the board instead of being shown in chat for approval, and leaves whose dependencies are done become
  ready without a separate question. The agent reports in a few lines by task title and still asks
  before starting any work. Missing scope or design decisions are still raised instead of guessed.
- **Agents name tasks and documents by title.** All five Alice skills talk about tasks and documents by
  their titles in questions, progress, summaries, tables and handoffs, adding the project or parent when
  titles repeat. Ids appear only when you ask or an exact command needs them, next to the title, and
  stay in tool calls, saved references and requirement ids.

### Fixed

- **Mermaid diagrams render in Alice Desktop.** Documents, tasks and comments showed "Unable to render
  Mermaid diagram" in Desktop since 0.2.4, while browsers were unaffected.

## 0.2.4 — 2026-11-22

### Added

- **Mermaid diagrams in Markdown.** Task descriptions, documents, previews, document revisions,
  project descriptions and comments render diagrams locally in the app theme. Diagram source remains
  available; invalid diagrams show an error without breaking the surrounding content. Active content
  and external resources are restricted. Zoom, pan and export are not included.
- **Reusable project understanding.** The new `alice-understand` skill explores existing systems,
  records evidence and coverage, maintains linked knowledge and a Mermaid System graph, and refreshes
  affected sections when called again. CLI and Local integrations distribute all five Alice skills.

### Changed

- **Selective knowledge use.** Think, spec, plan and implementation workflows look up relevant project
  knowledge and maintain affected details without loading every document for every task.

### Fixes

- **Self-signed macOS installation.** The install script validates the release's existing code
  signature without requiring an Apple Developer ID, matching the supported self-signed release path.

## 0.2.3 — 2026-11-21

### Added

- **Agent-ready document knowledge.** Documents gain tags, curated search keywords, owners, lifecycle
  status, revision-specific review provenance and typed references/related/supersedes relationships.
  Web, CLI, Client API and MCP share explainable lexical search and filters without requiring vectors.

### Changed

- **Portable export format v2.** Exports include document knowledge metadata, review audit and typed
  relations. Upgrades preserve existing revisions and links, backfill documents as unreviewed, and
  require the pre-upgrade backup for rollback to an older schema.

## 0.2.2 — 2026-11-20

### Added

- **A complete requirements-to-delivery skill flow.** `alice-think` clarifies new work, `alice-spec`
  agrees technical design and Definition of Done, `alice-plan` creates an executable breakdown, and
  `alice` claims and completes tasks. Each stage recommends the next one without invoking it silently.
- **Optional Testing design.** Technical designs can map requirements to critical scenarios, test
  levels, suites, setup, expected results and evidence when risk or complexity makes that decision
  necessary before planning. Prototypes and investigations may instead define a bounded validation
  method and remain explicitly outside production.
- **Standalone agent setup guidance.** Alice Desktop provides a copyable prompt that installs the Local
  command and skills, enables the selected agent identity and verifies its workspace without exposing
  credentials.

### Changed

- **`alice-think` now closes every discovery explicitly.** Questions are grouped by the current decision
  frontier, marked with `❓` and a recommended answer marked with `➡️`. Every round reports what was
  agreed, changed and remains. Before saving, it presents one confirmation bundle with the shared
  understanding, acceptance conditions, artifact map, complete proposed content and recommended handoff.
  Small work uses the same compact confirmation instead of creating a task silently.
- **Definition of Done belongs to `alice-spec`.** Spec agrees test, security, deployment/operations,
  performance, accessibility/compatibility, data integrity/recovery and documentation criteria;
  planning maps those approved criteria into tasks and evidence without asking again.
- **Normal local verification no longer needs Alice-specific approval.** Tests, builds, linters and
  local project commands run as ordinary implementation work. Approval remains tied to concrete risky
  effects such as production changes, external systems, spending, destructive data changes or access
  control changes.

### Fixes

- **Local agent commands work through sandboxed hosts.** The skills tell agents to run Local `alice`
  commands with the host permissions needed for the daemon and operating-system credential store,
  avoiding misleading workspace timeouts and missing-credential diagnoses.
- **Agent setup completes under restricted hosts.** The setup prompt requests the required host access
  for the installer and Local workspace checks, and verifies the selected workspace before reporting
  success.

## 0.2.1 — 2026-11-19

### Added

- **A board without the app.** Agents can keep an Alice board as Markdown files in the project's `.alice/`
  folder and commit it with the code: one file per task and per document, with status, assignee, parent,
  blockers, labels and an Activity history. The `alice` and `alice-plan` skills work this way when the
  person chooses it, and offer it when no workspace is reachable. Setting up `.alice/` also writes a
  `README.md` for people and a `.gitignore` for machine files. The first time, the agent says where the
  board is, the good practice, and that it can set up the app and import the board on request. Both
  skills ship this guidance as the same `PROJECT-FILES.md`, so it does not matter which one runs first.
  See `docs/project-files.md`.
- **`alice import`** brings such a folder into any workspace, Local or Remote. It checks every file
  first, creates the project, documents and tasks with their relationships and links, turns each task's
  Activity into a comment, and records the new ids in `.alice/imported.json`. `--dry-run` shows what
  would be created.
- **Skills without the app.** Every release also attaches the CLI as `alice-cli.js`, so the README's new
  path 4 installs the `alice` and `alice-plan` skills from `releases/latest/download/alice-cli.js` with one
  command and Node.js 22.

### Changed

- **A new Alice Desktop app icon** that stands out in the Dock, the taskbar and the app switcher.
- **Alice Desktop no longer supports Macs with Intel processors.** Releases build macOS for Apple Silicon
  only. 0.2.0 is the last Intel build; it keeps working with servers that support its Client API, but it
  will not be offered updates. Use the web app or the `alice` command on those Macs.

### Fixes

- **Completing a milestone no longer flickers.** The checkbox kept the new value only until the server
  answered, so it could briefly flip back before the milestone list reloaded.
- **`alice-plan` knows everything `alice` knows about reaching Alice.** Both skills now carry the same
  workspace choice, `alice` command rules, error codes and quick reference word for word, so an agent
  that only uses `alice-plan` handles the command, its errors and a disabled integration correctly.
- **Agents ask which workspace to use when there is more than one.** At the start of every
  conversation the `alice` and `alice-plan` skills list the Local workspaces and the `alice` MCP server
  they can reach. With one, they name it before the first change; with two or more, they ask which one
  before reading or changing anything, and then add `--workspace` to every command. They also offer the
  Local workspace when the MCP server cannot connect or rejects the token. Before, an agent with an
  `alice` MCP server configured always used it, even when the person meant the Local workspace.

## 0.2.0 — 2026-11-18

The first public release. Alice Desktop, the `alice` CLI and the server image are published from
GitHub Releases and GHCR. It also brings a new interface for the Web dashboard and Alice Desktop,
project planning, and approval requests from agents. The new server features are additive
capabilities (`saved-views`, `project-planning`, `approvals`), so clients keep working with servers
that do not offer them.

### Navigation and look

- **Sidebar.** Home, Task Pads, Tasks, Projects, Documents and Search come first. Agents, Activity
  and Settings are below them. Wide screens can collapse the sidebar to icons, tablets get an icon
  rail, and phones get a top bar with a navigation sheet.
- **New and Ctrl K.** New creates a task, pad, project or document from any page. Ctrl K (⌘K on a Mac)
  finds pages, tasks, documents and commands.
- **Light, Dark or System,** chosen in Settings › Appearance and saved on each device.
- **Old links still work.** `/list`, `/my-tasks` and `/?filters` open the matching Tasks view.
  `/admin`, `/devices` and `/for-agent` open Settings › Administration, Settings › Devices &
  Sessions and Agents.

### Work

- **Home** shows your work by due date, in progress and blocked, plus recent agent activity, and has a
  one-line summary from Alice that you can hide.
- **Tasks.** My Work, Board and List are views of the same tasks. They share search, filters, sort and
  saved views (kept on your device). Rows and cards show only what helps you scan.
- **Task Detail** opens beside the view on wide screens, as a full-height sheet on phones and next to a
  Task Pad, and as a full page. Each field says "Saved", or why it failed, next to it. If someone
  changes the task while you edit it, Alice tells you and lets you choose which version to keep.
- **Task Pads** keep every capture, sync and recovery behaviour, with the new controls and dialogs.
- **Projects** have Overview, Tasks, Documents and Activity tabs. **Documents** and **Search** share
  one result style, and quick search now finds documents too.

- **Select and drag.** In List, select several tasks to change their status, assignee or archive them
  together. On the Board, drag a card to another column to change its status.
- **Saved views follow you.** On servers that support it, saved Tasks views are kept on the server and
  appear on all your devices, visible only to you.
- **Project plans.** Projects can have start and target dates, members (informational, no access change),
  milestones you complete by hand, and a progress bar from their tasks.

### Approvals

- **Agents ask before risky steps.** An agent (or a person) can ask for approval on a task, naming one
  person or anyone. It appears under **Waiting for you** on Home with Approve and Reject and an optional
  note. Only people decide, never the one who asked. Agents use `request_approval` over MCP or
  `alice task ask` in Local workspaces.

### Agents, Activity and Settings

- **Agents** lists the agents in the workspace and links to what each one did, above the setup guide.
- **Set up an agent on this computer.** In a Local workspace, Agents gives Claude Code and Codex a
  copyable prompt that sets them up with the `alice` command: no server, token or MCP. It also has the same
  steps by hand and examples to try. First run opens this page once, right before Home.
- **Activity** filters by person or agent and by tasks, projects or documents. Agents are labelled,
  not only coloured.
- **Settings** is organised into categories. Administration (owners on a server) and Devices &
  Sessions (servers) are categories in it. Revoking an agent token or deactivating an agent now asks
  first.
- **First run in Desktop** has four steps (welcome, workspace, agents, first task) and picks up where
  you left off. Choosing a team server continues the steps after you sign in, and the first run ends on
  Home with the tasks you just wrote down.
- **Guided tour.** Take a short tour from Help in the account menu, or "Help: take the tour" in Ctrl K.

### Public release and getting started

- **Get started in three paths.** The README now starts with: Alice on your Mac without a server, hosting
  Alice for your team, and joining an existing server.
- **Server image.** `ghcr.io/kamolpopkk/alice` for amd64 and arm64. `compose.yaml` runs it, pinned by
  `ALICE_VERSION`, so self-hosting needs only `compose.yaml` and `.env`.
- **Automatic HTTPS.** `docker compose --profile https up -d` adds a Caddy proxy that gets and renews a
  certificate for `ALICE_DOMAIN`.
- **Releases.** A tag makes a draft. Publishing it moves the download links, the updater, the install
  script and `:latest` together.

### Local standalone workspaces

- **No-server first launch.** Alice Desktop creates a private `Personal` workspace and opens a Task Pad.
  There is no server, URL, password or sign-in.
- **Local workspaces.** You can have several; each is served by a hidden daemon bound to loopback and
  protected by a capability. Switch between Local and Remote workspaces in Desktop. The `alice` CLI
  chooses its workspace by flag, environment, project binding or active workspace.
- **Agents without MCP.** Codex and Claude work through `alice --as codex|claude-code …` with stable
  JSON, under their own names. Disabling an agent revokes it immediately.
- **Backups.** Alice makes verified backups before migrations and once a day. Restore makes a new
  workspace by default; replace restore is explicit. Delete moves the workspace to the Trash.
- **Diagnostics.** `alice doctor` is read-only; repair and diagnostic bundles are opt-in.
- **Runtime.** A versioned Local runtime ships with the app (no system Node.js). It switches atomically
  and rolls back on failure.
- **macOS arm64 release.** Code-signed without an Apple Developer ID and not notarized. Install it with
  the checksum-verified `install-macos.sh` or from the DMG with one approval.

### Agents page: keep it up to date

- The Agents page has a **Keep it up to date** section per client: an update prompt and manual steps that
  compare `alice version` with the server manifest, re-download and verify the CLI and adapter, reinstall the
  skills and restart, without touching the token or MCP configuration.

### Agents page: Claude Code via token file

- The Agents page and its prompt connect Claude Code through `alice-mcp-stdio` with
  `ALICE_TOKEN_FILE=~/.config/alice/token`, like Codex. No `ALICE_TOKEN` in the shell profile, and a rotated
  token needs only a reconnect.
- `alice mcp-config --client claude-code --transport stdio` prints the matching `claude mcp add` command and
  uses `ALICE_TOKEN_FILE` in its `.mcp.json` entry.

### alice-plan skill

- New `alice-plan` skill: turns an idea, an Alice document or a large task into a reviewed breakdown in
  Alice. It runs discovery over Alice and the codebase, asks only open questions, drafts in chat, creates
  `backlog` tasks with a fixed template, blockers and linked reference document, and releases unblocked
  leaves to `ready` on confirmation. See `docs/agents.md`.
- `alice install-skill` installs every shipped skill (`alice` and the new `alice-plan`) by default, or one
  with `--skill`. The standalone `alice.js` embeds both, and `alice version` reports each one
  (`agentSkills`; `skills` keeps its previous shape for the `alice` skill).

### Agent tooling downloads

- The server serves standalone `alice.js` and `alice-mcp-stdio.js` (Node.js 22+, no `node_modules`) under
  `/downloads/`, with `/downloads/manifest.json` listing the version, sizes and SHA-256 checksums. No sign-in is
  needed. `npm run build:server` writes them to `dist/downloads/` (`ALICE_DOWNLOADS_DIR` overrides).
- An **Agents** page (`/agents`; `/for-agent` still works) for every signed-in person. It has Claude Code and Codex tabs, steps that use this
  server's URL, and a setup prompt with a Copy button. The prompt has the agent install the tools, skill and MCP
  connection, stop for the person to place the token, then verify with `whoami`.
- `alice mcp-config --client claude-code` now prints `--scope user` and single-quotes the header, so the shell
  no longer expands `${ALICE_TOKEN}` when the command is run.

### Modern authentication scene

- Sign in, Setup and Accept Invite share one "workspace peek" scene:
  - a compact form over a quiet Board-and-desk backdrop, light and dark;
  - Alice peeks from the form's edge;
  - an invalid invite stays factual.
- An accessible Show/Hide password control, a coral primary action with navy text, and stronger field
  borders and focus rings.
- Focused checks: axe on every auth state, geometry, overflow and reflow, local-only network, and a
  screenshot matrix (`scripts/verify/capture-auth-screens.ts`). Maintenance notes are in
  `docs/auth-scene.md`.

### Alice brand and mascot

- Production brand assets:
  - hand-drawn vector head mark, monochrome mark and path-built wordmark;
  - light and dark horizontal logos;
  - favicon, install and Desktop icons;
  - transparent WebP mascots extracted from the approved concept;
  - `brand-assets.json`, plus `npm run brand:build` to regenerate everything.
- A navy-led palette replaces the teal accent in light and dark modes. Semantic colours are unchanged, coral
  is decorative only, and all token pairs meet WCAG 2.2 AA.
- Branded sign-in, setup and invite pages. Alice's approved lines appear on those pages and in page-level
  empty states, the signed-in 404 and recoverable full-page errors. Form and permission errors stay plain
  text.
- Responsive header mark: the wordmark hides at 720 px and below, and the accessible name stays "Alice".
- Web manifest, theme colours and touch icons.
- Accessibility: axe audits of the branded surfaces in both schemes. The board's scrollable region now
  accepts keyboard focus.

### Desktop and CLI clients

- Client API v1 at `/client/v1`:
  - protocol negotiation, `CLIENT_INCOMPATIBLE`, idempotency keys;
  - a resumable event stream with `reset`.

  The Web now uses it through the shared `AliceClient`.
- Device authorization for native clients:
  - browser approval, rotating refresh credentials with replay detection;
  - the **Devices** page and **Admin** session revocation;
  - a separate `ALICE_DEVICE_RATE_LIMIT` and `ALICE_CLIENT_RATE_LIMIT`.
- Alice Desktop (Tauri 2):
  - profiles and keyring credentials, owned by Rust;
  - live events with resume, a disconnected state that never queues writes;
  - `alice://` deep links, signed updates that check compatibility first.
- `alice` CLI, a standalone file:
  - profiles, device login;
  - project, task, document, search, activity and actor commands;
  - JSON and JSONL output, stable exit codes, `alice open`.
- `alice-server` for administration.
- **Deprecated, removal planned in 0.4.0:**
  - `alice serve`, `migrate`, `backup`, `restore`, `export` and `purge`, and `dist/cli.js`. Use
    `alice-server`.
  - The legacy `/api/*` routes, which now send `Deprecation` and `Link` headers. Use `/client/v1`.
- The stdio adapter and skill check compatibility by MCP contract (v1) instead of matching the server's
  release number. `alice-mcp-stdio --version` was added.
- An oversized request body now always gets `413` instead of an occasional connection reset.
- Release workflow for signed macOS, Windows and Linux installers, the standalone CLI, `latest.json` and
  `SHA256SUMS`.

## 0.1.0 — first release

Initial release: shared human/agent taskboard with projects, tasks, relationships,
comments, documents with revisions, full-text search, live updates, remote MCP + stdio adapter,
installable agent skill, backup/restore/export/purge, Docker Compose deployment. See
[docs/release.md](docs/release.md).
