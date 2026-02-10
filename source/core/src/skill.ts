import path from "path";
import fs from "fs";
import { z } from "zod/v4";
import { Context } from "./context.ts";

export namespace Skill {
  const Schema = z.object({
    name: z.string(),
    description: z.string(),
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
      md: path.join(dir, "skill.md"),
      json: path.join(dir, "skill.json"),
      data: path.join(dir, "skill"),
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

    const result = Schema.safeParse(await json.json());
    if (!result.success) return undefined;

    return {
      metadata: result.data,
      content: await md.text(),
      dir,
    };
  }

  export async function load(): Promise<List> {
    const skills: List = {};

    const dirs = await Context.dirs();
    if (!fs.existsSync(dirs.skills)) return skills;

    const entries = fs.readdirSync(dirs.skills, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = await validate(path.join(dirs.skills, entry.name));
      if (!skill) continue;

      skills[skill.metadata.name] = skill;
    }

    return skills;
  }

  export async function get(name: string): Promise<Resolved | undefined> {
    const all = await load();
    return all[name];
  }
}
