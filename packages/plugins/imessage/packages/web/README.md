# iMessage Web

A web frontend for your local iMessage history, and the generic HTTP API behind
it. It reuses `steve-plugin-imessage-core` to read `~/Library/Messages/chat.db`
and renders a two-pane chat UI (conversation list + message thread) styled with
`@steve/ui`. It can also send: the composer hands messages to Messages.app on
the host.

## API

Everything is addressed by a conversation's stable `id` — the per-transport
Apple chat rows (SMS/RCS/iMessage) are collapsed server-side and never cross the
wire.

- `GET /api/conversations` — every conversation, newest first (metadata only).
- `GET /api/conversations/:id` — a single conversation.
- `GET /api/conversations/:id/messages?limit=50&before=<id>` — one page of
  history, oldest first; `before` is a message id used as the page cursor.
- `POST /api/conversations/:id/messages` `{ text }` — send. Returns the created
  message (201) once it lands in the database, or 202 if it hasn't yet (it will
  arrive over the event stream).
- `GET /api/events` — Server-Sent Events. Each `message.received` event carries
  an `id:` (the message ROWID); on reconnect the browser's `Last-Event-ID` is
  replayed so a sleep or network blip never drops messages.
- `GET /api/attachments/:id` — streams an attachment (HEIC → JPEG on the fly).

## Run

Two processes: a Bun API that reads the SQLite db, and a Vite dev server for the
UI (which proxies `/api` to the backend).

```bash
# terminal 1 — API on :8787
bun run server

# terminal 2 — UI on :3001
bun run dev
```

Then open http://localhost:3001.

> Reading `chat.db` and sending requires the terminal/process to have **Full
> Disk Access** and **Automation → Messages** permission (System Settings →
> Privacy & Security).

## Layout

- `server.ts` — Bun HTTP API (conversation-addressed; see above).
- `names.ts` — resolves handles to contact names via the Contacts FFI.
- `src/api.ts` — typed fetch helpers.
- `src/app.tsx` — Solid UI: chat list, message thread, sent/received bubbles.
- `src/app.css` — component styles using `@steve/ui` design tokens.
