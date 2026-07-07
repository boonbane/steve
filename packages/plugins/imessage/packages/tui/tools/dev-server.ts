// Mock of web/server.ts for TUI development and tests: same routes and DTO
// shapes, fake data, no chat.db or Messages.app side effects. SSE emits a
// message on an interval so live updates can be exercised safely.
import type { Conversation, Message } from "../src/api.ts";

const now = Date.now();
const MINUTE = 60_000;

const LOREM = [
  "Uncle John's Band",
  "Truckin'",
  "Sugar Magnolia",
  "Casey Jones",
  "Friend of the Devil",
  "Ripple",
  "Box of Rain",
  "Touch of Grey",
];

const conversations: Conversation[] = [
  conv("d:+15551230001", "Jerry Garcia", { unread: 2, at: now - 2 * MINUTE }),
  conv("g:GROUP-1", "Truckin'", {
    isGroup: true,
    members: ["Jerry Garcia", "Bill Kreutzmann"],
    at: now - 30 * MINUTE,
  }),
  conv("d:+15551230002", "Bob Weir", { at: now - 3 * 60 * MINUTE }),
  conv("d:+15551230003", "Phil Lesh", { at: now - 26 * 60 * MINUTE }),
  conv("d:87654", "87654", { resolved: false, at: now - 50 * 60 * MINUTE }),
  ...Array.from({ length: 40 }, (_, i) =>
    conv(`d:+1555200${String(i).padStart(4, "0")}`, `Contact ${i + 1}`, {
      at: now - (i + 3) * 24 * 60 * MINUTE,
    }),
  ),
];

let nextId = 100_000;
const threads = new Map<string, Message[]>();
for (const conversation of conversations) {
  threads.set(conversation.id, seedThread(conversation));
}

type Client = { controller: ReadableStreamDefaultController<Uint8Array>; };
const clients = new Set<Client>();
const encoder = new TextEncoder();

function broadcast(event: string, data: unknown, id?: number) {
  const payload =
    (id != null ? `id: ${id}\n` : "") +
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.controller.enqueue(encoder.encode(payload));
    } catch {
      clients.delete(client);
    }
  }
}

function conv(
  id: string,
  name: string,
  opts: {
    isGroup?: boolean;
    members?: string[];
    resolved?: boolean;
    unread?: number;
    at: number;
  },
): Conversation {
  return {
    id,
    identifier: id.slice(2),
    name,
    isGroup: opts.isGroup ?? false,
    resolved: opts.resolved ?? true,
    participants: [id.slice(2)],
    memberNames: opts.members ?? [],
    service: "iMessage",
    lastMessageAt: new Date(opts.at).toISOString(),
    unread: opts.unread ?? 0,
  };
}

function seedThread(conversation: Conversation): Message[] {
  const base = new Date(conversation.lastMessageAt).getTime();
  const count = 120;
  return Array.from({ length: count }, (_, i) => {
    const isFromMe = i % 3 === 2;
    return {
      id: nextId++,
      conversationId: conversation.id,
      sender: isFromMe ? "me" : conversation.participants[0]!,
      senderName: isFromMe ? null : conversation.name,
      text: `${LOREM[i % LOREM.length]!} (#${i + 1})`,
      createdAt: new Date(base - (count - i) * 7 * MINUTE).toISOString(),
      isFromMe,
      service: "iMessage",
      attachments:
        i % 17 === 0
          ? [{ id: i, messageId: nextId, mime: "image/jpeg", name: "IMG_0042.jpg", kind: "image" as const }]
          : [],
    };
  });
}

// A real 12×8 gradient PNG so the inline-image path can be exercised without
// chat.db: valid signature, parseable IHDR dimensions, decodable pixels.
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAAtUlEQVR4nA3KMQ1AIQxAwbrAADMuSCoCC52QwYQFNLw0wQUzBpDR/28+ESEJRahCE7owhCVs4QhPCEEkkzIlUzMt0zMjszI7czIvE/lPSlKKUpWmdGUoS9nKUZ4S+icjGcWoRjO6MYxlbOMYzwj70yRNyqRO2qRPxmRN9uRM3iTmn5zkFKc6zenOcJazneM8J/xPl3Qpl3ppl34Zl3XZl3N5l7h/ClJQghq0oAcjWMEOTvCCCD5/rKLV2NZS/wAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function startDevServer(port = 0, { chatter = true } = {}) {
  const server = Bun.serve({
    port,
    idleTimeout: 255,
    routes: {
      "/api/conversations": () => json(conversations),
      "/api/conversations/:id": (req: Bun.BunRequest<"/api/conversations/:id">) => {
        const conversation = find(req.params.id);
        return conversation ? json(conversation) : json({ error: "conversation not found" }, 404);
      },
      "/api/conversations/:id/messages": {
        GET: (req: Bun.BunRequest<"/api/conversations/:id/messages">) => {
          const conversation = find(req.params.id);
          if (!conversation) return json({ error: "conversation not found" }, 404);
          const url = new URL(req.url);
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
          const before = url.searchParams.get("before");
          const all = threads.get(conversation.id)!;
          const end = before != null ? all.findIndex((m) => m.id === Number(before)) : all.length;
          const slice = all.slice(Math.max(0, end - limit), Math.max(0, end));
          return json(slice);
        },
        POST: async (req: Bun.BunRequest<"/api/conversations/:id/messages">) => {
          const conversation = find(req.params.id);
          if (!conversation) return json({ error: "conversation not found" }, 404);

          let text = "";
          let image: File | null = null;
          if (req.headers.get("content-type")?.includes("multipart/form-data")) {
            const form = await req.formData();
            const rawText = form.get("text");
            text = typeof rawText === "string" ? rawText.trim() : "";
            const file = form.get("image");
            if (file instanceof File && file.size > 0) image = file;
          } else {
            const body = (await req.json()) as { text?: string };
            text = body.text?.trim() ?? "";
          }
          if (!text && !image) return json({ error: "text or image required" }, 400);

          // Mirror the real server: image rows can't be correlated by text, so
          // reply 202 and deliver over SSE — the file row first, then the caption.
          if (image) {
            const fileMsg = appendMessage(conversation.id, "￼", true);
            fileMsg.attachments = [
              { id: fileMsg.id, messageId: fileMsg.id, mime: image.type, name: image.name, kind: "image" },
            ];
            const caption = text ? appendMessage(conversation.id, text, true) : null;
            setTimeout(() => {
              broadcast("message.received", fileMsg, fileMsg.id);
              if (caption) broadcast("message.received", caption, caption.id);
            }, 300);
            return json({ status: "accepted" }, 202);
          }

          const message = appendMessage(conversation.id, text, true);
          // Exercise both reply paths: even ids land as 201, odd ids as 202+SSE.
          if (message.id % 2 === 0) return json(message, 201);
          setTimeout(() => broadcast("message.received", message, message.id), 300);
          return json({ status: "accepted" }, 202);
        },
      },
      "/api/conversations/:id/read": {
        POST: (req: Bun.BunRequest<"/api/conversations/:id/read">) => {
          const conversation = find(req.params.id);
          if (!conversation) return json({ error: "conversation not found" }, 404);
          conversation.unread = 0;
          setTimeout(
            () => broadcast("conversation.unread", { conversationId: conversation.id, unread: 0 }),
            100,
          );
          return json({ status: "accepted" }, 202);
        },
      },
      "/api/attachments/:id": () =>
        new Response(TINY_PNG, { headers: { "content-type": "image/png" } }),
      "/api/conversations/:id/avatar": (
        req: Bun.BunRequest<"/api/conversations/:id/avatar">,
      ) => {
        const conversation = find(req.params.id);
        if (!conversation || conversation.isGroup) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(TINY_PNG, { headers: { "content-type": "image/png" } });
      },
      "/api/events": (req: Request) => {
        let client: Client;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            client = { controller };
            clients.add(client);
            controller.enqueue(encoder.encode(`event: ready\ndata: {"status":"ok"}\n\n`));
          },
          cancel() {
            clients.delete(client);
          },
        });
        req.signal.addEventListener("abort", () => clients.delete(client));
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });

  let timer: Timer | null = null;
  if (chatter) {
    let i = 0;
    timer = setInterval(() => {
      const conversation = conversations[i++ % 3]!;
      const message = appendMessage(
        conversation.id,
        `live message ${i} — ${LOREM[i % LOREM.length]!}`,
        false,
      );
      conversation.unread += 1;
      broadcast("message.received", message, message.id);
      broadcast("conversation.unread", {
        conversationId: conversation.id,
        unread: conversation.unread,
      });
    }, 5000);
  }

  return {
    url: `http://127.0.0.1:${server.port}`,
    appendMessage,
    broadcast,
    conversations,
    stop() {
      if (timer) clearInterval(timer);
      server.stop(true);
    },
  };
}

function find(raw: string): Conversation | undefined {
  const id = decodeURIComponent(raw);
  return conversations.find((c) => c.id === id);
}

function appendMessage(conversationId: string, text: string, isFromMe: boolean): Message {
  const conversation = conversations.find((c) => c.id === conversationId)!;
  const message: Message = {
    id: nextId++,
    conversationId,
    sender: isFromMe ? "me" : conversation.participants[0]!,
    senderName: isFromMe ? null : conversation.name,
    text,
    createdAt: new Date().toISOString(),
    isFromMe,
    service: "iMessage",
    attachments: [],
  };
  threads.get(conversationId)!.push(message);
  conversation.lastMessageAt = message.createdAt;
  return message;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8788);
  const dev = startDevServer(port);
  console.log(`mock iMessage API on ${dev.url}`);
}
