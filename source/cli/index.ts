#!/usr/bin/env bun
import { build, type CliDef } from "./src/cli/index.ts";
import { ios } from "./src/ios/index.ts";

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
