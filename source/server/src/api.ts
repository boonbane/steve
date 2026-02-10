import { z } from "zod";

export function api<T extends z.ZodType, R>(
  schema: T,
  cb: (input: z.infer<T>) => R,
) {
  const result = (input: z.infer<T>) => {
    const parsed = schema.parse(input);
    return cb(parsed);
  };
  result.schema = schema;
  return result;
}
