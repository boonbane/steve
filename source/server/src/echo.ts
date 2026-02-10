import { z } from "zod";
import consola from "consola";
import { Agent } from "@steve/core";
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
    const cwd = process.cwd();
    const client = await Agent.client();
    const opencodeURL = await client.url();
    consola.info("echo opencode server", opencodeURL);

    const result = await client.prompt({
      cwd,
      text: input.message,
    });

    return {
      message: input.message,
      reply: result.text,
      sessionID: result.sessionID,
      opencodeURL,
      length: input.message.length,
      timestamp: Date.now(),
    };
  });
}
