import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Context } from "./context.ts";
import { Environment } from "./environment.ts";

let root = "";

async function tmpRoot(label: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp", "core-environment-test");
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

describe("Environment", () => {
  it("loads environments from config", async () => {
    const root = await tmpRoot("load");
    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        environments: {
          default: {
            skills: ["git", "search"],
            scopes: ["repo", "docs"],
          },
        },
      },
    });

    const environments = Context.environments();
    expect(Object.keys(environments)).toEqual(["default"]);
    expect(environments.default).toEqual({
      name: "default",
      skills: ["git", "search"],
      scopes: ["repo", "docs"],
    });
    expect(Environment.get("default")?.scopes).toEqual(["repo", "docs"]);
  });

  it("setDir invalidates cached environments", async () => {
    const root = await tmpRoot("invalidate");
    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        environments: {
          alpha: {
            skills: ["s1"],
            scopes: ["scope-a"],
          },
        },
      },
    });

    const first = Context.environments();
    expect(Object.keys(first)).toEqual(["alpha"]);

    await Context.setDir(root);
    Context.override({
      config: {
        ...Context.config(),
        environments: {
          beta: {
            skills: ["s2"],
            scopes: ["scope-b"],
          },
        },
      },
    });

    const second = Context.environments();
    expect(Object.keys(second)).toEqual(["beta"]);
  });
});
