import { z } from "zod/v4";
import { Client, Options, type Message } from "steve-plugin-imessage-core";
import { ContactLookup } from "../contacts.ts";
import { tableRows } from "../layout.ts";
import { defaultTheme } from "../theme.ts";
import type { CommandDef } from "../yargs.ts";

const DayFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const Args = z.object({
  chatId: z.number().int().nonnegative(),
  limit: z.number().int().positive().default(50),
  reverse: z.boolean().default(false),
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
    reverse: {
      alias: "r",
      type: "boolean",
      description: "Show messages in reverse chronological order",
      default: false,
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
      reverse: typeof argv.reverse === "boolean" ? argv.reverse : undefined,
      db: typeof argv.db === "string" ? argv.db : undefined,
    });

    const client = Client({ dbPath: args.db });
    let messages: Message[] = [];

    try {
      messages = client.history(args.chatId, args.limit, args.reverse);
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
    const names = ContactLookup.resolve(
      messages.map((message) => message.sender),
    );

    tableRows(messages, [
      {
        id: "id",
        header: "id",
        value: (message) => String(message.id),
        flex: 0,
        noTruncate: true,
        truncate: "end",
        format: (value) => defaultTheme.code(value),
      },
      {
        id: "day",
        header: "day",
        value: (message) => DayFormatter.format(message.createdAt),
        flex: 0,
        noTruncate: true,
        truncate: "end",
        format: (value) => defaultTheme.dim(value),
      },
      {
        id: "time",
        header: "time",
        value: (message) => TimeFormatter.format(message.createdAt),
        flex: 0,
        noTruncate: true,
        truncate: "end",
        format: (value) => defaultTheme.dim(value),
      },
      {
        id: "from",
        header: "from",
        value: (message) => {
          if (message.isFromMe) {
            return "me";
          }

          const name = ContactLookup.label(message.sender, names);
          if (name.length > 0) {
            return name;
          }

          return "(unknown)";
        },
        flex: 1,
        truncate: "end",
        format: (value) => defaultTheme.white(value),
      },
      {
        id: "text",
        header: "text",
        value: (message) => message.text,
        flex: 2,
        truncate: "end",
      },
    ]);
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
