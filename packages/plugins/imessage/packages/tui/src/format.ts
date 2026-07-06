import type { Attachment, Conversation, Message } from "./api.ts";

export function searchHaystack(conversation: Conversation): string {
  return [
    conversation.name,
    conversation.identifier,
    ...conversation.participants,
    ...conversation.memberNames,
  ]
    .join(" ")
    .toLowerCase();
}

// Same scoring as the web app: subsequence match, rewarding runs + word starts.
export function fuzzyScore(query: string, text: string): number {
  let qi = 0;
  let score = 0;
  let run = 0;
  let prev = -2;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] !== query[qi]) continue;
    run = prev === ti - 1 ? run + 1 : 0;
    const wordStart = ti === 0 || text[ti - 1] === " " || text[ti - 1] === "+";
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    prev = ti;
    qi++;
  }

  return qi === query.length ? score : -1;
}

export function filterConversations(
  conversations: Conversation[],
  query: string,
): Conversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations
    .map((conversation) => ({
      conversation,
      score: fuzzyScore(q, searchHaystack(conversation)),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.conversation);
}

export function bodyText(msg: Message): string {
  // U+FFFC marks inline attachments in the raw text.
  return msg.text.replace(/￼/g, "").trim();
}

export function senderLabel(msg: Message): string {
  return msg.senderName ?? msg.sender;
}

export function attachmentLabel(att: Attachment): string {
  const icon =
    att.kind === "image" ? "🖼" : att.kind === "video" ? "🎞" : att.kind === "audio" ? "🎤" : "📎";
  return `${icon} ${att.name || att.mime}`;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function shortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const age = now.getTime() - date.getTime();
  if (age < 7 * DAY_MS) return WEEKDAYS[date.getDay()]!;
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear() % 100).padStart(2, "0")}`;
}

export function messageStamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
