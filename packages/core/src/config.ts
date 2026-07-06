import path from "path";
import fs from "fs";
import { z } from "zod/v4";

const Environment = z.object({
  skills: z.array(z.string()),
  scopes: z.array(z.string()),
});

const Trigger = z.discriminatedUnion("kind", [
  z.object({
    name: z.string().optional(),
    kind: z.literal("cron"),
    cron: z.string(),
    task: z.string(),
  }),
  z.object({
    name: z.string().optional(),
    kind: z.literal("script"),
    path: z.string(),
    task: z.string(),
  }),
]);

export const Schema = z.object({
  dir: z.string().describe("Root config directory for steve").optional(),
  data: z.string().describe("Root data directory for steve").optional(),
  environments: z.record(z.string(), Environment).default({}),
  triggers: z.array(Trigger).default([]),
  plugins: z
    .object({
      imessage: z
        .object({
          url: z
            .string()
            .describe("Hostname or base URL of the iMessage server")
            .optional(),
          port: z
            .number()
            .int()
            .describe("Port of the iMessage server (default 8787)")
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export namespace Config {
  export type Plugins = z.infer<typeof Schema>["plugins"];
  export type Resolved = z.infer<typeof Schema> & {
    dir: string;
    data: string;
  };

  const envOr = (envVar: string, value: string) => {
    return process.env[envVar] ?? path.resolve(process.env.HOME!, value);
  };

  export function load(): Resolved {
    const data = envOr("STEVE_DATA_DIR", ".local/share/steve");
    const dir = envOr("STEVE_CONFIG_DIR", ".config/steve");
    const file = path.join(dir, "steve.json");

    if (!fs.existsSync(file)) {
      return {
        dir,
        data,
        environments: {},
        triggers: [],
      };
    }

    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const config = Schema.parse(json);
    return {
      dir: config.dir ?? dir,
      data: config.data ?? data,
      environments: config.environments,
      triggers: config.triggers,
      plugins: config.plugins,
    };
  }
}
