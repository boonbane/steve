import { z } from "zod";
import { api } from "./api.ts";

export namespace Echo {
  export const Input = z.object({
    message: z.string(),
  });
  export type Input = z.infer<typeof Input>;

  export const Output = z.object({
    message: z.string(),
    length: z.number(),
    timestamp: z.number(),
  });
  export type Output = z.infer<typeof Output>;

  export const send = api(
    Input,
    (input): Output => ({
      message: input.message,
      length: input.message.length,
      timestamp: Date.now(),
    }),
  );
}
