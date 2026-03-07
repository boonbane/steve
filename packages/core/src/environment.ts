import { z } from "zod/v4";
import { Context } from "./context.ts";

export namespace Environment {
  export const Schema = z.object({
    name: z.string(),
    skills: z.array(z.string()),
    scopes: z.array(z.string()),
  });

  export type Metadata = z.infer<typeof Schema>;
  export type Resolved = Metadata;
  export type List = Record<string, Resolved>;

  export function load(): List {
    const result: List = {};
    const all = Context.config().environments;
    for (const [name, value] of Object.entries(all)) {
      result[name] = Schema.parse({
        name,
        ...value,
      });
    }
    return result;
  }

  export function get(name: string): Resolved | undefined {
    const all = Context.environments();
    return all[name];
  }
}
