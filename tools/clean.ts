#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import { consola } from "consola";

async function main() {
  const cwd = process.cwd();
  const extra = process.argv.slice(2);
  const targets = [
    ".turbo",
    "dist",
    "dist-ssr",
    "tsconfig.tsbuildinfo",
    "tsconfig.node.tsbuildinfo",
    ...extra,
  ];
  const names = [...new Set(targets)];
  await Promise.all(
    names.map((name) =>
      fs.promises.rm(path.join(cwd, name), { recursive: true, force: true }),
    ),
  );
  consola.success(`cleaned ${cwd}`);
}

await main();
