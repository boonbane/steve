import { join, resolve } from "path";
import { z } from "zod/v4";

export const Schema = z.object({
  dir: z.string().describe("Root config directory for steve").optional(),
  data: z.string().describe("Root data directory for steve").optional(),
});

export namespace Config {
  export type Resolved = { dir: string; data: string };

  export async function load(): Promise<Resolved> {
    const dir =
      process.env.STEVE_CONFIG_DIR ??
      resolve(process.env.HOME!, ".config/steve");
    const data =
      process.env.STEVE_DATA_DIR ??
      resolve(process.env.HOME!, ".local/share/steve");
    const path = join(dir, "steve.json");

    const file = Bun.file(path);
    if (!(await file.exists())) {
      return { dir, data };
    }

    const raw = Schema.parse(await file.json());
    return {
      dir: raw.dir ?? dir,
      data: raw.data ?? data,
    };
  }
}
