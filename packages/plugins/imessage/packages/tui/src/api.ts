// Wire types mirrored from web/server.ts DTOs (Dates arrive as ISO strings).
export type Conversation = {
  id: string;
  identifier: string;
  name: string;
  isGroup: boolean;
  resolved: boolean;
  participants: string[];
  memberNames: string[];
  service: string;
  lastMessageAt: string;
  unread: number;
};

export type Attachment = {
  id: number;
  messageId: number;
  mime: string;
  name: string;
  kind: "image" | "video" | "audio" | "other";
};

export type Message = {
  id: number;
  conversationId: string;
  sender: string;
  senderName: string | null;
  text: string;
  createdAt: string;
  isFromMe: boolean;
  service: string;
  attachments: Attachment[];
};

export type OutgoingImage = { data: Uint8Array; mime: string; name: string };

export const PAGE_SIZE = 50;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_BASE_URL =
  process.env.IMSG_TUI_URL ?? `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

// Combine a configured host (bare hostname like "miles", or a full URL) with
// an optional port. An explicit port in the url wins over the port field.
export function baseUrlFrom(url?: string, port?: number): string {
  if (!url && port == null) return DEFAULT_BASE_URL;
  const withScheme = url
    ? url.includes("://")
      ? url
      : `http://${url}`
    : `http://${DEFAULT_HOST}`;
  const parsed = new URL(withScheme);
  if (parsed.port === "" && port != null) parsed.port = String(port);
  else if (parsed.port === "" && !url?.includes("://")) parsed.port = String(DEFAULT_PORT);
  return parsed.origin;
}

export type Api = ReturnType<typeof createApi>;

export function createApi(baseUrl: string = DEFAULT_BASE_URL) {
  const base = baseUrl.replace(/\/$/, "");
  const conversationPath = (id: string) =>
    `${base}/api/conversations/${encodeURIComponent(id)}`;

  return {
    baseUrl: base,

    async conversations(): Promise<Conversation[]> {
      const res = await fetch(`${base}/api/conversations`);
      if (!res.ok) throw new Error(`conversations ${res.status}`);
      return res.json();
    },

    async messages(conversationId: string, before?: number): Promise<Message[]> {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before != null) params.set("before", String(before));
      const res = await fetch(`${conversationPath(conversationId)}/messages?${params}`);
      if (!res.ok) throw new Error(`messages ${res.status}`);
      return res.json();
    },

    // 201 returns the landed message; 202 means it will arrive over SSE — null.
    // Image sends always take the multipart path and always resolve 202.
    async send(
      conversationId: string,
      text: string,
      image?: OutgoingImage,
    ): Promise<Message | null> {
      let init: RequestInit;
      if (image) {
        const form = new FormData();
        form.set("text", text);
        form.set("image", new File([image.data as BlobPart], image.name, { type: image.mime }));
        init = { method: "POST", body: form };
      } else {
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        };
      }
      const res = await fetch(`${conversationPath(conversationId)}/messages`, init);
      if (res.status === 202) return null;
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `send ${res.status}`);
      }
      return res.json();
    },

    // Downscaled PNG of an image attachment, sized for inline terminal
    // rendering. The server converts whatever the source format is.
    async attachmentThumb(id: number, maxpx: number): Promise<Uint8Array> {
      const res = await fetch(`${base}/api/attachments/${id}?thumb=${maxpx}`);
      if (!res.ok) throw new Error(`attachment ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    // Contact photo as PNG for a 1:1 conversation; 404s for groups and
    // contacts without a photo.
    async avatarThumb(conversationId: string, maxpx: number): Promise<Uint8Array> {
      const res = await fetch(
        `${conversationPath(conversationId)}/avatar?thumb=${maxpx}`,
      );
      if (!res.ok) throw new Error(`avatar ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async markRead(conversationId: string): Promise<void> {
      try {
        await fetch(`${conversationPath(conversationId)}/read`, { method: "POST" });
      } catch {
        // Badge is already cleared locally; nothing to recover.
      }
    },
  };
}
