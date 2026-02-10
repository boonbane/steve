#!/usr/bin/env bun
import { build, type CliDef } from "./cli/index.ts";
import { ios } from "./ios/index.ts";

function main() {
  const def: CliDef = {
    name: "steve",
    description: "Steve development tools",
    commands: {
      ios,
    },
  };

  build(def).parse();
}

main();
