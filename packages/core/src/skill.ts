import path from "path";
import fs from "fs";
import { z } from "zod/v4";
import { Context } from "./context.ts";
import { Json } from "./json.ts";

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
    const skills: List = {};

    const dirs = Context.dirs();
    if (!fs.existsSync(dirs.skills)) return skills;

    const entries = fs.readdirSync(dirs.skills, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = validate(path.join(dirs.skills, entry.name));
      if (!skill) continue;

      skills[skill.metadata.name] = skill;
    }

    return skills;
  }

  export function get(name: string): Resolved | undefined {
    const all = Context.skills();
    return all[name];
  }
}
