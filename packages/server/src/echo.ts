import { z } from "zod";
import { Agent, logger } from "@steve/core";
import { api } from "./api.ts";

export namespace Echo {
  export const Input = z.object({
    message: z.string(),
  });
  export type Input = z.infer<typeof Input>;

  export const Output = z.object({
    message: z.string(),
    reply: z.string(),
    sessionID: z.string(),
    opencodeURL: z.string(),
    length: z.number(),
    timestamp: z.number(),
  });
  export type Output = z.infer<typeof Output>;

  export const send = api(Input, async (input): Promise<Output> => {
    const client = await Agent.client();
    const opencodeURL = await client.url();
    logger.info(`echo opencode server ${opencodeURL}`);

    const result = await client.prompt({
      text: input.message,
    });

    return {
      message: input.message,
      reply: result.text,
      sessionID: result.session,
      opencodeURL,
      length: input.message.length,
      timestamp: Date.now(),
    };
  });
}
