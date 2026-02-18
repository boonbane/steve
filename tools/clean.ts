#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import { consola } from "consola";

async function main() {
  const cwd = process.cwd();
  const isRepoRoot =
    fs.existsSync(path.join(cwd, "turbo.json")) &&
    fs.existsSync(path.join(cwd, "package.json"));
  const targets = [
    ".turbo",
    "dist",
    "tsconfig.tsbuildinfo",
    ...(isRepoRoot ? ["node_modules"] : [])
  ];
  await Promise.all(
    targets.map((name) =>
      fs.promises.rm(path.join(cwd, name), { recursive: true, force: true }),
    ),
  );
  consola.success(`cleaned ${cwd}`);
}

await main();
