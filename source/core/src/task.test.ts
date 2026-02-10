import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Context } from "./context.ts";
import { Task } from "./task.ts";

let root = "";

type Item = {
  name: string;
  md?: string;
  json?: unknown;
  jsonText?: string;
};

async function tmpRoot(label: string): Promise<string> {
  root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `steve-task-test-${label}-`),
  );
  return root;
}

async function writeTasks(root: string, items: Item[]) {
  for (const item of items) {
    const dir = path.join(root, "tasks", item.name);
    await fs.promises.mkdir(dir, { recursive: true });
    if (item.md !== undefined) {
      await Bun.write(path.join(dir, "task.md"), item.md);
    }
    if (item.json !== undefined) {
      await Bun.write(path.join(dir, "task.json"), JSON.stringify(item.json));
    }
    if (item.jsonText !== undefined) {
      await Bun.write(path.join(dir, "task.json"), item.jsonText);
    }
  }
}

async function loadTasks(items: Item[]): Promise<Task.List> {
  const root = await tmpRoot("load");
  await writeTasks(root, items);
  Context.setDir(root);
  return Context.tasks();
}

afterEach(async () => {
  Context.reset();
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  root = "";
});

describe("Task", () => {
  it("loads empty list when tasks dir does not exist", async () => {
    const tasks = await loadTasks([]);
    expect(Object.keys(tasks)).toHaveLength(0);
  });

  it("loads valid task metadata and content", async () => {
    const tasks = await loadTasks([
      {
        name: "mytask",
        md: "Do the thing",
        json: {
          name: "mytask",
          description: "Test task",
          skills: ["git", "search"],
          scopes: ["repo"],
        },
      },
    ]);

    expect(Object.keys(tasks)).toHaveLength(1);
    expect(tasks.mytask?.metadata.name).toBe("mytask");
    expect(tasks.mytask?.metadata.skills).toEqual(["git", "search"]);
    expect(tasks.mytask?.metadata.scopes).toEqual(["repo"]);
    expect(tasks.mytask?.content).toBe("Do the thing");
  });

  it("skips invalid task states", async () => {
    const loaded = await loadTasks([
      {
        name: "missing-md",
        json: {
          name: "missing-md",
          description: "bad",
          skills: ["s"],
          scopes: ["x"],
        },
      },
      {
        name: "missing-json",
        md: "x",
      },
      {
        name: "wrong-shape",
        md: "x",
        json: {
          name: "wrong-shape",
          description: "bad",
        },
      },
      {
        name: "bad-json",
        md: "x",
        jsonText: "{not-valid-json",
      },
      {
        name: "valid",
        md: "good",
        json: {
          name: "valid",
          description: "ok",
          skills: ["read"],
          scopes: ["repo"],
        },
      },
    ]);

    expect(Object.keys(loaded)).toEqual(["valid"]);
  });

  it("loads from context dir", async () => {
    const tasks = await loadTasks([
      {
        name: "alpha",
        md: "The alpha task",
        json: {
          name: "alpha",
          description: "a",
          skills: ["s1"],
          scopes: ["scope-a"],
        },
      },
    ]);

    expect(Object.keys(tasks)).toEqual(["alpha"]);
    expect((await Task.get("alpha"))?.metadata.name).toBe("alpha");
  });

  it("setDir invalidates cached tasks", async () => {
    const root = await tmpRoot("invalidate");

    await writeTasks(root, [
      {
        name: "alpha",
        md: "alpha",
        json: {
          name: "alpha",
          description: "a",
          skills: ["s1"],
          scopes: ["scope-a"],
        },
      },
    ]);

    Context.setDir(root);
    const first = await Context.tasks();
    expect(Object.keys(first)).toEqual(["alpha"]);

    await fs.promises.rm(path.join(root, "tasks"), {
      recursive: true,
      force: true,
    });

    await writeTasks(root, [
      {
        name: "beta",
        md: "beta",
        json: {
          name: "beta",
          description: "b",
          skills: ["s2"],
          scopes: ["scope-b"],
        },
      },
    ]);

    Context.setDir(root);
    const second = await Context.tasks();
    expect(Object.keys(second)).toEqual(["beta"]);
  });
});
