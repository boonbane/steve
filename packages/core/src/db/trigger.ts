import { z } from "zod/v4";
import { Context } from "../context.ts";
import { SQL } from "../sql.ts";

export namespace Trigger {
  export const State = z.object({
    name: z.string(),
    lastScheduledAt: z.number().nullable(),
  });

  export const Run = z.object({
    id: z.number(),
    name: z.string(),
    scheduledAt: z.number(),
    startedAt: z.number(),
    finishedAt: z.number().nullable(),
    status: z.enum(["running", "success", "error"]),
    error: z.string().nullable(),
  });

  export type State = z.infer<typeof State>;
  export type Run = z.infer<typeof Run>;

  export async function state(name: string): Promise<State | undefined> {
    const db = await Context.db();
    const row = db.query(SQL.TRIGGER_STATE_GET).get(name) as {
      name: string;
      last_scheduled_at: number | null;
    } | null;
    if (!row) return undefined;
    return State.parse({
      name: row.name,
      lastScheduledAt: row.last_scheduled_at,
    });
  }

  export async function set(name: string, scheduled: number): Promise<State> {
    const db = await Context.db();
    const row = db.query(SQL.TRIGGER_STATE_SET).get(name, scheduled) as {
      name: string;
      last_scheduled_at: number | null;
    };
    return State.parse({
      name: row.name,
      lastScheduledAt: row.last_scheduled_at,
    });
  }

  export async function start(
    name: string,
    scheduled: number,
    started: number,
  ): Promise<Run> {
    const db = await Context.db();
    const row = db
      .query(SQL.TRIGGER_RUN_ADD)
      .get(name, scheduled, started, "running") as {
      id: number;
      name: string;
      scheduled_at: number;
      started_at: number;
      finished_at: number | null;
      status: "running" | "success" | "error";
      error: string | null;
    };
    return Run.parse({
      id: row.id,
      name: row.name,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      error: row.error,
    });
  }

  export async function finish(
    id: number,
    finished: number,
    status: "success" | "error",
    error: string | null,
  ): Promise<Run> {
    const db = await Context.db();
    const row = db
      .query(SQL.TRIGGER_RUN_FINISH)
      .get(id, finished, status, error) as {
      id: number;
      name: string;
      scheduled_at: number;
      started_at: number;
      finished_at: number | null;
      status: "running" | "success" | "error";
      error: string | null;
    };
    return Run.parse({
      id: row.id,
      name: row.name,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      error: row.error,
    });
  }

  export async function list(name: string): Promise<Run[]> {
    const db = await Context.db();
    const rows = db.query(SQL.TRIGGER_RUN_LIST).all(name) as Array<{
      id: number;
      name: string;
      scheduled_at: number;
      started_at: number;
      finished_at: number | null;
      status: "running" | "success" | "error";
      error: string | null;
    }>;
    return rows.map((row) => {
      return Run.parse({
        id: row.id,
        name: row.name,
        scheduledAt: row.scheduled_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        status: row.status,
        error: row.error,
      });
    });
  }
}
