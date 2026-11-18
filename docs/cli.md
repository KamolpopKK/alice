# Alice CLI

`alice` is a client for people and agents who work in a terminal. It talks to Alice through the
[Client API](client-api.md): either a Remote Alice Server, or a Local workspace on this computer whose
hidden daemon it starts on demand (see [Local workspaces](local-workspaces.md)). The CLI itself has no
database and no native dependencies. Server administration is a separate command, `alice-server` (see
[Operations](operations.md)).

## Install

`alice` is one JavaScript file that needs only Node.js 22 or newer.

```bash
node dist/alice.js --help         # from a source checkout after `npm run build`
npm install -g ./                 # installs alice, alice-server and alice-mcp-stdio from a checkout
```

The release also publishes the standalone `alice.js`. You can copy it anywhere and run it with `node`.

## Workspaces

A workspace is either **Local** (private to this computer account, no server or sign-in) or **Remote**
(a profile pointing at an Alice Server). Both appear in one list:

```bash
alice workspace list                    # * marks the workspace commands use here
alice workspace create "Side projects"  # a new Local workspace (alias side-projects)
alice workspace use side-projects       # the CLI's active workspace; Alice Desktop keeps its own
alice workspace current                 # which workspace, and why
```

Every workspace has an immutable id (`wsp_…` for Local, `profile:<name>` for Remote) and a unique
**alias**. Display names may repeat, so commands accept an id or alias, never a display name.

A command picks its workspace in this order, and stops with a list of choices (exit 2) instead of
guessing when none applies:

1. `--workspace ALIAS|ID` (or the older `--profile NAME` / `--server URL`)
2. the `ALICE_WORKSPACE` environment variable
3. `.alice/workspace.local.json` in this directory or a parent — written by `alice workspace bind ALIAS`;
   it is specific to this machine, so keep it out of version control
4. `.alice/workspace.json` — written by `alice workspace bind ALIAS --portable`; it names a shared Remote
   workspace and may be committed
5. the active workspace (`alice workspace use`, or `alice profile use` for Remote); agents have their own
6. the only workspace, when exactly one exists

Alice never writes a binding file unless you run `alice workspace bind`. Human-readable mutations name
their workspace on stderr (`Workspace: Personal (personal, Local)`).

### Agent mode

`--as codex` or `--as claude-code` (or `ALICE_AGENT`) runs a command as that Local agent identity. The
agent's credential comes from the OS credential store, never from the command line. Agents must claim a
task before working on it and complete it with a summary; they cannot use owner settings. Enable an
integration first in Alice Desktop → Settings → Agents or with `alice integration enable codex`.

## Profiles

A profile is a name plus a server URL. Profiles never contain credentials.

```bash
alice profile add work --server https://alice.example.com   # also becomes the active profile
alice profile add staging --server https://staging.example.com --no-use
alice profile list                                          # * marks the active profile
alice profile use staging
alice profile test                                          # server, version, TLS and protocol compatibility
alice --profile work whoami                                 # one command against another profile
alice profile remove staging                                # signs out (revokes the session) and deletes it
```

Profiles are stored in `~/.config/alice/config.json`. On Windows the file is in `%APPDATA%\alice`. Set
`ALICE_CONFIG_DIR` to use another directory.

HTTPS is required. Plain `http://` is accepted only for loopback addresses (`localhost`, `127.0.0.1`,
`[::1]`), or for a development server added with `--insecure-dev`. Every command that uses such a profile
prints a warning. Certificates are verified by Node.js. For a private CA, set
`NODE_EXTRA_CA_CERTS=/path/ca.pem`.

## Signing in

```bash
alice auth login            # prints a link and a code such as BCDF-GHJK, then waits
alice auth whoami           # or: alice whoami
alice auth logout           # revokes this profile's session; other profiles stay signed in
```

`login` opens the approval page in your browser. Use `--no-browser` on a headless machine and open the
printed link elsewhere. You approve the request while signed in to the web dashboard. The CLI never asks
for, accepts or stores your password. See [Desktop and CLI sign-in](device-auth.md).

| Credential | Storage |
|---|---|
| Refresh credential | macOS Keychain (`security`), Linux Secret Service (`secret-tool`), or on Windows a DPAPI-encrypted file in the config directory. The secret is passed through stdin, never as a command argument. |
| Access credential | Memory of the running command only. |

`ALICE_CREDENTIAL_STORE` overrides the choice: `keychain`, `secret-service` or `windows`.
`file:/path/credentials.json` is a plaintext store meant only for automated tests. It prints a warning every
time it is used. There is no silent plaintext fallback.

Each command renews its access credential once. When several `alice` processes run at the same time, a
lock file in the config directory makes them rotate the refresh credential one after another, so parallel
scripts are never mistaken for a stolen credential.

## Everyday commands

Run `alice <group> help` for every option of a group.

```bash
alice project list
alice project create --name "Mobile app" --description-file brief.md --label mobile
alice task list --status ready --assignee me --project "Mobile app"
alice task create --title "Design onboarding" --project "Mobile app" --priority high --due 2030-01-15 --description-file -
alice task claim tsk_…               # ready + unassigned → in progress, assigned to you
alice task comment tsk_… --body-file notes.md
alice task complete tsk_… --summary "Flows approved"
alice task block tsk_A --by tsk_B && alice task relations tsk_A
alice task ask tsk_… --question "Deploy tonight?" --of mia   # someone else decides; see `task approval apr_…`
alice doc create --title "Design notes" --body-file design.md --task tsk_…
alice doc show doc_… --body-only > design.md      # raw Markdown, byte for byte
alice doc restore-revision doc_… 1 --yes
alice search "onboarding" --kind task
alice activity --limit 20
alice open task tsk_…                # Desktop if installed, otherwise the Web page
```

- **Identifiers win.** Mutation targets are opaque ids (`tsk_…`, `prj_…`, `doc_…`). Where a name is
  accepted (`--project`, `--assignee`), it must match exactly one project or actor, ignoring case. If no
  name matches, the command fails with exit code 4. If several match, it fails with exit code 2 and lists
  their ids. It never guesses.
- **Markdown input.** `--description-file`, `--body-file` and `--summary-file` accept a path, or `-` for
  stdin. The content is sent unchanged and never appears on the command line.
- **Pagination.** Lists follow server cursors automatically and stop after 50 items. When more exist, a note
  on stderr says so. Use `--limit N` (up to 10 000) or `--all`.
- **Confirmation.** `archive` and `doc restore-revision` ask before acting. In scripts and other
  non-interactive use, pass `--yes`; without it they exit with code 2 and change nothing.
- **`alice open`.** It uses the `alice://open/<kind>/<id>?profile=<name>` deep link when Alice Desktop is
  registered on this machine. Otherwise it opens `<server>/<kind>s/<id>` in the browser. `--web` and
  `--desktop` force one or the other, `--print` only prints the URL, and `ALICE_DESKTOP=0|1` overrides
  detection.

## Output

| Option | Effect |
|---|---|
| (default) | Aligned tables and `key value` detail views |
| `--json` | Exactly one JSON value on stdout |
| `--jsonl` | One JSON object per line on stdout |
| `--quiet`, `-q` | No progress messages or warnings on stderr |
| `--no-color` | No ANSI colors. Colors are also off when stdout is not a terminal or `NO_COLOR` is set. |

Only data goes to stdout. Progress (including "Starting Local workspace…"), warnings, prompts and errors go
to stderr.

For Local workspaces, in agent mode, for `alice workspace` commands, and whenever `ALICE_JSON_ENVELOPE=1`,
`--json` and `--jsonl` use a stable envelope. Remote commands keep their earlier shape unless you opt in.

```json
{ "ok": true, "workspace": { "id": "wsp_…", "name": "Personal", "alias": "personal", "kind": "local" }, "data": { } }
{ "ok": false, "workspace": null, "error": { "code": "VALIDATION_ERROR", "message": "…", "hint": "…", "choices": [] } }
```

Errors keep their stable code and exit status; with `--jsonl` each item is one enveloped line.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected internal error |
| 2 | Usage or validation error: unknown command or flag, invalid input, missing confirmation |
| 3 | Authentication or authorization: not signed in, session revoked, sign-in denied or expired, forbidden |
| 4 | Not found or invalid state: unknown id, conflicting change, relationship cycle |
| 5 | Compatibility: the server and this CLI do not share a Client API version |
| 6 | Network or availability: connection refused, DNS, TLS verification, timeout, rate limited |

## Agent helpers

The Agent onboarding helpers are part of the CLI. The skill files are embedded in
`alice.js`, so these also work from the standalone file:

```bash
alice install-skill --client claude-code      # or codex; --scope project; --skill alice|alice-plan (default: both)
alice mcp-config --client claude-code         # defaults to the active profile's server URL
```

## Server commands moved to `alice-server`

`alice serve`, `migrate`, `backup`, `restore`, `export` and `purge` still work and forward to `alice-server`
unchanged. They print a deprecation notice on stderr. These aliases will be removed in Alice 0.4.0; use
`alice-server <command>` instead. In the Docker image, both `alice` and `alice-server` are on `PATH`.
