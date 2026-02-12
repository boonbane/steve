#!/usr/bin/env bun

import { build, type CliDef } from "./yargs.ts";
import { chats, history, send, watch } from "./commands/index.ts";

export namespace IMsgCli {
  export const def: CliDef = {
    name: "imessage",
    description: "Read iMessage chats from macOS Messages database",
    commands: {
      chats,
      history,
      send,
      watch,
    },
  };

  export function run(): void {
    build(def).parse();
  }
}

IMsgCli.run();
