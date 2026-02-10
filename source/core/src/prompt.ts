import { Context } from "./context.ts";
import { Skill } from "./skill.ts";
import system from "./prompts/system.md" with { type: "text" };

const defaults: Record<string, string> = {
  system,
};

function render(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function formatSkills(skills: Skill.List): string {
  return Object.values(skills)
    .map((s) => `- ${s.metadata.name}: ${s.metadata.description}`)
    .join("\n");
}

async function builtins(): Promise<Record<string, string>> {
  const skills = await Context.skills();
  return {
    "steve.skills": formatSkills(skills),
  };
}

async function getTemplate(name: string): Promise<string> {
  const dirs = await Context.dirs();

  const override = Bun.file(dirs.prompt(name));
  if (await override.exists()) {
    return override.text();
  }

  const builtin = defaults[name];
  if (builtin) {
    return builtin;
  }

  return "";
}

export namespace Prompt {
  export async function system(vars?: Record<string, string>): Promise<string> {
    const template = await getTemplate("system");
    return render(template, { ...(await builtins()), ...vars });
  }
}
