import { spawnSync } from "node:child_process";
import fs from "fs";
import path from "path";
import {
  Client,
  type Conversation,
  type Message,
  type Attachment,
} from "steve-plugin-imessage-core";
import consola from "consola";

import { Names } from "./names.ts";

const PORT = 8787;
const client = Client();

const MESSAGES_ROOT = path.join(process.env.HOME ?? "", "Library", "Messages");
const CONVERT_DIR = path.join(import.meta.dir, ".cache", "att");

// How long to wait for a sent message to land in chat.db before giving up and
// letting it arrive over the event stream instead (25 × 120ms ≈ 3s).
const SEND_POLL_ATTEMPTS = 25;
const SEND_POLL_INTERVAL_MS = 120;

// Sends to one conversation are serialized: correlating a send to its written
// row works by "first outgoing row after this ROWID matching this text", so two
// in-flight sends of the *same* text must not share a starting cursor — chain
// them per conversation so each captures the previous send's row.
const sendChains = new Map<number, Promise<unknown>>();
function serializeSend<T>(key: number, task: () => Promise<T>): Promise<T> {
  const prev = sendChains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  sendChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

// The wire shape of a conversation. Deliberately omits the underlying Apple
// chat-row ids (`chatIds`/`sendChatId`): the whole point of the Conversation
// abstraction is that consumers address a conversation by its stable `id` and
// never touch transport rows.
type ConversationDTO = {
  id: string;
  identifier: string;
  name: string;
  isGroup: boolean;
  // Whether the conversation maps to a known contact: a 1:1 whose handle is in
  // Contacts, or a group with at least one member in Contacts. Lets the client
  // hide unknown numbers. (A group's own display name does NOT count — spammers
  // set junk group names.)
  resolved: boolean;
  participants: string[];
  memberNames: string[];
  service: string;
  lastMessageAt: Date;
  // Count of received-but-unread messages, so the client can badge the row.
  unread: number;
};

// The wire shape of a message. Carries the stable `conversationId` (not the
// transport `chatId`) so a consumer can map any message — live or historical —
// back to a conversation without re-deriving the merge.
type MessageDTO = {
  id: number;
  conversationId: string;
  sender: string;
  senderName: string | null;
  text: string;
  createdAt: Date;
  isFromMe: boolean;
  service: string;
  attachments: Attachment[];
};

// Bodies smaller than this aren't worth the gzip CPU (and can come out larger
// than the original once you add the gzip framing).
const GZIP_MIN_BYTES = 1024;

// Gzip the JSON when the client advertises support and the body is big enough to
// pay for it; otherwise send it plain. The conversation list alone is ~184KB raw
// and ~35KB gzipped, so this is the difference that matters. SSE doesn't route
// through here, so the live stream is untouched.
function json(data: unknown, status = 200, req?: Request): Response {
  const body = new TextEncoder().encode(JSON.stringify(data));
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const acceptsGzip = (req?.headers.get("accept-encoding") ?? "")
    .toLowerCase()
    .includes("gzip");
  if (acceptsGzip && body.byteLength >= GZIP_MIN_BYTES) {
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
    return new Response(Bun.gzipSync(body), { status, headers });
  }

  return new Response(body, { status, headers });
}

// Resolve a display name for each conversation: a group keeps its own name if
// it has one, otherwise it becomes the member-name list; a 1:1 resolves to the
// contact name. Also surfaces resolved member names for the group header.
function enrichConversations(conversations: Conversation[]): ConversationDTO[] {
  const handles = conversations.flatMap((conversation) =>
    conversation.isGroup ? conversation.participants : [conversation.identifier],
  );
  const names = Names.resolve(handles);
  const unread = client.unread();

  return conversations.map((conversation) => {
    const memberNames = conversation.isGroup
      ? conversation.participants.map(
          (handle) => Names.label(handle, names) ?? handle,
        )
      : [];
    const name = conversation.isGroup
      ? conversation.name || memberNames.join(", ")
      : Names.label(conversation.identifier, names) ||
        conversation.name ||
        conversation.identifier;

    // A group is resolved only if a member is a known contact (its own name is
    // not trusted — spam groups set junk names); a 1:1 if its handle resolves
    // (a user-assigned display name is rare for 1:1s but counts).
    const resolved = conversation.isGroup
      ? conversation.participants.some(
          (handle) => Names.label(handle, names) != null,
        )
      : Names.label(conversation.identifier, names) != null ||
        conversation.name.length > 0;

    return {
      id: conversation.id,
      identifier: conversation.identifier,
      name,
      isGroup: conversation.isGroup,
      resolved,
      participants: conversation.participants,
      memberNames,
      service: conversation.service,
      lastMessageAt: conversation.lastMessageAt,
      unread: unread.get(conversation.id) ?? 0,
    };
  });
}

// Attach the resolved sender name, the owning conversation id, and any
// image/file attachments to each message.
function enrichMessages(
  messages: Message[],
  conversationId: string,
): MessageDTO[] {
  const names = Names.resolve(messages.map((message) => message.sender));
  const byMessage = new Map<number, Attachment[]>();
  for (const attachment of client.attachments(messages.map((m) => m.id))) {
    const list = byMessage.get(attachment.messageId) ?? [];
    list.push(attachment);
    byMessage.set(attachment.messageId, list);
  }

  return messages.map((message) => ({
    id: message.id,
    conversationId,
    sender: message.sender,
    senderName: Names.label(message.sender, names),
    text: message.text,
    createdAt: message.createdAt,
    isFromMe: message.isFromMe,
    service: message.service,
    attachments: byMessage.get(message.id) ?? [],
  }));
}

// HEIC/HEIF can't render in browsers; convert to JPEG with sips and cache it.
function heicToJpeg(src: string, id: number): string | null {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const out = path.join(CONVERT_DIR, `${id}.jpg`);
  if (fs.existsSync(out)) return out;

  const result = spawnSync(
    "/usr/bin/sips",
    ["-s", "format", "jpeg", src, "--out", out],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !fs.existsSync(out)) return null;
  return out;
}

function serveAttachment(id: number): Response {
  const filePath = client.attachmentPath(id);
  if (!filePath) return new Response("Not found", { status: 404 });

  // Only ever read from within the Messages library (trailing separator so a
  // sibling like `Messages-other` can't satisfy the prefix).
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(MESSAGES_ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(resolved)) {
    return new Response("Not found", { status: 404 });
  }

  const cache = { "cache-control": "max-age=86400" };
  const ext = path.extname(resolved).toLowerCase();

  if (ext === ".heic" || ext === ".heif") {
    const jpeg = heicToJpeg(resolved, id);
    if (!jpeg) return new Response("Conversion failed", { status: 500 });
    return new Response(Bun.file(jpeg), {
      headers: { ...cache, "content-type": "image/jpeg" },
    });
  }

  return new Response(Bun.file(resolved), { headers: cache });
}

function serveAvatar(rawId: string): Response {
  const conversation = client.conversation(decodeURIComponent(rawId));
  if (!conversation || conversation.isGroup) {
    return new Response("Not found", { status: 404 });
  }

  const image = Names.avatar(conversation.identifier);
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image, {
    headers: { "content-type": "image/jpeg", "cache-control": "max-age=86400" },
  });
}

function listConversations(req: Request): Response {
  return json(enrichConversations(client.conversations()), 200, req);
}

// GET /api/conversations/:id — a single conversation by its stable id.
function getConversation(rawId: string): Response {
  const conversation = client.conversation(decodeURIComponent(rawId));
  if (!conversation) {
    return json({ error: "conversation not found" }, 404);
  }
  return json(enrichConversations([conversation])[0]);
}

// GET /api/conversations/:id/messages?limit=50&before=<message id>
// One page of history for a conversation, oldest message first. `before` is a
// message id (an opaque pagination cursor); pass the oldest id you hold to get
// the previous page.
function getMessages(
  rawId: string,
  params: URLSearchParams,
  req: Request,
): Response {
  const conversation = client.conversation(decodeURIComponent(rawId));
  if (!conversation) {
    return json({ error: "conversation not found" }, 404);
  }

  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  const beforeRaw = params.get("before");
  const before = beforeRaw == null ? undefined : Number(beforeRaw);
  // historyAcross returns newest-first; flip to chronological for display.
  const page = client
    .historyAcross(conversation.chatIds, limit, before)
    .reverse();
  return json(enrichMessages(page, conversation.id), 200, req);
}

// POST /api/conversations/:id/messages  { text }
// Sends via Messages.app, then waits for the row to land so it can return the
// created message (201) with its real id. The client replaces its optimistic
// bubble by that id — no text matching. If the row hasn't appeared within the
// poll window, returns 202; the message will still arrive over /api/events.
async function postMessage(rawId: string, req: Request): Promise<Response> {
  const id = decodeURIComponent(rawId);
  const conversation = client.conversation(id);
  if (!conversation) {
    return json({ error: "conversation not found" }, 404);
  }

  const body = (await req.json().catch(() => null)) as {
    text?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length === 0) {
    return json({ error: "text required" }, 400);
  }

  return serializeSend(conversation.sendChatId, async () => {
    const before = client.latestRowId();
    try {
      client.send(conversation.sendChatId, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "send failed";
      consola.error(`send to ${id} failed:`, message);
      return json({ error: message }, 500);
    }

    for (let attempt = 0; attempt < SEND_POLL_ATTEMPTS; attempt++) {
      await Bun.sleep(SEND_POLL_INTERVAL_MS);
      const landed = client.sent(conversation.chatIds, before, text);
      if (landed) {
        return json(enrichMessages([landed], conversation.id)[0], 201);
      }
    }

    return json({ status: "accepted" }, 202);
  });
}

// POST /api/conversations/:id/read
// Mark the conversation read by driving Messages on the host (the DB is
// read-only, so this is the only way to persist a read). Fire-and-forget: the
// client doesn't wait — once Messages writes is_read back to chat.db, the
// unread-diff watcher broadcasts the cleared count over /api/events on its own.
function postRead(rawId: string): Response {
  const conversation = client.conversation(decodeURIComponent(rawId));
  if (!conversation) {
    return json({ error: "conversation not found" }, 404);
  }

  client.markRead(conversation).catch((err) => {
    const message = err instanceof Error ? err.message : "mark read failed";
    consola.error(`markRead ${conversation.id} failed:`, message);
  });

  return json({ status: "accepted" }, 202);
}

// GET /api/events — live stream of messages as Server-Sent Events. Each event
// carries an `id:` (the message ROWID); on reconnect the browser sends it back
// as `Last-Event-ID` and we replay the gap before resuming the live tail, so a
// sleep or network blip never silently drops messages.
function events(req: Request): Response {
  const encoder = new TextEncoder();
  const url = new URL(req.url);
  const lastEventId =
    req.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
  const resumeFrom = lastEventId == null ? NaN : Number(lastEventId);
  const hasCursor = Number.isFinite(resumeFrom) && resumeFrom > 0;

  let unsubscribe: (() => void) | null = null;
  let unsubscribeUnread: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        unsubscribeUnread?.();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const sendEvent = (event: string, data: string, id?: number) => {
        const idLine = id == null ? "" : `id: ${id}\n`;
        write(`${idLine}event: ${event}\ndata: ${data}\n\n`);
      };

      sendEvent("ready", JSON.stringify({ status: "ok" }));

      // `high` is the greatest message id already delivered on this connection;
      // it dedups the overlap between the replayed backlog and the live tail.
      let high = hasCursor ? resumeFrom : 0;

      const flush = (message: Message) => {
        if (message.id <= high) return;
        try {
          const conversation = client.conversationByChat(message.chatId);
          const [dto] = enrichMessages([message], conversation?.id ?? "");
          sendEvent("message.received", JSON.stringify(dto), message.id);
          // Advance only after a successful send, so a failed enrich/write
          // leaves the watermark untouched: the browser reconnects with its
          // last delivered id and the message is replayed, never silently lost.
          high = message.id;
        } catch {
          cleanup();
        }
      };

      // Subscribe to the live tail first, then replay the backlog from the
      // resume point. `subscribe()` pins core's tail cursor at the current
      // newest ROWID, so the union of (replay ≤ now) and (live > now) covers
      // every id with no gap. start() runs synchronously, so no live message is
      // delivered until replay finishes; the `high` watermark dedups the seam.
      unsubscribe = client.subscribe(flush);

      // Forward unread-count changes (new messages raise a count; a read synced
      // from another device lowers it, possibly to zero). These carry no `id:`
      // and aren't part of the message resume cursor — the client's initial
      // conversation fetch is the cold-start baseline; these keep it live.
      unsubscribeUnread = client.subscribeUnread((changes) => {
        for (const change of changes) {
          sendEvent("conversation.unread", JSON.stringify(change));
        }
      });

      if (hasCursor) {
        let from = resumeFrom;
        while (true) {
          const batch = client.after(from, 100);
          if (batch.length === 0) break;
          for (const message of batch) flush(message);
          from = batch[batch.length - 1].id;
          if (batch.length < 100) break;
        }
      }

      heartbeat = setInterval(() => sendEvent("heartbeat", "ok"), 5000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      unsubscribeUnread?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function main(): void {
  // idleTimeout is raised so long-lived SSE connections aren't dropped; the
  // heartbeat keeps data flowing well within the window.
  Bun.serve({
    port: PORT,
    idleTimeout: 255,
    routes: {
      "/api/conversations": {
        GET: (req) => listConversations(req),
      },
      "/api/conversations/:id": {
        GET: (req) => getConversation(req.params.id),
      },
      "/api/conversations/:id/messages": {
        GET: (req) =>
          getMessages(req.params.id, new URL(req.url).searchParams, req),
        POST: (req) => postMessage(req.params.id, req),
      },
      "/api/conversations/:id/read": {
        POST: (req) => postRead(req.params.id),
      },
      "/api/conversations/:id/avatar": {
        GET: (req) => serveAvatar(req.params.id),
      },
      "/api/events": {
        GET: (req) => events(req),
      },
      "/api/attachments/:id": {
        GET: (req) => serveAttachment(Number(req.params.id)),
      },
    },
    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });
  consola.success(`iMessage web API on http://localhost:${PORT}`);
}

main();
