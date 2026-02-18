import { join, resolve } from "path";
import fs from "fs";
import { z } from "zod/v4";

export const Schema = z.object({
  dir: z.string().describe("Root config directory for steve").optional(),
  data: z.string().describe("Root data directory for steve").optional(),
});

export namespace Config {
  export type Resolved = { dir: string; data: string };

  const envOr = (envVar: string, path: string) => {
    return process.env[envVar] ?? resolve(process.env.HOME!, path);
  };

  export function load(): Resolved {
    const data = envOr("STEVE_DATA_DIR", ".local/share/steve");
    const dir = envOr("STEVE_CONFIG_DIR", ".config/steve");
    const path = join(dir, "steve.json");

    if (!fs.existsSync(path)) {
      return { dir, data };
    }

    const json = JSON.parse(fs.readFileSync(path, "utf8"));
    const config = Schema.parse(json);
    return {
      dir: config.dir ?? dir,
      data: config.data ?? data,
    };
  }
}
