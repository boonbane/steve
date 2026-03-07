import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Context } from "./context.ts";
import { Db } from "./db.ts";
import { Trigger } from "./trigger.ts";

let root = "";
let tick = 0;
const MINUTE = 60_000;

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function at(value: string): number {
  return new Date(value).getTime();
}

async function dir(label: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp", "core-trigger-poll-test");
  await fs.promises.mkdir(base, { recursive: true });
  root = await fs.promises.mkdtemp(path.join(base, `${label}-`));
  return root;
}

async function boot(input: {
  triggers: Array<{ name?: string; kind: "cron"; cron: string; task: string }>;
}) {
  const value = await dir("boot");
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
      triggers: input.triggers,
    },
  });
}

afterEach(async () => {
  Trigger.reset();
  await Context.reset();
  if (root) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  root = "";
  tick = 0;
});

describe("Trigger poll", () => {
  it("computes due cron slots", () => {
    const trigger = Trigger.Metadata.parse({
      name: "five",
      kind: "cron",
      cron: "*/5 * * * *",
      task: "demo",
    });
    const result = Trigger.due(
      trigger,
      at("2026-03-07T10:00:00.000Z"),
      at("2026-03-07T10:16:30.000Z"),
    );
    expect(result).toEqual([]);
  });

  it("rejects invalid cron expressions", () => {
    const trigger = Trigger.Metadata.parse({
      name: "bad",
      kind: "cron",
      cron: "61 * * * *",
      task: "demo",
    });
    expect(() => Trigger.due(trigger, 0, MINUTE)).toThrow();
  });

  it("runs due cron triggers and records history", async () => {
    await boot({
      triggers: [
        {
          name: "ping",
          kind: "cron",
          cron: "*/5 * * * *",
          task: "missing",
        },
      ],
    });

    const calls: string[] = [];
    const base = at("2026-03-07T10:05:30.000Z");
    Trigger.override({
      now: () => base + tick++,
      run: async (trigger) => {
        calls.push(trigger.name);
      },
    });

    const result = await Trigger.poll();
    await settle();
    const runs = await Db.Trigger.list("ping");
    const state = await Db.Trigger.state("ping");

    expect(calls).toEqual(["ping"]);
    expect(result).toEqual([
      {
        name: "ping",
        scheduledAt: at("2026-03-07T10:05:00.000Z"),
      },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("success");
    expect(runs[0]?.scheduledAt).toBe(at("2026-03-07T10:05:00.000Z"));
    expect(state?.lastScheduledAt).toBe(at("2026-03-07T10:05:00.000Z"));
  });

  it("drops missed cron slots and only runs the current slot", async () => {
    await boot({
      triggers: [
        {
          name: "tick",
          kind: "cron",
          cron: "* * * * *",
          task: "demo",
        },
      ],
    });

    await Db.Trigger.set("tick", at("2026-03-07T10:00:00.000Z"));

    const seen: number[] = [];
    const base = at("2026-03-07T10:03:30.000Z");
    Trigger.override({
      now: () => base + tick++,
      run: async (trigger) => {
        seen.push(trigger.name.length + seen.length);
      },
    });

    const result = await Trigger.poll();
    await settle();
    const runs = await Db.Trigger.list("tick");

    expect(seen).toEqual([4]);
    expect(result.map((item) => item.scheduledAt)).toEqual([
      at("2026-03-07T10:03:00.000Z"),
    ]);
    expect(runs.map((item) => item.status)).toEqual(["success"]);
  });

  it("does not start a new run while one is still running", async () => {
    await boot({
      triggers: [
        {
          name: "slow",
          kind: "cron",
          cron: "* * * * *",
          task: "demo",
        },
      ],
    });

    let resolve = () => {};
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const calls: string[] = [];
    const times = [
      at("2026-03-07T10:01:10.000Z"),
      at("2026-03-07T10:02:10.000Z"),
      at("2026-03-07T10:02:10.000Z"),
    ];
    Trigger.override({
      now: () => times.shift() ?? at("2026-03-07T10:02:10.000Z"),
      run: async (trigger) => {
        calls.push(trigger.name);
        await pending;
      },
    });

    const first = await Trigger.poll();
    const second = await Trigger.poll();
    resolve();
    await settle();
    const runs = await Db.Trigger.list("slow");

    expect(first).toEqual([
      {
        name: "slow",
        scheduledAt: at("2026-03-07T10:01:00.000Z"),
      },
    ]);
    expect(second).toEqual([]);
    expect(calls).toEqual(["slow"]);
    expect(runs).toHaveLength(1);
  });

  it("records errors and advances the cursor", async () => {
    await boot({
      triggers: [
        {
          name: "fail",
          kind: "cron",
          cron: "* * * * *",
          task: "demo",
        },
      ],
    });

    const now = at("2026-03-07T10:01:40.000Z");
    Trigger.override({
      now: () => now,
      run: async () => {
        throw new Error("boom");
      },
    });

    const result = await Trigger.poll();
    await settle();
    const runs = await Db.Trigger.list("fail");
    const state = await Db.Trigger.state("fail");

    expect(result).toEqual([
      {
        name: "fail",
        scheduledAt: at("2026-03-07T10:01:00.000Z"),
      },
    ]);
    expect(runs[0]?.status).toBe("error");
    expect(runs[0]?.error).toBe("Error: boom");
    expect(state?.lastScheduledAt).toBe(at("2026-03-07T10:01:00.000Z"));
  });
});
