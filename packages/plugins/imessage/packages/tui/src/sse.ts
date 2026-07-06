import type { Message } from "./api.ts";

export type ServerEvent =
  | { type: "ready" }
  | { type: "message.received"; message: Message }
  | { type: "conversation.unread"; conversationId: string; unread: number };

export type EventHandlers = {
  onEvent: (event: ServerEvent) => void;
  onStatus?: (status: "connecting" | "open" | "closed") => void;
};

// Minimal SSE client over fetch streaming. Bun has no EventSource with custom
// headers, and we need Last-Event-ID on reconnect for the server's gap replay.
export function subscribeEvents(
  baseUrl: string,
  handlers: EventHandlers,
): () => void {
  const controller = new AbortController();
  let lastEventId: string | null = null;
  let closed = false;

  const run = async () => {
    let delay = 1000;
    while (!closed) {
      handlers.onStatus?.("connecting");
      try {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (lastEventId != null) headers["last-event-id"] = lastEventId;
        const res = await fetch(`${baseUrl}/api/events`, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        handlers.onStatus?.("open");
        delay = 1000;
        await consume(res.body, (frame) => {
          if (frame.id != null) lastEventId = frame.id;
          const event = decode(frame);
          if (event) handlers.onEvent(event);
        });
      } catch {
        // fall through to reconnect
      }
      if (closed) break;
      handlers.onStatus?.("closed");
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void run();

  return () => {
    closed = true;
    controller.abort();
  };
}

type Frame = { event: string; data: string; id: string | null };

function decode(frame: Frame): ServerEvent | null {
  switch (frame.event) {
    case "ready":
      return { type: "ready" };
    case "message.received":
      try {
        return { type: "message.received", message: JSON.parse(frame.data) };
      } catch {
        return null;
      }
    case "conversation.unread":
      try {
        const parsed = JSON.parse(frame.data) as {
          conversationId: string;
          unread: number;
        };
        return { type: "conversation.unread", ...parsed };
      } catch {
        return null;
      }
    default:
      return null; // heartbeat and anything unknown
  }
}

async function consume(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: Frame) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame: Frame = { event: "message", data: "", id: null };

  const flushFrame = () => {
    if (frame.data !== "" || frame.event !== "message" || frame.id != null) {
      // Trailing newline is part of the SSE data framing, not the payload.
      onFrame({ ...frame, data: frame.data.replace(/\n$/, "") });
    }
    frame = { event: "message", data: "", id: null };
  };

  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") {
        flushFrame();
      } else if (line.startsWith("event:")) {
        frame.event = line.slice(6).trimStart();
      } else if (line.startsWith("data:")) {
        frame.data += line.slice(5).trimStart() + "\n";
      } else if (line.startsWith("id:")) {
        frame.id = line.slice(3).trimStart();
      }
      // comments (":heartbeat") and unknown fields are ignored
    }
  }
}
