import { z } from "zod/v4";
import { Context } from "../context.ts";
import { SQL } from "../sql.ts";

export namespace Message {
  export const Response = z.object({
    id: z.number(),
    text: z.string(),
    timestamp: z.number(),
  });

  export const Info = z.object({
    id: z.number(),
    text: z.string(),
    timestamp: z.number(),
    response: Response.optional(),
  });

  export type Info = z.infer<typeof Info>;

  export async function add(
    text: string,
    timestamp = Date.now(),
  ): Promise<Info> {
    const db = await Context.db();
    const row = db.query(SQL.MESSAGE_ADD).get(text, timestamp) as {
      id: number;
      text: string;
      timestamp: number;
    };
    return Info.parse({
      id: row.id,
      text: row.text,
      timestamp: row.timestamp,
    });
  }

  export async function respond(
    messageID: number,
    text: string,
    timestamp = Date.now(),
  ) {
    const db = await Context.db();
    const row = db.query(SQL.RESPONSE_ADD).get(messageID, text, timestamp) as {
      id: number;
      message_id: number;
      text: string;
      timestamp: number;
    };
    return Response.parse({
      id: row.id,
      text: row.text,
      timestamp: row.timestamp,
    });
  }

  export async function list(limit = 20): Promise<Info[]> {
    const db = await Context.db();
    const rows = db.query(SQL.MESSAGE_LIST).all(limit) as Array<{
      id: number;
      text: string;
      timestamp: number;
      response_id: number | null;
      response_text: string | null;
      response_timestamp: number | null;
    }>;

    return rows.map((row) => {
      return Info.parse({
        id: row.id,
        text: row.text,
        timestamp: row.timestamp,
        response:
          row.response_id === null
            ? undefined
            : {
                id: row.response_id,
                text: row.response_text,
                timestamp: row.response_timestamp,
              },
      });
    });
  }
}
