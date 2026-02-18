#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

namespace NativeTool {
  const root = path.resolve(import.meta.dir, "..");
  const native = path.join(root, "native");
  const cache = path.join(root, ".cache");
  const build = path.join(cache, "build", "native");
  const store = path.join(cache, "store");
  const lib = path.join(store, "lib");
  const include = path.join(store, "include");

  function run(cmd: string, args: string[]): string {
    const proc = spawnSync(cmd, args, {
      cwd: native,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    if (proc.status !== 0) {
      if (proc.stdout) {
        process.stdout.write(proc.stdout);
      }

      if (proc.stderr) {
        process.stderr.write(proc.stderr);
      }

      throw new Error(`${cmd} ${args.join(" ")} failed`);
    }

    if (proc.stdout) {
      process.stdout.write(proc.stdout);
    }

    if (proc.stderr) {
      process.stderr.write(proc.stderr);
    }

    return proc.stdout.trim();
  }

  async function buildNative() {
    await mkdir(build, { recursive: true });
    await mkdir(lib, { recursive: true });
    await mkdir(include, { recursive: true });

    run("swift", [
      "build",
      "-c",
      "release",
      "--product",
      "imsg",
      "--build-path",
      build,
    ]);

    const bin = run("swift", [
      "build",
      "-c",
      "release",
      "--product",
      "imsg",
      "--build-path",
      build,
      "--show-bin-path",
    ]);

    await cp(path.join(bin, "libimsg.dylib"), path.join(lib, "libimsg.dylib"));
    await cp(path.join(native, "imsg.h"), path.join(include, "imsg.h"));
  }

  async function cleanNative() {
    await rm(build, { recursive: true, force: true });
    await rm(path.join(lib, "libimsg.dylib"), { force: true });
    await rm(path.join(include, "imsg.h"), { force: true });
  }

  export async function main() {
    await yargs(hideBin(process.argv))
      .scriptName("native.ts")
      .command(
        "build",
        "build native contacts dylib",
        () => {},
        async () => {
          await buildNative();
        },
      )
      .command(
        "clean",
        "clean native build artifacts",
        () => {},
        async () => {
          await cleanNative();
        },
      )
      .demandCommand(1)
      .strictCommands()
      .parseAsync();
  }
}

await NativeTool.main();
