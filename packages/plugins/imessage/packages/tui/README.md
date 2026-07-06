# imessage tui

Terminal client for the iMessage web API (`web/server.ts`), built with
[OpenTUI](https://github.com/anomalyco/opentui) + SolidJS.

```
┌ search ────────┐┌ conversation ──────────────────────────┐
│ conversations  ││ messages (sticky-bottom scroll)        │
│ …              │├────────────────────────────────────────┤
│                ││ composer                               │
└────────────────┘└────────────────────────────────────────┘
 footer: hints · connection status
```

## Run

Against the real server (start it first: `bun run --cwd ../web server`):

```sh
bun run tui
```

### Pointing at a remote server (e.g. over Tailscale)

Server base URL precedence: `--url` flag > `IMSG_TUI_URL` env > steve config >
`http://127.0.0.1:8787`.

Persistent config lives in `~/.config/steve/steve.json`:

```json
{ "plugins": { "imessage": { "url": "miles", "port": 8787 } } }
```

`url` is a bare hostname (MagicDNS names work: `miles`) or a full base URL
(`https://miles.tail1234.ts.net` for Tailscale serve — no port appended when
the URL carries a scheme). A bare hostname without `port` assumes 8787.

One-off override:

```sh
bun run tui --url http://miles:8787
```

The server's Host guard already trusts `.ts.net` names and CGNAT (100.64/10)
addresses, and non-browser clients send no Origin header — so no server
changes are needed; just make the API reachable (Tailscale serve on the Mac,
or bind it to the tailnet with `IMSG_WEB_HOST`).

## Keys

- `tab` / `shift-tab` — cycle focus: search → sidebar → messages → composer
- `j` / `k` (or arrows) — move selection (sidebar) / scroll (messages)
- `enter` — open selected conversation and focus the composer; in the
  composer, send (`ctrl-j` inserts a newline)
- `ctrl-d` / `ctrl-u` — half-page scroll; `g` / `G` — top (loads older
  history) / bottom
- `/` — jump to search; `escape` — back out (clears search)
- `q` — quit (sidebar/messages)

## Dev loop

`tools/dev-server.ts` is a mock of the real API (same routes and DTOs, fake
data, no chat.db access, no real sends) that emits a live SSE message every
5s:

```sh
bun run dev-server   # mock API on :8788
bun run dev          # TUI pointed at the mock
```

Automated checks render the app off-screen against the mock server and
assert on captured frames (`test/app.test.tsx`):

```sh
bun test
```

To eyeball it while developing, run it in tmux and capture frames:

```sh
tmux new -d -s imtui 'bun run dev'
tmux capture-pane -p -t imtui   # print the current frame
```

## Notes

- Live updates come from `GET /api/events` (SSE) with `Last-Event-ID` resume;
  reconnects re-baseline the conversation list.
- Sends use the JSON path only (no image upload). A `201` swaps the
  optimistic bubble by id; a `202` leaves it until the SSE echo lands.
- Browsing with `j`/`k` previews a conversation without marking it read;
  read receipts fire when you enter it (`enter`, or tab into messages/composer).
