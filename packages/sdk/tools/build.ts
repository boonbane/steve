#!/usr/bin/env bun

import { $ } from "bun";
import path from "path";
import { logger } from "@steve/core";
import { App } from "@steve/server";

async function main() {
  const dir = path.resolve(import.meta.dir, "..");
  process.chdir(dir);

  logger.info("Generating OpenAPI spec");
  const spec = await App.spec();
  await Bun.write("./openapi.json", JSON.stringify(spec, null, 2));
  logger.info("Wrote openapi.json");

  logger.info("Generating TypeScript SDK");
  const { createClient } = await import("@hey-api/openapi-ts");

  await createClient({
    input: "./openapi.json",
    output: {
      path: "./src/gen",
      clean: true,
    },
    plugins: [
      { name: "@hey-api/typescript" },
      {
        name: "@hey-api/sdk",
        operations: {
          strategy: "single",
          containerName: "SteveClient",
          methods: "instance",
        },
        paramsStructure: "flat",
      },
      { name: "@hey-api/client-fetch" },
    ],
  });

  logger.info("Formatting generated SDK");
  await $`bun prettier --write src/gen`.quiet();
  await $`rm openapi.json`;
  logger.info("SDK generation complete");
}

main();
