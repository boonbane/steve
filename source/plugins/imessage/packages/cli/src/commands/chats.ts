import { z } from "zod/v4";
import { Database } from "bun:sqlite";
import { Client, Options, type Chat } from "steve-plugin-imessage-core";
import { ContactLookup } from "../contacts.ts";
import { tableRows } from "../layout.ts";
import { defaultTheme } from "../theme.ts";
import type { CommandDef } from "../yargs.ts";

type Row = Chat & {
  lastMessage: string;
};

const Args = z.object({
  limit: z.number().int().positive().default(20),
  db: z.string().default(Options.parse({}).dbPath),
});

export namespace ChatsCommand {
  function participants(dbPath: string, ids: number[]): Map<number, string[]> {
    const map = new Map<number, string[]>();
    if (ids.length === 0) {
      return map;
    }

    const db = new Database(dbPath, {
      readonly: true,
      safeIntegers: true,
    });

    try {
      const marks = ids.map((_, idx) => `?${idx + 1}`).join(", ");
      const rows = db
        .query(
          `
            SELECT
              chj.chat_id AS chatId,
              h.id AS handle
            FROM chat_handle_join chj
            JOIN handle h ON h.ROWID = chj.handle_id
            WHERE chj.chat_id IN (${marks})
          `,
        )
        .all(...ids) as Array<{
        chatId: bigint | number;
        handle: string | null;
      }>;

      for (const row of rows) {
        if (!row.handle) {
          continue;
        }

        const id =
          typeof row.chatId === "bigint" ? Number(row.chatId) : row.chatId;
        const current = map.get(id) ?? [];
        current.push(row.handle);
        map.set(id, current);
      }
    } catch {
      return map;
    } finally {
      db.close();
    }

    return map;
  }

  function hasDisplayName(chat: Chat): boolean {
    const a = chat.name.trim();
    const b = chat.identifier.trim();
    if (a.length === 0) {
      return false;
    }

    return a !== b;
  }

  function display(chat: Chat, people: string[]): string {
    if (hasDisplayName(chat)) {
      return chat.name;
    }

    if (people.length > 0) {
      return people.join(", ");
    }

    return chat.name;
  }

  export const options = {
    limit: {
      alias: "n",
      type: "number",
      description: "Maximum number of chats to list",
      default: 20,
    },
    db: {
      alias: "d",
      type: "string",
      description: "Path to chat.db",
      default: Options.parse({}).dbPath,
    },
  } as const;

  export function run(argv: Record<string, unknown>): void {
    const args = Args.parse({
      limit: typeof argv.limit === "number" ? argv.limit : undefined,
      db: typeof argv.db === "string" ? argv.db : undefined,
    });

    const client = Client({ dbPath: args.db });
    let chats: Chat[] = [];
    const preview = new Map<number, string>();

    try {
      chats = client.list(args.limit);

      for (const chat of chats) {
        const item = client.history(chat.id, 1)[0];
        preview.set(chat.id, item?.text ?? "");
      }
    } finally {
      client.close();
    }

    if (chats.length === 0) {
      process.stdout.write(`${defaultTheme.dim("(no chats)")}\n`);
      return;
    }

    const byChat = participants(
      args.db,
      chats.map((chat) => chat.id),
    );
    const lookup: string[] = [];

    for (const handles of byChat.values()) {
      for (const handle of handles) {
        lookup.push(handle);
      }
    }

    for (const chat of chats) {
      lookup.push(chat.identifier);
    }

    const names = ContactLookup.resolve(lookup);
    const rows = chats.map((chat) => {
      const handles = byChat.get(chat.id) ?? [];
      const list = Array.from(
        new Set(
          handles
            .map((value) => ContactLookup.label(value, names))
            .filter((value) => value.length > 0),
        ),
      );

      if (list.length === 0) {
        const one = ContactLookup.label(chat.identifier, names);
        if (one.length > 0) {
          list.push(one);
        }
      }

      return {
        ...chat,
        name: display(chat, list),
        lastMessage: preview.get(chat.id) ?? "",
      };
    });

    renderTable(rows);
  }

  export function renderTable(chats: Row[]): void {
    tableRows(
      chats,
      [
        {
          id: "id",
          header: "id",
          value: (chat) => String(chat.id),
          flex: 0,
          noTruncate: true,
          truncate: "end",
          format: (value) => defaultTheme.code(value),
        },
        {
          id: "name",
          header: "name",
          value: (chat) => chat.name,
          flex: 2,
          truncate: "end",
          format: (value) => defaultTheme.white(value),
        },
        {
          id: "service",
          header: "service",
          value: (chat) => chat.service,
          flex: 0,
          noTruncate: true,
          truncate: "end",
          format: (value) => defaultTheme.service(value),
        },
        {
          id: "lastMessage",
          header: "last message",
          value: (chat) => chat.lastMessage,
          flex: 1,
          truncate: "end",
        },
      ],
      {
        maxRows: chats.length,
      },
    );
  }
}

export const chats: CommandDef = {
  description: "List recent iMessage chats",
  summary: "List chats in a table",
  options: ChatsCommand.options,
  handler: (argv) => {
    ChatsCommand.run(argv as Record<string, unknown>);
  },
};
