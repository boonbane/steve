import { z } from "zod/v4";
import { Agent } from "./agent.ts";
import { Context } from "./context.ts";
import { Db } from "./db.ts";
import { Prompt } from "./prompt.ts";
import { Task } from "./task.ts";
import { logger } from "./context.ts";

export namespace Trigger {
  const MINUTE = 60_000;

  export namespace Cron {
    export class Error extends globalThis.Error {
      constructor(value: string) {
        super(`invalid cron field \"${value}\"`);
        this.name = "Trigger.Cron.Error";
      }
    }

    export const Schema = z.object({
      kind: z.literal("cron"),
      cron: z.string(),
      task: z.string(),
    });

    type Field = {
      any: boolean;
      values: Set<number>;
    };

    type Parsed = {
      minute: Field;
      hour: Field;
      day: Field;
      month: Field;
      week: Field;
    };

    function read(
      part: string,
      min: number,
      max: number,
      map?: (value: number) => number,
    ): Field {
      if (part === "*") {
        return {
          any: true,
          values: new Set<number>(),
        };
      }

      const values = new Set<number>();
      for (const raw of part.split(",")) {
        const parts = raw.split("/");
        const base = parts[0] ?? "";
        const stepText = parts[1];
        const step = stepText ? Number(stepText) : 1;
        if (!Number.isInteger(step)) {
          throw new Error(part);
        }
        if (step < 1) throw new Error(part);

        if (base === "*") {
          for (let value = min; value <= max; value += step) {
            values.add(map ? map(value) : value);
          }
          continue;
        }

        const [startText, endText] = base.split("-");
        const start = Number(startText);
        const end = endText ? Number(endText) : start;
        if (!Number.isInteger(start)) {
          throw new Error(part);
        }
        if (!Number.isInteger(end)) {
          throw new Error(part);
        }
        if (start < min) throw new Error(part);
        if (end > max) throw new Error(part);
        if (start > end) throw new Error(part);

        for (let value = start; value <= end; value += step) {
          values.add(map ? map(value) : value);
        }
      }

      return {
        any: false,
        values,
      };
    }

    export function has(field: Field, value: number) {
      if (field.any) return true;
      return field.values.has(value);
    }

    export function parse(expr: string): Parsed {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) {
        throw new Error(`invalid cron \"${expr}\"`);
      }

      return {
        minute: read(parts[0]!, 0, 59),
        hour: read(parts[1]!, 0, 23),
        day: read(parts[2]!, 1, 31),
        month: read(parts[3]!, 1, 12),
        week: read(parts[4]!, 0, 7, (item) => (item === 7 ? 0 : item)),
      };
    }

    export function match(cron: Parsed, value: number) {
      const date = new Date(value);

      if (!has(cron.minute, date.getMinutes())) return false;
      if (!has(cron.hour, date.getHours())) return false;
      if (!has(cron.month, date.getMonth() + 1)) return false;

      const dayMatch = has(cron.day, date.getDate());
      const weekMatch = has(cron.week, date.getDay());
      if (cron.day.any && cron.week.any) return true;
      if (cron.day.any) return weekMatch;
      if (cron.week.any) return dayMatch;
      return dayMatch || weekMatch;
    }
  }

  const Named = z.object({
    name: z.string().optional(),
  });

  const Script = z.object({
    name: z.string().optional(),
    kind: z.literal("script"),
    path: z.string(),
    task: z.string(),
  });

  export const Schema = z.discriminatedUnion("kind", [Cron.Schema, Script]);
  const Data = z.intersection(Named, Schema);
  export const Metadata = z.intersection(
    z.object({
      name: z.string(),
    }),
    Schema,
  );

  export type Metadata = z.infer<typeof Metadata>;
  export type Resolved = Metadata;
  export type List = Record<string, Resolved>;

  export const Poll = z.object({
    name: z.string(),
    scheduledAt: z.number(),
  });

  export type Poll = z.infer<typeof Poll>;

  type Hooks = {
    now: () => number;
    run: (trigger: Resolved) => Promise<void>;
  };

  const defaultHooks: Hooks = {
    now: () => Date.now(),
    run: async (trigger) => {
      const task = Task.get(trigger.task);
      if (!task) {
        throw new Error(`missing task \"${trigger.task}\"`);
      }

      const client = await Agent.client();
      const output = await client.prompt({
        text: Prompt.task(trigger.task),
      });
      if (!output.error) return;
      throw new Error(output.error);
    },
  };

  let hooks: Hooks = defaultHooks;
  const running = new Set<string>();

  function floor(value: number) {
    return value - (value % MINUTE);
  }

  export function due(
    trigger: Resolved,
    since: number,
    until: number,
  ): number[] {
    if (trigger.kind !== "cron") return [];
    const cron = Cron.parse(trigger.cron);
    const scheduled = floor(until);
    if (scheduled <= floor(since)) return [];
    if (!Cron.match(cron, scheduled)) return [];
    return [scheduled];
  }

  export function load(): List {
    const result: List = {};
    const all = Context.config().triggers;
    for (const [index, value] of all.entries()) {
      const data = Data.parse(value);
      const name = data.name ?? `trigger-${index + 1}`;
      if (result[name]) {
        logger.warn({ name }, "Skipping duplicate trigger");
        continue;
      }
      result[name] = Metadata.parse({
        ...data,
        name,
      });
    }
    return result;
  }

  export function get(name: string): Resolved | undefined {
    const all = Context.triggers();
    return all[name];
  }

  export async function poll(): Promise<Poll[]> {
    const result: Poll[] = [];
    const now = hooks.now();

    for (const trigger of Object.values(Context.triggers())) {
      if (trigger.kind !== "cron") continue;
      if (running.has(trigger.name)) continue;

      const saved = await Db.Trigger.state(trigger.name);
      const since = saved?.lastScheduledAt ?? floor(now) - MINUTE;
      for (const scheduled of due(trigger, since, now)) {
        running.add(trigger.name);
        const run = await Db.Trigger.start(
          trigger.name,
          scheduled,
          hooks.now(),
        );
        await Db.Trigger.set(trigger.name, scheduled);
        result.push(
          Poll.parse({
            name: trigger.name,
            scheduledAt: scheduled,
          }),
        );
        void hooks
          .run(trigger)
          .then(() => {
            return Db.Trigger.finish(run.id, hooks.now(), "success", null);
          })
          .catch((error) => {
            return Db.Trigger.finish(
              run.id,
              hooks.now(),
              "error",
              String(error),
            );
          })
          .finally(() => {
            running.delete(trigger.name);
          });
      }
    }

    return result;
  }

  export function override(values: Partial<Hooks>) {
    hooks = {
      ...hooks,
      ...values,
    };
  }

  export function reset() {
    hooks = defaultHooks;
    running.clear();
  }
}
