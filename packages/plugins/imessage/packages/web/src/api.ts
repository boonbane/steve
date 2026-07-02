// One person/group, collapsed across the separate SMS/RCS/iMessage chat rows.
// Addressed only by its stable `id`; the underlying Apple chat rows never cross
// the wire.
export type Conversation = {
  id: string;
  identifier: string;
  name: string;
  isGroup: boolean;
  // A 1:1 whose handle is a known contact, or a group with a known member.
  // False means no contact identity (a bare number or an unsaved email).
  resolved: boolean;
  participants: string[];
  memberNames: string[];
  service: string;
  lastMessageAt: string;
  // Received-but-unread message count. The UI badges any row with unread > 0;
  // it's cleared client-side on open (the DB is read-only, so we can't mark it
  // read upstream) and incremented live as messages arrive for other rows.
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

function conversationPath(id: string): string {
  return `/api/conversations/${encodeURIComponent(id)}`;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  return res.json();
}

export const PAGE_SIZE = 50;

export async function fetchMessages(
  conversationId: string,
  before?: number,
): Promise<Message[]> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before != null) params.set("before", String(before));
  const res = await fetch(`${conversationPath(conversationId)}/messages?${params}`);
  if (!res.ok) throw new Error(`messages ${res.status}`);
  return res.json();
}

export async function markConversationRead(conversationId: string): Promise<void> {
  try {
    await fetch(`${conversationPath(conversationId)}/read`, { method: "POST" });
  } catch {
    // Ignore — the badge is already cleared locally; nothing to recover.
  }
}

// Send text, an image, or both. With an image we post multipart/form-data (and
// let the browser set the boundary); text-only stays JSON. A 202 (no body) means
// the message will arrive over the event stream — return null so the caller
// knows not to swap an optimistic bubble in by id.
export async function sendMessage(
  conversationId: string,
  text: string,
  image?: File | null,
): Promise<Message | null> {
  const url = `${conversationPath(conversationId)}/messages`;
  const res = image
    ? await fetch(url, { method: "POST", body: imageForm(text, image) })
    : await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
  if (res.status === 202) return null;
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `send ${res.status}`);
  }
  return res.json();
}

function imageForm(text: string, image: File): FormData {
  const form = new FormData();
  form.set("text", text);
  form.set("image", image, image.name || "image.png");
  return form;
}
