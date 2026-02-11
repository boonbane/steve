#!/usr/bin/env bun

import { build, type CliDef } from "../shared/yargs.ts";
import { chats } from "./commands/index.ts";

export namespace IMsgCli {
  export const def: CliDef = {
    name: "imessage",
    description: "Read iMessage chats from macOS Messages database",
    commands: {
      chats,
    },
  };

  export function run(): void {
    build(def).parse();
  }
}

IMsgCli.run();
