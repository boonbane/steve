import { z } from "zod/v4";
import { Context } from "../context.ts";
import { SQL } from "../sql.ts";

export namespace App {
  export const Info = z.object({
    key: z.string(),
    value: z.string(),
  });

  export type Info = z.infer<typeof Info>;

  export async function get(key: string): Promise<string | undefined> {
    const db = await Context.db();
    const row = db.query(SQL.APP_GET).get(key) as {
      key: string;
      value: string;
    } | null;

    if (!row) return undefined;
    return row.value;
  }

  export async function set(key: string, value: string): Promise<Info> {
    const db = await Context.db();
    db.query(SQL.APP_SET).run(key, value);

    return Info.parse({
      key,
      value,
    });
  }
}
