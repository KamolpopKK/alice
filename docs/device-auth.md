# Desktop and CLI sign-in (device authorization)

Alice Desktop and the `alice` CLI never ask for your Alice password. They sign in with a device flow. The
client shows a short code, you approve it in the web dashboard where you are already signed in, and the
client receives its own session.

## Flow

1. The client calls `POST /client/v1/device/authorize` with `{ clientKind: "desktop" | "cli", clientName, deviceName, clientVersion }`.
   The response holds:
   - a secret `deviceCode` that the client keeps to itself;
   - a `userCode` such as `BCDF-GHJK`;
   - `verificationUriComplete` (`https://alice.example.com/device?code=BCDF-GHJK`);
   - `expiresIn` (600 seconds) and `interval` (5 seconds).
2. The client opens the link, or prints it, and shows the code.
3. In the browser you sign in normally if you are not already signed in. You then see the requesting
   application, its version, the device name and the code, and choose **Approve** or **Deny**. Only a
   signed-in human using the web session can approve. An Agent token or another Desktop/CLI session cannot.
4. The client polls `POST /client/v1/device/token` with `{ deviceCode }`:

| Response | Meaning |
|---|---|
| `428 DEVICE_AUTHORIZATION_PENDING` | Not decided yet. Wait `interval` seconds. |
| `429 DEVICE_SLOW_DOWN` | Polled too fast. `details.interval` is the new wait. |
| `403 DEVICE_ACCESS_DENIED` | You chose Deny. |
| `410 DEVICE_CODE_EXPIRED` | Unknown, expired (after 10 minutes) or already used. Start again. |
| `200` | Credentials, returned exactly once. |

## Credentials

| Credential | Lifetime | Where it lives |
|---|---|---|
| Access (`alice_ca_…`) | 15 minutes | Process memory only. Sent as `Authorization: Bearer …` to `/client/v1`. |
| Refresh (`alice_cr_…`) | 30 days, extended by each refresh | OS credential store: Keychain, Windows Credential Manager or Secret Service. Desktop keeps it in Rust and never passes it to the WebView. |

`POST /client/v1/auth/refresh { refreshToken }` returns a new access and refresh pair. The previous refresh
credential stops working. If a refresh credential that was already rotated is presented again, Alice treats
it as stolen: it revokes the whole session and records `client_session.revoked` with reason
`refresh_reuse_detected`.

The server stores only SHA-256 hashes of device codes, user codes, access and refresh credentials. None of
these values appear in logs, URLs (other than the short user code in the approval link), activity events or
error messages.

Access credentials work only on the Client API. They do not work on the internal `/api` routes or on MCP,
and Agent tokens do not work on the Client API.

## Sessions

Each approval creates a separately named session, for example "Alice CLI on build-box". The approval is
recorded in the activity log as performed by you.

- **Devices** page (`/devices`): every human sees their own sessions and can revoke them.
- **Admin**: the owner sees everyone's sessions and can revoke any of them.
- `POST /client/v1/auth/logout` with a bearer credential ends only that session.
- `POST /client/v1/auth/revoke { refreshToken }` ends a session when the access credential has already
  expired. It always answers `{ ok: true }`.

A revoked session is rejected immediately. API calls return `401`, and an open `/client/v1/events` stream
receives `event: unauthorized` and closes. Other sessions of the same person are not affected.

## Rate limits and logs

Device endpoints (`authorize`, `token`, `lookup`, `approve`, `deny`, `refresh`, `revoke`) share
`ALICE_DEVICE_RATE_LIMIT` per address (default 60 per minute). This is separate from the password limit, the
Client API limit and the MCP limit.

Client API request logs carry `clientSession` (the `cls_…` id) and `client` (for example `alice-cli/0.2.0`) so
support can trace a device. Credentials are never logged. Issuance, refresh and revocation are logged as
`client_session.issued`, `client_session.refreshed` and `client_session.revoked`.
