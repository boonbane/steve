import path from "path";
import fs from "fs";
import { z } from "zod/v4";
import { Context, logger } from "./context.ts";
import { Json } from "./json.ts";

export namespace Task {
  const Schema = z.object({
    name: z.string(),
    description: z.string(),
    skills: z.array(z.string()),
    scopes: z.array(z.string()),
  });

  export type Metadata = z.infer<typeof Schema>;

  export interface Resolved {
    metadata: Metadata;
    content: string;
    dir: string;
  }

  export type List = Record<string, Resolved>;

  const getPaths = (dir: string) => {
    return {
      md: path.join(dir, "task.md"),
      json: path.join(dir, "task.json"),
      data: path.join(dir, "task"),
    };
  };

  function validate(dir: string): Resolved | undefined {
    const { md, json } = getPaths(dir);
    if (!fs.existsSync(md)) return undefined;
    if (!fs.existsSync(json)) return undefined;

    const data = Json.tryParseFile(json);
    if (data.type !== "ok") return undefined;

    const result = Schema.safeParse(data.data);
    if (!result.success) return undefined;

    return {
      metadata: result.data,
      content: fs.readFileSync(md, "utf8"),
      dir,
    };
  }

  export function load(): List {
    const tasks: List = {};

    const dirs = Context.dirs();
    if (!fs.existsSync(dirs.tasks)) return tasks;

    const entries = fs.readdirSync(dirs.tasks, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const task = validate(path.join(dirs.tasks, entry.name));
      if (!task) {
        logger.info(`"${entry.name}" was not a valid task`);
        continue;
      }

      logger.info(task, `Loaded task "${task.metadata.name}"`);
      tasks[task.metadata.name] = task;
    }

    return tasks;
  }

  export function get(name: string): Resolved | undefined {
    const all = Context.tasks();
    return all[name];
  }
}
