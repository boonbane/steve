import { z } from "zod";

export namespace Health {
  export const Info = z.object({
    status: z.literal("ok"),
    uptime: z.number(),
  });
  export type Info = z.infer<typeof Info>;

  export function check(): Info {
    return {
      status: "ok",
      uptime: process.uptime(),
    };
  }
}
