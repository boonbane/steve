import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Context } from "./context.ts";
import { Prompt } from "./prompt.ts";

let root = "";

async function dir(label: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp", "core-prompt-test");
  await fs.promises.mkdir(base, { recursive: true });
  root = await fs.promises.mkdtemp(path.join(base, `${label}-`));
  return root;
}

async function writeTask(
  root: string,
  name: string,
  input: { description: string; visible: boolean },
) {
  const dir = path.join(root, "tasks", name);
  await fs.promises.mkdir(dir, { recursive: true });
  await Bun.write(path.join(dir, "task.md"), `${name} task`);
  await Bun.write(
    path.join(dir, "task.json"),
    JSON.stringify({
      name,
      description: input.description,
      environment: "default",
      visible: input.visible,
    }),
  );
}

afterEach(async () => {
  await Context.reset();
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  root = "";
});

describe("Prompt", () => {
  it("only includes visible tasks in system prompt", async () => {
    const value = await dir("system");
    await writeTask(value, "visible-task", {
      description: "Shown to agents",
      visible: true,
    });
    await writeTask(value, "hidden-task", {
      description: "Hidden from agents",
      visible: false,
    });
    await Context.setDir(value);
    Context.override({
      config: {
        ...Context.config(),
        environments: {
          default: {
            skills: [],
            scopes: [],
          },
        },
      },
    });

    const result = Prompt.system();
    expect(result).toContain("visible-task");
    expect(result).not.toContain("hidden-task");
  });
});
