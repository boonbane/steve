#!/usr/bin/env bun
import consola from "consola";
import { Client } from "@steve/sdk/client";
import { build, type CliDef, type CommandDef } from "./cli/index.ts";
import { ios } from "./ios/index.ts";

const serve: CommandDef = {
  description: "Start the Steve server",
  handler: async () => {
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

function main() {
  const def: CliDef = {
    name: "steve",
    description: "Steve development tools",
    commands: {
      serve,
      status,
      ios,
    },
  };

  build(def).parse();
}

main();
