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

// Returns up to PAGE_SIZE messages (chronological, oldest first) for a
// conversation. Pass `before` (a message id) to fetch the previous page.
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

// Sends via Messages.app on the host and resolves to the created message once
// it lands in the database, so the caller can swap its optimistic bubble for
// the real one by id. Resolves to `null` if the send was accepted but hasn't
// been recorded yet — it will arrive over the event stream.
export async function sendMessage(
  conversationId: string,
  text: string,
): Promise<Message | null> {
  const res = await fetch(`${conversationPath(conversationId)}/messages`, {
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
