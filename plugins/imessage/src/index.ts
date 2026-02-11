import { Database } from "bun:sqlite";
import path from "path";
import { z } from "zod/v4";

const APPLE_EPOCH_MS = 978_307_200_000;
const DEFAULT_LIST_LIMIT = 20;

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
});

export type Options = z.infer<typeof Options>;

export interface IClient {
  list(limit?: number): Chat[];
  close(): void;
}

type ChatRow = {
  id: bigint | number;
  identifier: string | null;
  name: string | null;
  service: string | null;
  lastDate: bigint | number | null;
};

class SQLiteClient implements IClient {
  private readonly db: Database;

  constructor(options: Partial<Options> = {}) {
    const parsed = Options.parse(options);
    this.db = new Database(parsed.dbPath, {
      readonly: true,
      safeIntegers: true,
    });
  }

  list(limit = DEFAULT_LIST_LIMIT): Chat[] {
    const count = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : DEFAULT_LIST_LIMIT;
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
      const id = typeof row.id === "bigint" ? Number(row.id) : row.id;
      const lastMessageAt =
        row.lastDate === null
          ? new Date(APPLE_EPOCH_MS)
          : new Date(
              (typeof row.lastDate === "bigint"
                ? Number(row.lastDate / 1_000_000n)
                : Math.floor(row.lastDate / 1_000_000)) + APPLE_EPOCH_MS,
            );

      return Chat.parse({
        id,
        identifier: row.identifier ?? "",
        name: row.name ?? row.identifier ?? "",
        service: row.service ?? "",
        lastMessageAt,
      });
    });
  }

  close() {
    this.db.close();
  }
}

export function Client(options: Partial<Options> = {}): IClient {
  return new SQLiteClient(options);
}
