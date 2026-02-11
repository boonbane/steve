import { z } from "zod/v4";
import { Client, Options, type Message } from "../../index.ts";
import { table } from "../../shared/layout.ts";
import { defaultTheme } from "../../shared/theme.ts";
import type { CommandDef } from "../../shared/yargs.ts";

const DateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const Args = z.object({
  chatId: z.number().int().nonnegative(),
  limit: z.number().int().positive().default(50),
  db: z.string().default(Options.parse({}).dbPath),
});

export namespace HistoryCommand {
  export const positionals = {
    chatId: {
      type: "number",
      description: "Chat row id",
      required: true,
    },
  } as const;

  export const options = {
    limit: {
      alias: "n",
      type: "number",
      description: "Maximum number of messages to list",
      default: 50,
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
      chatId: typeof argv.chatId === "number" ? argv.chatId : undefined,
      limit: typeof argv.limit === "number" ? argv.limit : undefined,
      db: typeof argv.db === "string" ? argv.db : undefined,
    });

    const client = Client({ dbPath: args.db });
    let messages: Message[] = [];

    try {
      messages = client.history(args.chatId, args.limit);
    } finally {
      client.close();
    }

    if (messages.length === 0) {
      process.stdout.write(`${defaultTheme.dim("(no messages)")}\n`);
      return;
    }

    renderTable(messages);
  }

  export function renderTable(messages: Message[]): void {
    table(
      ["id", "time", "from", "service", "text"],
      [
        messages.map((message) => String(message.id)),
        messages.map((message) => DateFormatter.format(message.createdAt)),
        messages.map((message) =>
          message.isFromMe ? "me" : message.sender || "(unknown)",
        ),
        messages.map((message) => message.service),
        messages.map((message) => message.text),
      ],
      {
        flex: [0, 0, 1, 0, 2],
        noTruncate: [true, true, false, true, false],
        truncate: ["end", "end", "end", "end", "end"],
        format: [
          (value) => defaultTheme.code(value),
          (value) => defaultTheme.dim(value),
          (value) => defaultTheme.primary(value),
          (value) => defaultTheme.dim(value),
          (value) => value,
        ],
      },
    );
  }
}

export const history: CommandDef = {
  description: "Show message history for a chat",
  summary: "Show recent messages",
  positionals: HistoryCommand.positionals,
  options: HistoryCommand.options,
  handler: (argv) => {
    HistoryCommand.run(argv as Record<string, unknown>);
  },
};
