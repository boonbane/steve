import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Context } from "./context.ts";
import { Trigger } from "./trigger.ts";

let root = "";

async function tmpRoot(label: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp", "core-trigger-test");
  await fs.promises.mkdir(base, { recursive: true });
  root = await fs.promises.mkdtemp(path.join(base, `${label}-`));
  return root;
}

afterEach(async () => {
  await Context.reset();
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  root = "";
});

describe("Trigger", () => {
  it("loads cron and script triggers from config", async () => {
    const root = await tmpRoot("load");
    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        triggers: [
          {
            name: "hourly",
            kind: "cron",
            cron: "0 * * * *",
            task: "cleanup",
          },
          {
            name: "startup",
            kind: "script",
            path: "scripts/start.ts",
            task: "boot",
          },
        ],
      },
    });

    const triggers = Context.triggers();
    expect(Object.keys(triggers)).toEqual(["hourly", "startup"]);
    expect(triggers.hourly).toEqual({
      name: "hourly",
      kind: "cron",
      cron: "0 * * * *",
      task: "cleanup",
    });
    expect(Trigger.get("startup")).toEqual({
      name: "startup",
      kind: "script",
      path: "scripts/start.ts",
      task: "boot",
    });
  });

  it("setDir invalidates cached triggers", async () => {
    const root = await tmpRoot("invalidate");
    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        triggers: [
          {
            name: "alpha",
            kind: "cron",
            cron: "* * * * *",
            task: "a",
          },
        ],
      },
    });

    const first = Context.triggers();
    expect(Object.keys(first)).toEqual(["alpha"]);

    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        triggers: [
          {
            name: "beta",
            kind: "script",
            path: "scripts/beta.ts",
            task: "b",
          },
        ],
      },
    });

    const second = Context.triggers();
    expect(Object.keys(second)).toEqual(["beta"]);
  });

  it("assigns generated names when omitted", async () => {
    const root = await tmpRoot("generated");
    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        triggers: [
          {
            kind: "cron",
            cron: "* * * * *",
            task: "a",
          },
        ],
      },
    });

    const triggers = Context.triggers();
    expect(Object.keys(triggers)).toEqual(["trigger-1"]);
    expect(triggers["trigger-1"]?.name).toBe("trigger-1");
  });
});
