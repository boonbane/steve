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

type Runner = (source: string, args: readonly string[]) => void;
type Subscriber = (message: Message) => void;

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
  send(chatId: number, text: string): void;
  history(chatId: number, limit?: number, reverse?: boolean): Message[];
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
  if (value.toLowerCase().includes("sms")) {
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
  private readonly watchedFiles: Set<string>;
  private readonly subscribers = new Set<Subscriber>();
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cursor = 0;

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
    this.watchedFiles = new Set<string>([
      path.basename(this.options.dbPath),
      `${path.basename(this.options.dbPath)}-wal`,
      `${path.basename(this.options.dbPath)}-shm`,
    ]);
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

  history(
    chatId: number,
    limit = DEFAULT_HISTORY_LIMIT,
    reverse = false,
  ): Message[] {
    const id = ChatID.parse(chatId);
    const count = parseLimit(limit, DEFAULT_HISTORY_LIMIT);
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const order = reverse ? "ASC" : "DESC";
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
          WHERE cmj.chat_id = ?1${reactionFilter}
          ORDER BY m.date ${order}
          LIMIT ?2
        `,
      )
      .all(id, count) as MessageRow[];

    return rows.map((row) => this.parseMessage(row));
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
    const guid = (row.guid ?? "").trim();
    const service = mapService(row.service ?? "");
    const handle = looksLikeHandle(identifier) ? identifier : "";
    const chatTarget = guid || identifier;
    const useChat = handle.length === 0;

    if (useChat && chatTarget.length === 0) {
      throw new Error(`Chat ${id} has no sendable identifier`);
    }

    this.execAppleScript(SendScript, [
      handle,
      content,
      service,
      useChat ? chatTarget : "",
      useChat ? "1" : "0",
    ]);
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);

    if (this.subscribers.size === 1) {
      this.cursor = this.maxRowID();
      this.startWatcher();
    }

    return () => {
      this.subscribers.delete(fn);

      if (this.subscribers.size === 0) {
        this.stopWatcher();
      }
    };
  }

  close() {
    this.stopWatcher();
    this.subscribers.clear();
    this.db.close();
  }

  private messageColumns(): Set<string> {
    const rows = this.db
      .query("SELECT name FROM pragma_table_info('message')")
      .all() as Array<{
      name: string | null;
    }>;

    return new Set(rows.map((row) => (row.name ?? "").toLowerCase()));
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
    if (this.subscribers.size === 0) {
      return;
    }

    const reactionFilter = this.hasAssociatedMessageType
      ? " AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type > 3006)"
      : "";
    const bodyColumn = this.hasAttributedBody ? "m.attributedBody" : "NULL";
    const destinationColumn = this.hasDestinationCallerID
      ? "m.destination_caller_id"
      : "NULL";
    const batch = this.options.batchLimit;
    let shouldContinue = true;

    while (shouldContinue) {
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
        .all(this.cursor, batch) as MessageRow[];

      if (rows.length === 0) {
        return;
      }

      for (const row of rows) {
        const message = this.parseMessage(row);

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

      shouldContinue = rows.length >= batch;
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
      },
    );

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
}

export function Client(options: Partial<Options> = {}): IClient {
  return new SQLiteClient(options);
}
