import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "fs";
import path from "path";
import { z } from "zod/v4";

const require = createRequire(import.meta.url);

const APPLE_EPOCH_MS = 978_307_200_000;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_BATCH_LIMIT = 100;
const SEND_TIMEOUT_MS = 20_000;

type Runner = (source: string, args: readonly string[]) => void;
type Subscriber = (message: Message) => void;

export type UnreadChange = { conversationId: string; unread: number };
type UnreadSubscriber = (changes: UnreadChange[]) => void;

type Asbridge = {
  exec: (source: string, args?: readonly string[]) => string;
};

const Runner = z.custom<Runner>((value) => typeof value === "function");

const ChatID = z.number().int().nonnegative();
const Text = z.string().trim().min(1);

const SendScript = `
on run argv
    set theRecipient to item 1 of argv
    set theMessage to item 2 of argv
    set theService to item 3 of argv
    set chatId to item 4 of argv
    set useChat to item 5 of argv

    tell application "Messages"
        if useChat is "1" then
            set targetChat to chat id chatId
            if theMessage is not "" then
                send theMessage to targetChat
            end if
        else
            if theService is "sms" then
                set targetService to first service whose service type is SMS
            else
                set targetService to first service whose service type is iMessage
            end if

            set targetBuddy to buddy theRecipient of targetService
            if theMessage is not "" then
                send theMessage to targetBuddy
            end if
        end if
    end tell
end run
`;

const MarkReadScript = `
on run argv
    set theHandle to item 1 of argv
    set theScheme to item 2 of argv
    tell application "Messages" to activate
    delay 0.4
    do shell script "open " & quoted form of (theScheme & ":" & theHandle)
    delay 0.9
    tell application "System Events"
        tell process "Messages"
            set didClick to false
            repeat with e in (entire contents of window 1)
                try
                    if role of e is "AXRow" then
                        if (value of attribute "AXSelected" of e) is true then
                            click e
                            set didClick to true
                            exit repeat
                        end if
                    end if
                end try
            end repeat
            if not didClick then error "no selected AXRow found in window 1"
        end tell
    end tell
    return "clicked"
end run
`;

export const Chat = z.object({
  id: z.number().int().nonnegative(),
  identifier: z.string(),
  name: z.string(),
  service: z.string(),
  lastMessageAt: z.date(),
});

export type Chat = z.infer<typeof Chat>;

export const Message = z.object({
  id: z.number().int().nonnegative(),
  chatId: z.number().int().nonnegative(),
  sender: z.string(),
  text: z.string(),
  createdAt: z.date(),
  isFromMe: z.boolean(),
  service: z.string(),
});

export type Message = z.infer<typeof Message>;

export const Attachment = z.object({
  id: z.number().int().nonnegative(),
  messageId: z.number().int().nonnegative(),
  mime: z.string(),
  name: z.string(),
  kind: z.enum(["image", "video", "audio", "other"]),
});

export type Attachment = z.infer<typeof Attachment>;

export const Conversation = z.object({
  id: z.string(),
  chatIds: z.array(z.number().int().nonnegative()).min(1),
  sendChatId: z.number().int().nonnegative(),
  identifier: z.string(),
  name: z.string(),
  isGroup: z.boolean(),
  participants: z.array(z.string()),
  service: z.string(),
  lastMessageAt: z.date(),
});

export type Conversation = z.infer<typeof Conversation>;

export const Options = z.object({
  dbPath: z
    .string()
    .default(
      path.join(process.env.HOME ?? "", "Library", "Messages", "chat.db"),
    ),
  debounceMs: z.number().int().positive().default(DEFAULT_DEBOUNCE_MS),
  batchLimit: z.number().int().positive().default(DEFAULT_BATCH_LIMIT),
  scriptRunner: Runner.optional(),
});

export type Options = z.infer<typeof Options>;

export interface IClient {
  list(limit?: number): Chat[];
  conversations(limit?: number): Conversation[];
  conversation(id: string): Conversation | null;
  conversationByChat(chatId: number): Conversation | null;
  unread(): Map<string, number>;
  send(chatId: number, text: string): void;
  markRead(conversation: Conversation): Promise<boolean>;
  subscribeUnread(fn: (changes: UnreadChange[]) => void): () => void;
  sent(chatIds: number[], afterRowId: number, text: string): Message | null;
  history(
    chatId: number,
    limit?: number,
    reverse?: boolean,
    before?: number,
  ): Message[];
  historyAcross(chatIds: number[], limit?: number, before?: number): Message[];
  after(afterRowId: number, limit?: number): Message[];
  latestRowId(): number;
  latestMessageAt(): Date;
  since(cursor: Date, limit?: number): Message[];
  attachments(messageIds: number[]): Attachment[];
  attachmentPath(id: number): string | null;
  subscribe(fn: Subscriber): () => void;
  close(): void;
}

type ChatRow = {
  id: bigint | number;
  identifier: string | null;
  name: string | null;
  service: string | null;
  lastDate: bigint | number | null;
};

type ChatInfoRow = {
  id: bigint | number;
  identifier: string | null;
  guid: string | null;
  service: string | null;
};

type MessageRow = {
  id: bigint | number;
  chatId: bigint | number;
  sender: string | null;
  text: string | null;
  createdAtNs: bigint | number | null;
  isFromMe: bigint | number | boolean | null;
  service: string | null;
  destinationCallerId: string | null;
  attributedBody: Uint8Array | ArrayBuffer | string | null;
};

type AttachmentRow = {
  id: bigint | number;
  messageId: bigint | number;
  mime: string | null;
  name: string | null;
  filename: string | null;
};

function attachmentKind(
  mime: string | null,
  filename: string | null,
): Attachment["kind"] {
  const type = (mime ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";

  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "heic", "heif", "tiff", "webp"].includes(ext))
    return "image";
  if (["mov", "mp4", "m4v", "3gp"].includes(ext)) return "video";
  if (["m4a", "caf", "amr", "aac", "wav", "mp3"].includes(ext)) return "audio";
  return "other";
}

function expandHome(value: string): string {
  if (value.startsWith("~")) {
    return path.join(process.env.HOME ?? "", value.slice(1));
  }
  return value;
}

// Canonical form of a phone/email handle, used to decide whether two chat rows
// belong to the same person/group. Emails lowercased; phones reduced to digits
// with a single leading "+". Good enough to merge SMS/RCS/iMessage rows that
// share a recipient without depending on Contacts.
function normalizeHandle(value: string): string {
  const raw = value.trim();
  if (raw.length === 0) return "";
  if (raw.includes("@")) return raw.toLowerCase();

  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.length > 0 ? digits : raw.toLowerCase();
}

let asbridgeRunner: Runner | null | undefined;

function loadAsbridgeRunner(): Runner | null {
  if (asbridgeRunner !== undefined) {
    return asbridgeRunner;
  }

  let loaded: unknown;

  try {
    loaded = require("asbridge");
  } catch {
    asbridgeRunner = null;
    return asbridgeRunner;
  }

  const exec = (loaded as Partial<Asbridge>).exec;

  if (typeof exec !== "function") {
    asbridgeRunner = null;
    return asbridgeRunner;
  }

  asbridgeRunner = (source, args) => {
    exec(source, args);
  };

  return asbridgeRunner;
}

function parseLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }

  return Math.max(1, Math.floor(limit));
}

function toNumber(value: bigint | number | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return value ?? 0;
}

function toDate(value: bigint | number | null): Date {
  if (value == null) {
    return new Date(APPLE_EPOCH_MS);
  }

  if (typeof value === "bigint") {
    return new Date(Number(value / 1_000_000n) + APPLE_EPOCH_MS);
  }

  return new Date(Math.floor(value / 1_000_000) + APPLE_EPOCH_MS);
}

function toAppleNs(value: Date): bigint {
  return BigInt(value.getTime() - APPLE_EPOCH_MS) * 1_000_000n;
}

function toBoolean(value: bigint | number | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value !== 0n;
  }

  return value !== 0 && value != null;
}

function toBuffer(value: Uint8Array | ArrayBuffer | string | null): Buffer {
  if (value == null) {
    return Buffer.alloc(0);
  }

  if (typeof value === "string") {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

function trimLeadingControl(value: string): string {
  return value.replace(/^[\x00-\x1f]+/g, "");
}

function findSequence(
  haystack: Uint8Array,
  needle: number[],
  from: number,
): number {
  const limit = haystack.length - needle.length;
  let index = from;

  while (index <= limit) {
    let matched = true;

    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }

    index++;
  }

  return -1;
}

function parseAttributedBody(
  value: Uint8Array | ArrayBuffer | string | null,
): string {
  const data = toBuffer(value);

  if (data.length === 0) {
    return "";
  }

  const start = [0x01, 0x2b];
  const end = [0x86, 0x84];
  let best = "";
  let index = 0;

  while (index + 1 < data.length) {
    if (data[index] === start[0] && data[index + 1] === start[1]) {
      const sliceStart = index + 2;
      const sliceEnd = findSequence(data, end, sliceStart);

      if (sliceEnd !== -1) {
        let segment = data.subarray(sliceStart, sliceEnd);

        if (segment.length > 1 && segment[0] === segment.length - 1) {
          segment = segment.subarray(1);
        }

        const candidate = trimLeadingControl(
          Buffer.from(segment).toString("utf8"),
        );

        if (candidate.length > best.length) {
          best = candidate;
        }
      }
    }

    index++;
  }

  if (best.length > 0) {
    return best;
  }

  return trimLeadingControl(data.toString("utf8"));
}

function looksLikeHandle(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith("imessage:") ||
    lower.startsWith("sms:") ||
    lower.startsWith("auto:")
  ) {
    return true;
  }

  if (trimmed.includes("@")) {
    return true;
  }

  return /^[+0-9 ()-]+$/.test(trimmed);
}

function mapService(value: string): "sms" | "imessage" {
  const lower = value.toLowerCase();

  // Anything carried over the cellular network (SMS, MMS, RCS) is sent through
  // the AppleScript "SMS" service. Only the iMessage family maps to iMessage.
  if (lower.includes("sms") || lower.includes("rcs")) {
    return "sms";
  }

  return "imessage";
}

class SQLiteClient implements IClient {
  private readonly db: Database;
  private readonly options: Options;
  private readonly hasAttributedBody: boolean;
  private readonly hasAssociatedMessageType: boolean;
  private readonly hasDestinationCallerID: boolean;
  private readonly hasIsRead: boolean;
  private readonly hasGroupId: boolean;
  private readonly hasStyle: boolean;
  private readonly watchedFiles: Set<string>;
  private readonly watchedPaths: string[];
  private readonly subscribers = new Set<Subscriber>();
  private readonly unreadSubscribers = new Set<UnreadSubscriber>();
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cursor = 0;
  // Mark-read drives the single Messages UI, so calls must run one at a time;
  // chain them so rapid conversation-opens don't fight over the foreground.
  private markReadChain: Promise<unknown> = Promise.resolve();
  // Snapshot of the last emitted unread-by-conversation counts, diffed on each
  // poll so we report only what changed. Reads are in-place UPDATEs (no new
  // ROWID), so the message cursor can't see them — this diff is how we do.
  private lastUnread = new Map<string, number>();
  // The conversation merge is pure over the message set, so it only changes when
  // a new message lands. Memoize it against the latest ROWID and rebuild lazily.
  private convCache: {
    rowId: number;
    list: Conversation[];
    byId: Map<string, Conversation>;
    byChat: Map<number, string>;
  } | null = null;

  constructor(options: Partial<Options> = {}) {
    this.options = Options.parse(options);
    this.db = new Database(this.options.dbPath, {
      readonly: true,
      safeIntegers: true,
    });

    const columns = this.messageColumns();
    this.hasAttributedBody = columns.has("attributedbody");
    this.hasAssociatedMessageType = columns.has("associated_message_type");
    this.hasDestinationCallerID = columns.has("destination_caller_id");
    this.hasIsRead = columns.has("is_read");
    const chatCols = this.chatColumns();
    this.hasGroupId = chatCols.has("group_id");
    this.hasStyle = chatCols.has("style");
    this.watchedFiles = new Set<string>([
      path.basename(this.options.dbPath),
      `${path.basename(this.options.dbPath)}-wal`,
      `${path.basename(this.options.dbPath)}-shm`,
    ]);
    this.watchedPaths = Array.from(this.watchedFiles, (file) =>
      path.join(path.dirname(this.options.dbPath), file),
    );
  }

  list(limit = DEFAULT_LIST_LIMIT): Chat[] {
    const count = parseLimit(limit, DEFAULT_LIST_LIMIT);
    const rows = this.db
      .query(
        `
          SELECT
            c.ROWID AS id,
            c.chat_identifier AS identifier,
            IFNULL(c.display_name, c.chat_identifier) AS name,
            c.service_name AS service,
            MAX(m.date) AS lastDate
          FROM chat c
          JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
          JOIN message m ON m.ROWID = cmj.message_id
          GROUP BY c.ROWID
          ORDER BY lastDate DESC
          LIMIT ?1
        `,
      )
      .all(count) as ChatRow[];

    return rows.map((row) => {
      return Chat.parse({
        id: toNumber(row.id),
        identifier: row.identifier ?? "",
        name: row.name ?? row.identifier ?? "",
        service: row.service ?? "",
        lastMessageAt: toDate(row.lastDate),
      });
    });
  }

  conversations(limit?: number): Conversation[] {
    const { list } = this.conversationIndex();
    return limit == null ? list : list.slice(0, parseLimit(limit, list.length));
  }

  conversation(id: string): Conversation | null {
    return this.conversationIndex().byId.get(id) ?? null;
  }

  conversationByChat(chatId: number): Conversation | null {
    const index = this.conversationIndex();
    const id = index.byChat.get(toNumber(chatId));
    return id == null ? null : (index.byId.get(id) ?? null);
  }

  // Unread message count per conversation, keyed by conversation id. A message
  // is unread when it was received (`is_from_me = 0`) and never read
  // (`is_read = 0`) — the same signal Messages.app shows. Kept out of the merged
  // Conversation (and its ROWID-keyed cache) on purpose: read-state flips when a
  // message is read on the Mac without a new row landing, so this is recomputed
  // on every call (one cheap grouped scan) to always reflect current state.
  // Reaction/tapback rows are excluded so a like never reads as an unread reply.
  unread(): Map<string, number> {
    const counts = new Map<string, number>();
    if (!this.hasIsRead) {
      return counts;
    }

    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const rows = this.db
      .query(
        `
          SELECT cmj.chat_id AS chatId, COUNT(*) AS unread
          FROM message m
          JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          WHERE m.is_from_me = 0 AND m.is_read = 0${reactionFilter}
          GROUP BY cmj.chat_id
        `,
      )
      .all() as Array<{ chatId: bigint | number; unread: bigint | number }>;

    const { byChat } = this.conversationIndex();
    for (const row of rows) {
      const conversationId = byChat.get(toNumber(row.chatId));
      if (conversationId == null) {
        continue;
      }
      counts.set(
        conversationId,
        (counts.get(conversationId) ?? 0) + toNumber(row.unread),
      );
    }

    return counts;
  }

  // Memoized conversation merge. Recomputes only when the newest ROWID moves,
  // so repeated reads (every history fetch, every live event's chat→id lookup)
  // are O(1) between messages instead of two table scans + a full merge.
  private conversationIndex(): NonNullable<SQLiteClient["convCache"]> {
    const rowId = this.maxRowID();
    if (this.convCache && this.convCache.rowId === rowId) {
      return this.convCache;
    }

    const list = this.mergeConversations();
    const byId = new Map<string, Conversation>();
    const byChat = new Map<number, string>();
    for (const conversation of list) {
      byId.set(conversation.id, conversation);
      for (const chatId of conversation.chatIds) {
        byChat.set(chatId, conversation.id);
      }
    }

    this.convCache = { rowId, list, byId, byChat };
    return this.convCache;
  }

  private mergeConversations(): Conversation[] {
    const styleColumn = this.hasStyle ? "c.style" : "0";
    const groupIdColumn = this.hasGroupId ? "IFNULL(c.group_id, '')" : "''";
    const chats = this.db
      .query(
        `
          SELECT
            c.ROWID AS id,
            ${styleColumn} AS style,
            ${groupIdColumn} AS groupId,
            IFNULL(c.chat_identifier, '') AS identifier,
            IFNULL(c.display_name, '') AS name,
            IFNULL(c.service_name, '') AS service,
            MAX(m.date) AS lastDate
          FROM chat c
          JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
          JOIN message m ON m.ROWID = cmj.message_id
          GROUP BY c.ROWID
        `,
      )
      .all() as Array<{
      id: bigint | number;
      style: bigint | number | null;
      groupId: string;
      identifier: string;
      name: string;
      service: string;
      lastDate: bigint | number | null;
    }>;

    const handleRows = this.db
      .query(
        `
          SELECT chj.chat_id AS chatId, h.id AS handle
          FROM chat_handle_join chj
          JOIN handle h ON h.ROWID = chj.handle_id
        `,
      )
      .all() as Array<{ chatId: bigint | number; handle: string | null }>;

    const membersByChat = new Map<number, string[]>();
    for (const row of handleRows) {
      const chatId = toNumber(row.chatId);
      const handle = (row.handle ?? "").trim();
      if (handle.length === 0) continue;
      const list = membersByChat.get(chatId) ?? [];
      list.push(handle);
      membersByChat.set(chatId, list);
    }

    type Group = {
      chatIds: number[];
      sendChatId: number;
      sendDate: number;
      identifier: string;
      name: string;
      isGroup: boolean;
      participants: string[];
      service: string;
      lastDate: number;
    };

    const groups = new Map<string, Group>();

    for (const chat of chats) {
      const id = toNumber(chat.id);
      const isGroup = toNumber(chat.style) === 43;
      const members =
        membersByChat.get(id) ??
        (chat.identifier.length > 0 ? [chat.identifier] : []);
      const key = this.conversationKey(isGroup, chat.groupId, members, id);
      const lastDate = toNumber(chat.lastDate);

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          chatIds: [id],
          sendChatId: id,
          sendDate: lastDate,
          identifier: chat.identifier,
          name: chat.name,
          isGroup,
          participants: members,
          service: chat.service,
          lastDate,
        });
        continue;
      }

      existing.chatIds.push(id);
      if (existing.name.length === 0 && chat.name.length > 0) {
        existing.name = chat.name;
      }
      if (members.length > existing.participants.length) {
        existing.participants = members;
      }
      // "Last service used": the most recently active row wins for sending.
      if (lastDate > existing.sendDate) {
        existing.sendChatId = id;
        existing.sendDate = lastDate;
        existing.service = chat.service;
        existing.identifier = chat.identifier;
      }
      if (lastDate > existing.lastDate) {
        existing.lastDate = lastDate;
      }
    }

    return Array.from(groups.entries())
      .sort((a, b) => b[1].lastDate - a[1].lastDate)
      .map(([key, group]) =>
        Conversation.parse({
          id: key,
          chatIds: group.chatIds,
          sendChatId: group.sendChatId,
          identifier: group.identifier,
          name: group.name,
          isGroup: group.isGroup,
          participants: group.participants,
          service: group.service,
          lastMessageAt: toDate(group.lastDate),
        }),
      );
  }

  // Stable identity for a conversation across its per-transport chat rows.
  // Groups key on Apple's own `group_id` (stable when members are added or
  // removed — a member-set hash is not); 1:1s key on the normalized handle so
  // SMS/RCS/iMessage rows for the same person collapse. Both fall back to the
  // chat ROWID only when no better identifier exists.
  private conversationKey(
    isGroup: boolean,
    groupId: string,
    members: string[],
    chatId: number,
  ): string {
    if (isGroup) {
      const stable = groupId.trim();
      return `g:${stable.length > 0 ? stable : `chat${chatId}`}`;
    }

    const normalized = members
      .map(normalizeHandle)
      .filter((value) => value.length > 0)
      .sort();
    return `d:${normalized.length > 0 ? normalized.join("|") : `chat${chatId}`}`;
  }

  // The (date, ROWID) sort key of a message, used as a keyset-pagination cursor.
  // History is ordered by date — what a chat UI shows — with ROWID only as a
  // tiebreaker, so the cursor must carry both to be a total order; paginating by
  // date alone would skip or repeat messages that share a timestamp, and by
  // ROWID alone would display backfilled/synced messages out of order.
  private messageSortKey(
    rowId: number,
  ): { date: bigint | number; rowId: number } | null {
    const row = this.db
      .query("SELECT m.date AS date FROM message m WHERE m.ROWID = ?1 LIMIT 1")
      .get(rowId) as { date: bigint | number | null } | null;
    if (row == null) {
      return null;
    }
    return { date: row.date ?? 0, rowId };
  }

  history(
    chatId: number,
    limit = DEFAULT_HISTORY_LIMIT,
    reverse = false,
    before?: number,
  ): Message[] {
    const id = ChatID.parse(chatId);
    const count = parseLimit(limit, DEFAULT_HISTORY_LIMIT);
    const sort =
      before == null ? null : this.messageSortKey(parseLimit(before, 1));
    if (before != null && sort == null) {
      return [];
    }
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    // `before` always means "older than", independent of display order.
    const cursorFilter =
      sort == null
        ? ""
        : " AND (m.date < ?3 OR (m.date = ?3 AND m.ROWID < ?4))";
    const order = reverse ? "ASC" : "DESC";
    const sql = `
          SELECT
            m.ROWID AS id,
            cmj.chat_id AS chatId,
            h.id AS sender,
            IFNULL(m.text, '') AS text,
            m.date AS createdAtNs,
            m.is_from_me AS isFromMe,
            m.service AS service,
            ${destinationColumn} AS destinationCallerId,
            ${bodyColumn} AS attributedBody
          FROM message m
          JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE cmj.chat_id = ?1${reactionFilter}${cursorFilter}
          ORDER BY m.date ${order}, m.ROWID ${order}
          LIMIT ?2
        `;
    const query = this.db.query(sql);
    const rows = (
      sort == null
        ? query.all(id, count)
        : query.all(id, count, sort.date, sort.rowId)
    ) as MessageRow[];

    return rows.map((row) => this.parseMessage(row));
  }

  // Merged history across several chat rows (the transports of one
  // conversation), newest-first. Ordered by message date with ROWID as a
  // tiebreaker, and paginated by that same (date, ROWID) keyset cursor — so the
  // page boundary can never disagree with the display order. Uses a subquery
  // membership test rather than a join so a message can't appear twice.
  historyAcross(
    chatIds: number[],
    limit = DEFAULT_HISTORY_LIMIT,
    before?: number,
  ): Message[] {
    const ids = chatIds
      .map((value) => ChatID.parse(value))
      .filter((value) => value > 0);
    if (ids.length === 0) {
      return [];
    }

    const count = parseLimit(limit, DEFAULT_HISTORY_LIMIT);
    const sort =
      before == null ? null : this.messageSortKey(parseLimit(before, 1));
    if (before != null && sort == null) {
      return [];
    }
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const chatPlaceholders = ids.map((_, idx) => `?${idx + 1}`).join(", ");
    const limitParam = ids.length + 1;
    const dateParam = ids.length + 2;
    const rowParam = ids.length + 3;
    const cursorFilter =
      sort == null
        ? ""
        : ` AND (m.date < ?${dateParam} OR (m.date = ?${dateParam} AND m.ROWID < ?${rowParam}))`;
    const sql = `
          SELECT
            m.ROWID AS id,
            (
              SELECT cmj.chat_id FROM chat_message_join cmj
              WHERE cmj.message_id = m.ROWID LIMIT 1
            ) AS chatId,
            h.id AS sender,
            IFNULL(m.text, '') AS text,
            m.date AS createdAtNs,
            m.is_from_me AS isFromMe,
            m.service AS service,
            ${destinationColumn} AS destinationCallerId,
            ${bodyColumn} AS attributedBody
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.ROWID IN (
            SELECT message_id FROM chat_message_join
            WHERE chat_id IN (${chatPlaceholders})
          )${reactionFilter}${cursorFilter}
          ORDER BY m.date DESC, m.ROWID DESC
          LIMIT ?${limitParam}
        `;
    const params =
      sort == null
        ? [...ids, count]
        : [...ids, count, sort.date, sort.rowId];
    const rows = this.db.query(sql).all(...params) as MessageRow[];

    return rows.map((row) => this.parseMessage(row));
  }

  // Messages newer than `afterRowId`, oldest-first. Used to replay the gap to a
  // reconnecting event stream (the consumer hands back the last ROWID it saw).
  after(afterRowId: number, limit = DEFAULT_BATCH_LIMIT): Message[] {
    const count = parseLimit(limit, DEFAULT_BATCH_LIMIT);
    return this.selectAfter(Math.max(0, Math.floor(afterRowId)), count);
  }

  // The newest message ROWID. ROWID is assigned at insert, so this is the
  // monotonic cursor used for live tailing and send confirmation.
  latestRowId(): number {
    return this.maxRowID();
  }

  // After handing a message to Messages.app we can't get its ROWID back from
  // AppleScript, so we look it up: the first outgoing message in this
  // conversation's chat rows newer than `afterRowId` whose text matches. The
  // caller captures `afterRowId` immediately before sending, which bounds the
  // search to rows this send could have produced. Returns null if it hasn't
  // been written yet (the caller polls).
  sent(chatIds: number[], afterRowId: number, text: string): Message | null {
    const ids = chatIds
      .map((value) => ChatID.parse(value))
      .filter((value) => value > 0);
    if (ids.length === 0) {
      return null;
    }

    const after = Math.max(0, Math.floor(afterRowId));
    const wanted = text.trim();
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const placeholders = ids.map((_, idx) => `?${idx + 2}`).join(", ");
    const rows = this.db
      .query(
        `
          SELECT
            m.ROWID AS id,
            (
              SELECT cmj.chat_id FROM chat_message_join cmj
              WHERE cmj.message_id = m.ROWID LIMIT 1
            ) AS chatId,
            h.id AS sender,
            IFNULL(m.text, '') AS text,
            m.date AS createdAtNs,
            m.is_from_me AS isFromMe,
            m.service AS service,
            ${destinationColumn} AS destinationCallerId,
            ${bodyColumn} AS attributedBody
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.ROWID > ?1
            AND m.is_from_me = 1
            AND m.ROWID IN (
              SELECT message_id FROM chat_message_join
              WHERE chat_id IN (${placeholders})
            )
          ORDER BY m.ROWID ASC
          LIMIT 25
        `,
      )
      .all(after, ...ids) as MessageRow[];

    const candidates = rows.map((row) => this.parseMessage(row));
    return candidates.find((message) => message.text.trim() === wanted) ?? null;
  }

  latestMessageAt(): Date {
    const row = this.db
      .query("SELECT MAX(date) AS lastDate FROM message")
      .get() as {
      lastDate: bigint | number | null;
    } | null;

    return toDate(row?.lastDate ?? null);
  }

  since(cursor: Date, limit = DEFAULT_BATCH_LIMIT): Message[] {
    const point = z.date().parse(cursor);
    const count = parseLimit(limit, DEFAULT_BATCH_LIMIT);
    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const rows = this.db
      .query(
        `
          SELECT
            m.ROWID AS id,
            cmj.chat_id AS chatId,
            h.id AS sender,
            IFNULL(m.text, '') AS text,
            m.date AS createdAtNs,
            m.is_from_me AS isFromMe,
            m.service AS service,
            ${destinationColumn} AS destinationCallerId,
            ${bodyColumn} AS attributedBody
          FROM message m
          JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.date > ?1${reactionFilter}
          ORDER BY m.date ASC, m.ROWID ASC
          LIMIT ?2
        `,
      )
      .all(toAppleNs(point), count) as MessageRow[];

    return rows.map((row) => this.parseMessage(row));
  }

  attachments(messageIds: number[]): Attachment[] {
    const ids = messageIds
      .map((value) => ChatID.parse(value))
      .filter((value) => value > 0);
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map((_, idx) => `?${idx + 1}`).join(", ");
    const rows = this.db
      .query(
        `
          SELECT
            a.ROWID AS id,
            maj.message_id AS messageId,
            a.mime_type AS mime,
            IFNULL(NULLIF(a.transfer_name, ''), a.filename) AS name,
            a.filename AS filename
          FROM message_attachment_join maj
          JOIN attachment a ON a.ROWID = maj.attachment_id
          WHERE maj.message_id IN (${placeholders})
            AND a.filename IS NOT NULL
            AND IFNULL(a.is_sticker, 0) = 0
            AND IFNULL(a.filename, '') NOT LIKE '%.pluginPayloadAttachment'
          ORDER BY a.ROWID ASC
        `,
      )
      .all(...ids) as AttachmentRow[];

    return rows.map((row) =>
      Attachment.parse({
        id: toNumber(row.id),
        messageId: toNumber(row.messageId),
        mime: row.mime ?? "",
        name: path.basename(row.name ?? "") || "attachment",
        kind: attachmentKind(row.mime, row.filename),
      }),
    );
  }

  attachmentPath(id: number): string | null {
    const attachmentId = ChatID.parse(id);
    const row = this.db
      .query("SELECT filename FROM attachment WHERE ROWID = ?1 LIMIT 1")
      .get(attachmentId) as { filename: string | null } | null;

    if (!row?.filename) {
      return null;
    }

    return expandHome(row.filename);
  }

  send(chatId: number, text: string): void {
    const id = ChatID.parse(chatId);
    const content = Text.parse(text);
    const row = this.db
      .query(
        `
          SELECT
            c.ROWID AS id,
            IFNULL(c.chat_identifier, '') AS identifier,
            IFNULL(c.guid, '') AS guid,
            IFNULL(c.service_name, '') AS service
          FROM chat c
          WHERE c.ROWID = ?1
          LIMIT 1
        `,
      )
      .get(id) as ChatInfoRow | null;

    if (row == null) {
      throw new Error(`Chat ${id} not found`);
    }

    const identifier = (row.identifier ?? "").trim();
    const service = this.resolveSendService(identifier, row.service ?? "");

    // Prefer sending to an existing chat thread by guid. A guid encodes its
    // transport (e.g. "SMS;-;+15551234567" vs "iMessage;-;+15551234567"), so
    // Messages binds the right service without us going through the SMS "buddy"
    // path — that path depends on enumerating Messages services/accounts, which
    // errors out (-1728) and hangs on modern macOS. Fall back to the referenced
    // row's own guid, and only then to the buddy path.
    const guid =
      this.resolveSendGuid(identifier, service) || (row.guid ?? "").trim();

    if (guid.length > 0) {
      this.execAppleScript(SendScript, ["", content, service, guid, "1"]);
      return;
    }

    const handle = looksLikeHandle(identifier) ? identifier : "";

    if (handle.length === 0) {
      throw new Error(`Chat ${id} has no sendable identifier`);
    }

    this.execAppleScript(SendScript, [handle, content, service, "", "0"]);
  }

  // Drive Messages to mark a conversation read for real (clears it on this Mac,
  // sends a read receipt where applicable, and syncs to other devices) — the
  // database is read-only, so this is the only way to persist a read. Serialized
  // and run async so it doesn't block the event loop or fight the foreground.
  // Resolves true if it drove Messages, false if it was a no-op (a group, no
  // handle, or already read). Best-effort: failures reject for the caller to log.
  markRead(conversation: Conversation): Promise<boolean> {
    const task = () => this.runMarkRead(conversation);
    const result = this.markReadChain.then(task, task);
    this.markReadChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runMarkRead(conversation: Conversation): Promise<boolean> {
    // Only 1:1 threads can be addressed by handle via the URL scheme; a group
    // has no such address, so we can't drive Messages to select it.
    if (conversation.isGroup) {
      return false;
    }
    const handle = conversation.identifier.trim();
    if (handle.length === 0) {
      return false;
    }
    // Skip if it's already read — a stale queued open, or read elsewhere since —
    // so we don't yank Messages to the foreground for nothing.
    if ((this.unread().get(conversation.id) ?? 0) === 0) {
      return false;
    }

    await this.execAppleScriptAsync(MarkReadScript, [
      handle,
      mapService(conversation.service),
    ]);
    return true;
  }

  // Picks the chat guid to send to for the resolved service. A person often has
  // separate SMS/RCS/iMessage chat rows for the same handle, so we choose the
  // thread whose transport matches `service` rather than whichever row the
  // caller referenced. For carrier sends we prefer the canonical "SMS" thread
  // (Messages upgrades to RCS automatically when available). When no matching
  // thread exists for a 1:1 handle we synthesize the guid, which Messages
  // accepts; for anything else (e.g. group chats) we return "" so the caller
  // falls back to the referenced row's guid.
  private resolveSendGuid(
    identifier: string,
    service: "sms" | "imessage",
  ): string {
    if (identifier.length === 0) {
      return "";
    }

    const rows = this.db
      .query(
        `
          SELECT IFNULL(c.guid, '') AS guid, IFNULL(c.service_name, '') AS service
          FROM chat c
          WHERE c.chat_identifier = ?1 AND IFNULL(c.guid, '') <> ''
        `,
      )
      .all(identifier) as { guid: string; service: string }[];

    const matches = rows.filter((r) => mapService(r.service) === service);
    const chosen =
      (service === "sms"
        ? matches.find((r) => r.service.toLowerCase() === "sms")
        : undefined) ?? matches[0];

    if (chosen != null) {
      return chosen.guid.trim();
    }

    if (looksLikeHandle(identifier)) {
      return `${service === "sms" ? "SMS" : "iMessage"};-;${identifier}`;
    }

    return "";
  }

  // Determines which service to send over for a 1:1 recipient. A chat row's
  // service_name is unreliable: a single person can have separate SMS, RCS, and
  // iMessage chat rows, and the row the caller happens to reference may not be
  // the one that actually reaches them. The real signal is the most recent
  // message that genuinely succeeded — received, or sent without error. Failed
  // sends (e.g. an iMessage that bounced with an error) are excluded so a prior
  // failure can't pin us to a service that doesn't work. Falls back to the
  // chat row's service_name when there is no usable history.
  private resolveSendService(
    handle: string,
    fallback: string,
  ): "sms" | "imessage" {
    if (handle.length > 0) {
      const recent = this.db
        .query(
          `
            SELECT m.service AS service
            FROM message m
            JOIN handle h ON h.ROWID = m.handle_id
            WHERE h.id = ?1
              AND m.error = 0
              AND (m.is_from_me = 0 OR m.is_sent = 1)
              AND IFNULL(m.service, '') <> ''
            ORDER BY m.date DESC
            LIMIT 1
          `,
        )
        .get(handle) as { service: string | null } | null;

      if (recent?.service != null && recent.service.length > 0) {
        return mapService(recent.service);
      }
    }

    return mapService(fallback);
  }

  subscribe(fn: Subscriber): () => void {
    const wasIdle = this.subscriberCount() === 0;
    this.subscribers.add(fn);

    // The message cursor is meaningful only to message subscribers: pin it to
    // "now" when the first one joins so it tails new messages, regardless of any
    // unread subscriber that may have started the watcher already.
    if (this.subscribers.size === 1) {
      this.cursor = this.maxRowID();
    }
    if (wasIdle) {
      this.startWatcher();
    }

    return () => {
      this.subscribers.delete(fn);

      if (this.subscriberCount() === 0) {
        this.stopWatcher();
      }
    };
  }

  // Subscribe to unread-count changes per conversation. Shares the file watcher
  // with subscribe(); the diff is computed on the same poll. The first unread
  // subscriber seeds the snapshot from the current state so the initial diff
  // reports genuine changes, not the whole existing backlog of unread chats.
  subscribeUnread(fn: UnreadSubscriber): () => void {
    const wasIdle = this.subscriberCount() === 0;
    this.unreadSubscribers.add(fn);

    if (this.unreadSubscribers.size === 1) {
      this.lastUnread = this.unread();
    }
    if (wasIdle) {
      this.startWatcher();
    }

    return () => {
      this.unreadSubscribers.delete(fn);

      if (this.subscriberCount() === 0) {
        this.stopWatcher();
      }
    };
  }

  private subscriberCount(): number {
    return this.subscribers.size + this.unreadSubscribers.size;
  }

  close() {
    this.stopWatcher();
    this.subscribers.clear();
    this.unreadSubscribers.clear();
    this.db.close();
  }

  private messageColumns(): Set<string> {
    return this.tableColumns("message");
  }

  private chatColumns(): Set<string> {
    return this.tableColumns("chat");
  }

  private tableColumns(table: string): Set<string> {
    const rows = this.db
      .query(`SELECT name FROM pragma_table_info('${table}')`)
      .all() as Array<{
      name: string | null;
    }>;

    return new Set(rows.map((row) => (row.name ?? "").toLowerCase()));
  }

  // Messages with ROWID greater than `rowId`, oldest-first. Shared by the live
  // tail (poll) and gap replay (after); both want strict ROWID order.
  private selectAfter(rowId: number, limit: number): Message[] {
    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const rows = this.db
      .query(
        `
          SELECT
            m.ROWID AS id,
            cmj.chat_id AS chatId,
            h.id AS sender,
            IFNULL(m.text, '') AS text,
            m.date AS createdAtNs,
            m.is_from_me AS isFromMe,
            m.service AS service,
            ${destinationColumn} AS destinationCallerId,
            ${bodyColumn} AS attributedBody
          FROM message m
          JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.ROWID > ?1${reactionFilter}
          ORDER BY m.ROWID ASC
          LIMIT ?2
        `,
      )
      .all(rowId, limit) as MessageRow[];

    return rows.map((row) => this.parseMessage(row));
  }

  private parseMessage(row: MessageRow): Message {
    const sender =
      row.sender && row.sender.length > 0
        ? row.sender
        : (row.destinationCallerId ?? "");
    const text =
      row.text && row.text.length > 0
        ? row.text
        : parseAttributedBody(row.attributedBody);

    return Message.parse({
      id: toNumber(row.id),
      chatId: toNumber(row.chatId),
      sender,
      text,
      createdAt: toDate(row.createdAtNs),
      isFromMe: toBoolean(row.isFromMe),
      service: row.service ?? "",
    });
  }

  private startWatcher(): void {
    if (this.watcher) {
      return;
    }

    // fs.watch (FSEvents on macOS) misses SQLite WAL/SHM writes — those files
    // are memory-mapped and their change events get coalesced or dropped, so on
    // its own the watcher silently fails to notice incoming messages. Poll the
    // file mtimes as well; between the two we reliably catch every update.
    for (const watchedPath of this.watchedPaths) {
      fs.watchFile(watchedPath, { interval: 1000 }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs) {
          return;
        }

        this.schedulePoll();
      });
    }

    this.watcher = fs.watch(
      path.dirname(this.options.dbPath),
      (_event, file) => {
        if (file == null) {
          return;
        }

        const name = file.toString();

        if (!this.watchedFiles.has(name)) {
          return;
        }

        this.schedulePoll();
      },
    );
  }

  private stopWatcher(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const watchedPath of this.watchedPaths) {
      fs.unwatchFile(watchedPath);
    }
  }

  private schedulePoll(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll();
    }, this.options.debounceMs);
  }

  private poll(): void {
    if (this.subscriberCount() === 0) {
      return;
    }

    if (this.subscribers.size > 0) {
      const batch = this.options.batchLimit;
      let shouldContinue = true;

      while (shouldContinue) {
        const messages = this.selectAfter(this.cursor, batch);

        if (messages.length === 0) {
          break;
        }

        for (const message of messages) {
          if (message.id > this.cursor) {
            this.cursor = message.id;
          }

          for (const subscriber of this.subscribers) {
            try {
              subscriber(message);
            } catch {
              continue;
            }
          }
        }

        shouldContinue = messages.length >= batch;
      }
    }

    if (this.unreadSubscribers.size > 0) {
      this.emitUnreadChanges();
    }
  }

  private emitUnreadChanges(): void {
    const current = this.unread();
    const changes: UnreadChange[] = [];

    for (const [conversationId, count] of current) {
      if (this.lastUnread.get(conversationId) !== count) {
        changes.push({ conversationId, unread: count });
      }
    }
    for (const conversationId of this.lastUnread.keys()) {
      if (!current.has(conversationId)) {
        changes.push({ conversationId, unread: 0 });
      }
    }

    this.lastUnread = current;

    if (changes.length === 0) {
      return;
    }

    for (const subscriber of this.unreadSubscribers) {
      try {
        subscriber(changes);
      } catch {
        continue;
      }
    }
  }

  private maxRowID(): number {
    const row = this.db
      .query("SELECT MAX(ROWID) AS maxRowID FROM message")
      .get() as { maxRowID: bigint | number | null } | null;

    return toNumber(row?.maxRowID);
  }

  private execAppleScript(source: string, args: readonly string[]): void {
    const runner = this.options.scriptRunner ?? loadAsbridgeRunner();

    if (runner) {
      runner(source, args);
      return;
    }

    const result = spawnSync(
      "/usr/bin/osascript",
      ["-l", "AppleScript", "-", ...args],
      {
        input: source,
        encoding: "utf8",
        timeout: SEND_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );

    const errorCode = (result.error as (Error & { code?: string }) | undefined)
      ?.code;
    if (errorCode === "ETIMEDOUT" || result.signal != null) {
      throw new Error(
        `Messages did not respond within ${SEND_TIMEOUT_MS / 1000}s; the send may not have gone through`,
      );
    }

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      return;
    }

    const detail = (
      result.stderr ||
      result.stdout ||
      "AppleScript execution failed"
    ).trim();
    throw new Error(
      detail.length > 0 ? detail : "AppleScript execution failed",
    );
  }

  private async execAppleScriptAsync(
    source: string,
    args: readonly string[],
  ): Promise<void> {
    if (this.options.scriptRunner) {
      this.options.scriptRunner(source, args);
      return;
    }

    const proc = Bun.spawn(
      ["/usr/bin/osascript", "-l", "AppleScript", "-", ...args],
      { stdin: Buffer.from(source), stdout: "ignore", stderr: "pipe" },
    );

    const killer = setTimeout(() => proc.kill(9), SEND_TIMEOUT_MS);
    let status: number;
    try {
      status = await proc.exited;
    } finally {
      clearTimeout(killer);
    }

    if (status !== 0) {
      const detail = (await new Response(proc.stderr).text()).trim();
      throw new Error(detail || "AppleScript execution failed");
    }
  }
}

export function Client(options: Partial<Options> = {}): IClient {
  return new SQLiteClient(options);
}
