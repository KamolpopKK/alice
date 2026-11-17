# Alice Desktop

Alice Desktop is a native window, built with Tauri 2, around the same React interface as the Web dashboard.
It is a **remote client only**. It needs a reachable Alice Server. It has no local database, Node runtime,
embedded server, sidecar or offline queue, and closing it has no effect on the server or on agents.

## How it is built

```
React UI (WebView)  ──invoke──▶  Rust core (src-tauri)  ──HTTPS──▶  Alice Server /client/v1
                    ◀─events───                          ◀──SSE────
```

- **Rust core.** Owns profiles, the OS credential store, every network request and the live event stream.
  It sends requests only to the active profile's server, and only under `/client/v1`.
- **WebView.** Calls a fixed list of commands:
  - profiles: `profiles_list`, `profile_add`, `profile_use`, `profile_remove`, `profile_test`;
  - sign-in: `auth_status`, `auth_login_start`, `auth_login_cancel`, `auth_logout`;
  - data and links: `api_request`, `events_subscribe`, `events_unsubscribe`, `open_external`, `deeplink_take`;
  - Task Pad capture: `capture_take`, `shortcuts_get`, `shortcuts_set`, `shortcuts_reset`;
  - `app_info`.

  None of these return a credential. `api_request` refuses device and refresh endpoints, path tricks, and any
  request tagged with a profile that is no longer active.
- **Capabilities** (`src-tauri/capabilities/default.json`). Allow only those commands plus listening to
  events. The WebView gets no shell, filesystem, HTTP, dialog or opener access.
- **CSP.** Scripts and assets come only from the bundle. The WebView's only connection is the IPC channel.
  Remote images over `https:` are allowed for Markdown.

## Server profiles

The first screen asks for a profile name and a server URL. Profiles live in the app's config directory
(`profiles.json`) and hold only the name, the server origin and the display name of the signed-in person.

- HTTPS is required. `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`, or when you tick
  **Allow unencrypted HTTP (development servers only)**. An insecure profile shows a warning in the profile
  bar for as long as it is active.
- **Test** reports the server name and version, TLS state and Client API compatibility.
- **Switch server** changes the active profile. The UI drops every cached view of the previous server
  before it shows anything from the new one.
- **Remove** revokes the profile's session on the server, then deletes the profile and its credential.

## Signing in

**Sign in with browser** opens your default browser at the server's `/device` page and shows a code such as
`BCDF-GHJK`. You approve it there, signing in to the web dashboard first if needed. Alice Desktop never sees
your password.

| Credential | Where it lives |
|---|---|
| Refresh credential | macOS Keychain, Windows Credential Manager or Linux Secret Service, via the Rust `keyring` crate, service `alice-desktop` |
| Access credential | Rust process memory only |

**Sign out** revokes that profile's session and deletes the stored credential. When a session is revoked
elsewhere, for example from **Devices** or **Admin** in the web dashboard, the next request fails and the
app returns to the sign-in screen.

## Application states

| State | What you see |
|---|---|
| No profile | The server list and the form to add a server |
| Login required | The sign-in screen for the active profile |
| Unreachable | "Cannot reach the server". Nothing stale is shown. |
| Incompatible | "Update Alice Desktop" or "This server is too old", with both protocol ranges |
| Ready | The normal Alice interface under a bar showing the profile, server and person |
| Disconnected | The interface stays visible under a "Disconnected from the server" banner. Writes are refused, not queued. |

## Live updates and connectivity

The Rust core opens `/client/v1/events` with the access credential and passes each `ready`, `invalidate`,
`reset` and `unauthorized` event to the UI. The UI then refetches the affected views from the server. These
views come from the same query cache as the Web dashboard, so changes made by agents (MCP), by the CLI or
by other browsers appear without a reload.

- **Reconnect.** After a dropped connection the core retries with backoff (1 s, doubling, at most 30 s) and
  resumes from the last position with `Last-Event-ID`, so nothing in between is missed. If the server can
  no longer replay from that position, it sends `reset` and the UI refetches everything on screen.
- **Disconnected.** A banner says the view may be out of date. Save and submit buttons are dimmed. Any write
  attempted while disconnected fails at once with "nothing was saved". It is never queued. Text in open
  forms stays in memory, so you can retry once the banner disappears.
- **Revoked or expired.** The stream receives `unauthorized`. The core tries one refresh. If that fails, the
  core forgets the credential and the UI returns to the sign-in screen.

Links to other sites, such as document sources and links inside Markdown, open in your default browser
through the native opener. Only `http` and `https` links without embedded credentials are allowed.

## Deep links

Alice Desktop registers the `alice://` scheme. On macOS this is `CFBundleURLTypes` in the app bundle. On
Windows and Linux the installer registers it, and the app also registers it at runtime. The only supported
form is:

```
alice://open/<task|project|document>/<id>?profile=<profile name>
```

- **No server, no credentials.** A link names a profile on *this* computer, a resource kind and an opaque id.
  Links with any other parameter, a port, user info, a fragment, a different action, a malformed id or an id
  of another kind are rejected and nothing is opened. The grammar lives in `src/shared/deeplink.ts` (CLI,
  UI) and `src-tauri/src/deeplink.rs` (native). Both are tested against the same vectors in
  `tests/fixtures/deeplinks.json`.
- **Never another profile.** If the named profile does not exist, the app says so and stays where it is. It
  never falls back to the active profile.
- **Switch, then sign in, then navigate.** For a known profile, the app makes it active, clears cached data
  from the previous profile, and checks reachability, compatibility and sign-in. Only then does it open the
  resource. If sign-in is needed, the link waits until you have signed in. The pending link is handed over
  only while its own profile is active.
- **Cold and warm start.** A link that launches the app is read at startup. A link that arrives while the app
  is running goes to the existing window, which is brought to the front. On Windows and Linux a second
  instance forwards the link to the first and exits.

`alice open task tsk_…` in the CLI produces these links when Alice Desktop is installed. Otherwise it opens
the same resource in the browser. See [CLI](cli.md).

## Task Pad capture shortcuts

Alice Desktop registers two **global** shortcuts so you can capture from any application. Each press
brings the Alice window forward and opens the shared Task Pads UI:

| Action | macOS default | Windows and Linux default |
|---|---|---|
| Open the last pad and focus a new task line | Option+Space | Ctrl+Alt+Space |
| Create a new pad named with the date and time, focus its first task line | Option+Shift+Space | Ctrl+Alt+Shift+Space |

Windows and many Linux desktops use Alt+Space for the window menu, so those platforms default to Ctrl+Alt.

- **Change or turn off:** Task Pads → ⋯ (More pad options) → **Capture shortcuts…**. Press the
  combination in a field (or type it, for example `Ctrl+Alt+P`), then **Save shortcuts**. Clear
  *Use global capture shortcuts on this computer* to unregister both. **Restore defaults** brings back
  the platform defaults. The choice is stored in `shortcuts.json` in the Desktop configuration
  directory, survives restarts, and belongs to this computer (not to a server profile).
- **Rules:** every shortcut needs Ctrl, Alt/Option or Cmd/Super (a bare or Shift-only key would take
  ordinary typing away from every app), and the two shortcuts must differ. Alice never registers
  combinations the system or screen readers own (for example Cmd+Space, Ctrl+Space, Alt+Tab, Alt+Space on
  Windows/Linux, VoiceOver, Narrator and Orca keys); such a choice is saved but shown as *reserved*.
- **Conflicts:** if another application already holds a combination, the dialog shows *could not be
  registered* next to it. Pick another combination and save; nothing else changes.
- **Signed out or incompatible server:** a press while the sign-in or update screen is showing is kept.
  After you sign in (or switch to a compatible profile), the pad opens once. Several presses while
  waiting still produce a single new pad.
- **In the browser:** while the Alice tab (or window) is active, Alt+Shift+P opens the last pad and
  Alt+Shift+N creates a new one. They are not global and can be turned off in the same dialog.

The shortcuts are registered by the Rust core with `tauri-plugin-global-shortcut`; the WebView gets no
global-shortcut permission. New native commands: `capture_take`, `shortcuts_get`, `shortcuts_set` and
`shortcuts_reset` (declared in `build.rs` and allowed in `capabilities/default.json`). The capture intent
is emitted as `alice://capture` and handed to the UI once through `capture_take`.

For packaging smoke tests, `ALICE_DESKTOP_CAPTURE=new-pad` (or `open-last`) queues one capture intent at
start-up without synthesizing OS key presses.

## Development

```bash
npm run desktop:dev          # Vite + Tauri dev window (needs Rust)
npm run desktop:build        # release bundles for this OS
npm run test:desktop         # Rust core tests against a real Alice Server (needs Node)
node scripts/verify-desktop-bundle.mjs src-tauri/target/release/bundle/macos/Alice.app
ALICE_DESKTOP_SMOKE=exit ./Alice.app/Contents/MacOS/alice-desktop   # prints "alice-desktop: ui-ready" and quits
ALICE_DESKTOP_SMOKE=exit ALICE_DESKTOP_OPEN_URL='alice://open/task/tsk_abcd1234?profile=x' ./Alice.app/Contents/MacOS/alice-desktop
                                                         # also prints "alice-desktop: deeplink accepted|unknown_profile|rejected"
```

Automated tests use a plaintext credential store, compiled only with the `test-credential-store` cargo
feature. The Rust integration tests use an in-memory store. Release builds always use the OS keyring.

## Local workspaces

On first launch, with no workspaces yet, Alice Desktop opens a short setup:
1. Name the workspace (`Personal` by default) and yourself.
2. Choose which tools to install: the `alice` command, Codex and Claude Code.
3. Start typing in a new Task Pad.

There is no server URL, password or sign-in. See [Local workspaces](local-workspaces.md).

- **Switching.** The bar at the top shows the active workspace and whether it is **Local** or **Remote**.
  **Switch workspace** lists the Local workspaces first, then the Alice servers. From that list you can
  create, rename, change the alias of and use Local workspaces.
- **What a switch clears.** It drops cached data, the event stream, the current page and any queued capture
  shortcut before the destination workspace opens.
- **Desktop and the CLI choose separately.** Desktop's active workspace is independent of the `alice` CLI's.
- **Local activation.** The native core starts or reuses the workspace's hidden daemon through the
  installed Alice runtime. It keeps the daemon's loopback address and capability in memory only, and
  renews a presence lease every minute.
- **Remote sign-in is unchanged.** Remote workspaces still sign in through the browser.
- **Deep links.** A link with `?workspace=wsp_…` opens that Local workspace first. An unknown id opens
  nothing and never falls back to another workspace.
- **Start-up failure.** If a Local workspace cannot open, Desktop shows only a recovery screen: Try again,
  Open data folder and Switch workspace, plus restore and diagnostics once those exist. Technical details
  are collapsed under a toggle.
