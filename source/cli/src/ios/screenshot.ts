import { $ } from "bun";
import consola from "consola";
import path from "path";
import type { CommandDef } from "../cli/yargs.ts";

const DIR = ".cache/ios/screenshot";

export const screenshot: CommandDef = {
  description: "Take a screenshot of the iOS simulator",
  options: {
    device: {
      alias: "d",
      type: "string",
      description: "Simulator device name or UDID",
      default: "booted",
    },
  },
  handler: async (argv) => {
    const device = argv.device as string;
    const dir = path.resolve(DIR);
    await $`mkdir -p ${dir}`.quiet();

    const name = `${new Date().toISOString().replaceAll(":", "-")}.png`;
    const file = path.join(dir, name);

    consola.info(`capturing screenshot from "${device}"...`);
    const result =
      await $`xcrun simctl io ${device} screenshot ${file}`.quiet();
    if (result.exitCode !== 0) {
      consola.error("screenshot failed:", result.stderr.toString());
      process.exit(1);
    }

    consola.success(file);
  },
};
