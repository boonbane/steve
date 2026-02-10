#!/usr/bin/env bun

import { $ } from "bun";
import consola from "consola";
import path from "path";
import { App } from "@steve/server";

async function main() {
  const dir = path.resolve(import.meta.dir, "..");
  process.chdir(dir);

  consola.info("Generating OpenAPI spec");
  const spec = await App.spec();
  await Bun.write("./openapi.json", JSON.stringify(spec, null, 2));
  consola.success("Wrote openapi.json");

  consola.info("Generating TypeScript SDK");
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

  consola.info("Formatting generated SDK");
  await $`bun prettier --write src/gen`.quiet();
  consola.success("SDK generation complete");
}

main();
