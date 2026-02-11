import { z } from "zod/v4";
import { Client, Options } from "../../index.ts";
import { defaultTheme } from "../../shared/theme.ts";
import type { CommandDef } from "../../shared/yargs.ts";

const Args = z.object({
  chatId: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
  db: z.string().default(Options.parse({}).dbPath),
});

export namespace SendCommand {
  export const positionals = {
    chatId: {
      type: "number",
      description: "Chat row id",
      required: true,
    },
    text: {
      type: "string",
      description: "Message text",
      required: true,
    },
  } as const;

  export const options = {
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
      text: typeof argv.text === "string" ? argv.text : undefined,
      db: typeof argv.db === "string" ? argv.db : undefined,
    });

    const client = Client({ dbPath: args.db });

    try {
      client.send(args.chatId, args.text);
    } finally {
      client.close();
    }

    process.stdout.write(`${defaultTheme.primary("sent")}\n`);
  }
}

export const send: CommandDef = {
  description: "Send a message to a chat",
  summary: "Send text",
  positionals: SendCommand.positionals,
  options: SendCommand.options,
  handler: (argv) => {
    SendCommand.run(argv as Record<string, unknown>);
  },
};
