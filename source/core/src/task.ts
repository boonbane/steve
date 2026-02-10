import path from "path";
import fs from "fs";
import { z } from "zod/v4";
import { Context } from "./context.ts";

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

  const getFiles = (dir: string) => {
    const { md, json } = getPaths(dir);
    return {
      md: Bun.file(md),
      json: Bun.file(json),
    };
  };

  async function validate(dir: string): Promise<Resolved | undefined> {
    const { md, json } = getFiles(dir);
    if (!(await md.exists())) return undefined;
    if (!(await json.exists())) return undefined;

    const data = await json.json().catch(() => undefined);
    if (data === undefined) return undefined;

    const result = Schema.safeParse(data);
    if (!result.success) return undefined;

    return {
      metadata: result.data,
      content: await md.text(),
      dir,
    };
  }

  export async function load(): Promise<List> {
    const tasks: List = {};

    const dirs = await Context.dirs();
    if (!fs.existsSync(dirs.tasks)) return tasks;

    const entries = fs.readdirSync(dirs.tasks, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const task = await validate(path.join(dirs.tasks, entry.name));
      if (!task) continue;

      tasks[task.metadata.name] = task;
    }

    return tasks;
  }

  export async function get(name: string): Promise<Resolved | undefined> {
    const all = await load();
    return all[name];
  }
}
