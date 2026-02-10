import { join, resolve } from "path";
import { z } from "zod/v4";


export const Schema = z.object({
  dir: z.string().describe("Root config directory for steve").optional(),
});

export namespace Config {
  export type Resolved = { dir: string };

  export async function load(): Promise<Resolved> {
    const dir =
      process.env.STEVE_CONFIG_DIR ??
      resolve(process.env.HOME!, ".config/steve");
    const path = join(dir, "steve.json")

    const file = Bun.file(path);
    if (!await file.exists()) {
      return { dir };
    }

    const raw = Schema.parse(await file.json());
    return {
      dir: raw.dir ?? dir
    };
  }
}
