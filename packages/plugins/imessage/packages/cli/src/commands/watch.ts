import { z } from "zod/v4";
import { Client, Options, type Message } from "steve-plugin-imessage-core";
import { tableRows } from "../layout.ts";
import { defaultTheme } from "../theme.ts";
import type { CommandDef } from "../yargs.ts";

const DateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const Args = z.object({
  chatId: z.number().int().nonnegative().optional(),
  count: z.number().int().positive().optional(),
  db: z.string().default(Options.parse({}).dbPath),
});

export namespace WatchCommand {
  export const options = {
    chatId: {
      alias: "c",
      type: "number",
      description: "Only emit messages from this chat id",
    },
    count: {
      alias: "n",
      type: "number",
      description: "Stop after emitting this many messages",
    },
    db: {
      alias: "d",
      type: "string",
      description: "Path to chat.db",
      default: Options.parse({}).dbPath,
    },
  } as const;

  export async function run(argv: Record<string, unknown>): Promise<void> {
    const args = Args.parse({
      chatId: typeof argv.chatId === "number" ? argv.chatId : undefined,
      count: typeof argv.count === "number" ? argv.count : undefined,
      db: typeof argv.db === "string" ? argv.db : undefined,
    });
    const max = args.count ?? Number.POSITIVE_INFINITY;
    const client = Client({ dbPath: args.db });
    process.stdout.write(
      `${defaultTheme.dim("watching for new messages...")}\n`,
    );

    await new Promise<void>((resolve) => {
      let total = 0;
      let done = false;
      const stop = client.subscribe((message) => {
        if (done) {
          return;
        }

        if (args.chatId !== undefined && message.chatId !== args.chatId) {
          return;
        }

        renderTable(message);
        total += 1;

        if (total >= max) {
          finish();
        }
      });

      const onSigInt = () => {
        finish();
      };

      const finish = () => {
        if (done) {
          return;
        }

        done = true;
        process.off("SIGINT", onSigInt);
        stop();
        client.close();
        resolve();
      };

      process.on("SIGINT", onSigInt);
    });
  }

  export function renderTable(message: Message): void {
    tableRows(
      [message],
      [
        {
          id: "id",
          header: "id",
          value: (row) => String(row.id),
          flex: 0,
          noTruncate: true,
          truncate: "end",
          format: (value) => defaultTheme.code(value),
        },
        {
          id: "chat",
          header: "chat",
          value: (row) => String(row.chatId),
          flex: 0,
          noTruncate: true,
          truncate: "end",
          format: (value) => defaultTheme.dim(value),
        },
        {
          id: "time",
          header: "time",
          value: (row) => DateFormatter.format(row.createdAt),
          flex: 0,
          noTruncate: true,
          truncate: "end",
          format: (value) => defaultTheme.dim(value),
        },
        {
          id: "from",
          header: "from",
          value: (row) => (row.isFromMe ? "me" : row.sender || "(unknown)"),
          flex: 1,
          truncate: "end",
          format: (value) => defaultTheme.primary(value),
        },
        {
          id: "text",
          header: "text",
          value: (row) => row.text,
          flex: 2,
          truncate: "end",
        },
      ],
    );
  }
}

export const watch: CommandDef = {
  description: "Watch for incoming messages",
  summary: "Stream live messages",
  options: WatchCommand.options,
  handler: async (argv) => {
    await WatchCommand.run(argv as Record<string, unknown>);
  },
};
