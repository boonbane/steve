import { afterEach, describe, expect, it } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "fs";
import os from "os";
import path from "path";
import { App } from "./db.ts";
import { Context } from "./context.ts";
import { Opencode } from "./opencode.ts";

let root = "";
let server: Bun.Server | undefined;

async function dir(label: string): Promise<string> {
  root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `steve-opencode-test-${label}-`),
  );
  return root;
}

afterEach(async () => {
  if (server) {
    await server.stop(true);
  }
  Opencode.reset();
  await Context.reset();
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  root = "";
  server = undefined;
});

describe("Opencode", () => {
  it("attaches to saved healthy port", async () => {
    const root = await dir("attach");
    await Context.setDir(root);

    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/global/health") {
          return Response.json({ healthy: true, version: "test" });
        }
        return new Response("not found", { status: 404 });
      },
    });

    await App.set("opencode.port", String(server.port));

    let started = 0;
    Opencode.override({
      start: async () => {
        started += 1;
        throw new Error("should not start when health is alive");
      },
    });

    const runtime = await Opencode.load();
    expect(runtime.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(started).toBe(0);
  });

  it("starts a new server and persists the selected port", async () => {
    const root = await dir("start");
    await Context.setDir(root);
    await App.set("opencode.port", "43100");

    const called: number[] = [];
    Opencode.override({
      health: async () => false,
      start: async (input) => {
        const port = Number(input?.port);
        called.push(port);

        const url = `http://127.0.0.1:${port}`;
        const client = createOpencodeClient({ baseUrl: url });
        return {
          client,
          server: {
            url,
            close: () => {},
          },
        };
      },
    });

    const runtime = await Opencode.load();
    expect(runtime.url).toBe("http://127.0.0.1:43100");
    expect(called).toEqual([43100]);
    expect(await App.get("opencode.port")).toBe("43100");
  });

  it("falls back to the next port when saved port fails", async () => {
    const root = await dir("fallback");
    await Context.setDir(root);
    await App.set("opencode.port", "43100");

    const called: number[] = [];
    Opencode.override({
      health: async () => false,
      start: async (input) => {
        const port = Number(input?.port);
        called.push(port);
        if (port === 43100) {
          throw new Error("busy");
        }

        const url = `http://127.0.0.1:${port}`;
        const client = createOpencodeClient({ baseUrl: url });
        return {
          client,
          server: {
            url,
            close: () => {},
          },
        };
      },
    });

    const runtime = await Opencode.load();
    expect(runtime.url).toBe("http://127.0.0.1:43101");
    expect(called.slice(0, 2)).toEqual([43100, 43101]);
    expect(await App.get("opencode.port")).toBe("43101");
  });

  it("setDir closes an existing opencode runtime", async () => {
    const root = await dir("setdir-close");
    await Context.setDir(root);

    let closed = 0;
    Opencode.override({
      health: async () => false,
      start: async (input) => {
        const port = Number(input?.port);
        const url = `http://127.0.0.1:${port}`;
        const client = createOpencodeClient({ baseUrl: url });
        return {
          client,
          server: {
            url,
            close: () => {
              closed += 1;
            },
          },
        };
      },
    });

    await Context.opencode();
    await Context.setDir(root);
    expect(closed).toBe(1);
  });
});
