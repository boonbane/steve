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
    table(
      ["id", "chat", "time", "from", "text"],
      [
        [String(message.id)],
        [String(message.chatId)],
        [DateFormatter.format(message.createdAt)],
        [message.isFromMe ? "me" : message.sender || "(unknown)"],
        [message.text],
      ],
      {
        flex: [0, 0, 0, 1, 2],
        noTruncate: [true, true, true, false, false],
        truncate: ["end", "end", "end", "end", "end"],
        format: [
          (value) => defaultTheme.code(value),
          (value) => defaultTheme.dim(value),
          (value) => defaultTheme.dim(value),
          (value) => defaultTheme.primary(value),
          (value) => value,
        ],
      },
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
