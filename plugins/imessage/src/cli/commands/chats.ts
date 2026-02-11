import { z } from "zod/v4";
import { Client, Options, type Chat } from "../../index.ts";
import { formatPath } from "../../shared/display.ts";
import { table } from "../../shared/layout.ts";
import { defaultTheme } from "../../shared/theme.ts";
import type { CommandDef } from "../../shared/yargs.ts";

const DateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const Args = z.object({
  limit: z.number().int().positive().default(20),
  db: z.string().default(Options.parse({}).dbPath),
});

export namespace ChatsCommand {
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

    try {
      chats = client.list(args.limit);
    } finally {
      client.close();
    }

    if (chats.length === 0) {
      process.stdout.write(`${defaultTheme.dim("(no chats)")}\n`);
      return;
    }

    renderTable(chats);
  }

  export function renderTable(chats: Chat[]): void {
    table(
      ["id", "name", "identifier", "service", "last message"],
      [
        chats.map((chat) => String(chat.id)),
        chats.map((chat) => chat.name),
        chats.map((chat) => chat.identifier),
        chats.map((chat) => chat.service),
        chats.map((chat) => DateFormatter.format(chat.lastMessageAt)),
      ],
      {
        flex: [0, 1, 2, 0, 0],
        noTruncate: [true, false, false, true, true],
        truncate: ["end", "end", "start", "end", "end"],
        format: [
          (s) => defaultTheme.code(s),
          (s) => defaultTheme.primary(s),
          (s) => formatPath(s),
          (s) => defaultTheme.dim(s),
          (s) => defaultTheme.dim(s),
        ],
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
