import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { z } from "zod/v4";
import { logger } from "../src/context.ts";
import { Schema as ConfigSchema } from "../src/config.ts";

const OUT = resolve(import.meta.dir, "../src/gen/config.json");

function main() {
  const schema = z.toJSONSchema(ConfigSchema);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(schema, null, 2) + "\n");
  logger.info(`Generated ${OUT}`);
}

main();
