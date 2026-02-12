#!/usr/bin/env bun
import consola from "consola";
import { Client } from "@steve/sdk/client";
import { build, type CliDef, type CommandDef } from "./cli/index.ts";
import { ios } from "./ios/index.ts";

const serve: CommandDef = {
  description: "Start the Steve server",
  handler: async () => {
    const client = await Client.connect();
    const result = await client.health();
    if (result && !result.error && result.data) {
      const uptime = Math.floor(result.data.uptime);
      consola.info(
        `server already running url=${Client.url()} uptime=${uptime}s`,
      );
      return;
    }

    const { Server } = await import("@steve/server");
    Server.start();
  },
};

const status: CommandDef = {
  description: "Check server health",
  handler: async () => {
    const client = await Client.connect();
    const result = await client.health();

    if (!result || result.error || !result.data) {
      const error = result?.error ?? "no response";
      consola.error(`status=down url=${Client.url()} error=${String(error)}`);
      process.exit(1);
      return;
    }

    const uptime = Math.floor(result.data.uptime);
    consola.success(`status=${result.data.status} uptime=${uptime}s`);
  },
};

const promptSystem: CommandDef = {
  description: "Compile the system prompt",
  positionals: {
    text: {
      type: "string",
      description: "Optional prompt text for {{steve.prompt}}",
    },
  },
  handler: async (argv) => {
    const { Prompt } = await import("@steve/core");
    const text = typeof argv.text === "string" ? argv.text : "";
    const result = Prompt.system({
      "steve.prompt": text,
    });
    process.stdout.write(`${result}\n`);
  },
};

const promptTask: CommandDef = {
  description: "Compile a task prompt",
  positionals: {
    task: {
      type: "string",
      description: "Task name",
      required: true,
    },
  },
  handler: async (argv) => {
    const { Prompt } = await import("@steve/core");
    const task = String(argv.task);
    const result = Prompt.task(task);
    process.stdout.write(`${result}\n`);
  },
};

const prompt: CommandDef = {
  description: "Compile Steve prompts",
  commands: {
    system: promptSystem,
    task: promptTask,
  },
};

function main() {
  const def: CliDef = {
    name: "steve",
    description: "Steve development tools",
    commands: {
      serve,
      status,
      prompt,
      ios,
    },
  };

  build(def).parse();
}

main();
