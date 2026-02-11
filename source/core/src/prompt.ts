import { Context } from "./context.ts";
import { Skill } from "./skill.ts";
import { Task } from "./task.ts";
import system from "./prompts/system.md" with { type: "text" };
import task from "./prompts/task.md" with { type: "text" };
import taskMissing from "./prompts/task-missing.md" with { type: "text" };

const defaults: Record<string, string> = {
  system,
  task,
  "task-missing": taskMissing,
};

async function render(
  template: string,
  vars: Record<string, string> = {},
): Promise<string> {
  const data = { ...(await builtins()), ...vars };
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function formatSkills(skills: Skill.List): string {
  return Object.values(skills)
    .map((s) => `- ${s.metadata.name}: ${s.metadata.description}`)
    .join("\n");
}

function formatTasks(tasks: Task.List): string {
  const values = Object.values(tasks);
  if (values.length === 0) return "- none";
  return values
    .map((t) => `- ${t.metadata.name}: ${t.metadata.description}`)
    .join("\n");
}

function formatTaskSkills(skills: Skill.Resolved[]): string {
  if (skills.length === 0) return "- none";
  return skills
    .map((s) => `## ${s.metadata.name}\n\n${s.content}`)
    .join("\n\n");
}

async function builtins(): Promise<Record<string, string>> {
  const skills = await Context.skills();
  const tasks = await Context.tasks();
  return {
    "steve.skills": formatSkills(skills),
    "steve.tasks": formatTasks(tasks),
    "steve.prompt": "",
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
    return render(template, vars);
  }

  export async function task(name: string): Promise<string> {
    const task = await Task.get(name);
    if (!task) {
      const template = await getTemplate("task-missing");
      return render(template, {
        "steve.task.name": name,
      });
    }

    const skills = await Promise.all(
      task.metadata.skills.map((name) => Skill.get(name)),
    );
    const list = skills.filter((skill) => skill !== undefined);
    const missing = task.metadata.skills.filter(
      (name) => !list.some((skill) => skill.metadata.name === name),
    );

    const template = await getTemplate("task");
    return render(template, {
      "steve.task.name": task.metadata.name,
      "steve.task.description": task.metadata.description,
      "steve.task.scopes": task.metadata.scopes.join(", "),
      "steve.task.content": task.content,
      "steve.task.skills": formatTaskSkills(list),
      "steve.task.skills.missing": missing.join(", "),
    });
  }
}
