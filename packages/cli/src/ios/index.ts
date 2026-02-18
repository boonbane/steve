import { screenshot } from "./screenshot.ts";
import type { CommandDef } from "../cli/yargs.ts";

export const ios: CommandDef = {
  description: "iOS development tools",
  commands: {
    screenshot,
  },
};
