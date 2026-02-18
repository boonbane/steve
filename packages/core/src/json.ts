import z from "zod"
import fs from "fs"

export namespace Json {

  const Parsed = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ok"),
      data: z.unknown()
    }),
    z.object({
      type: z.literal("error"),
      error: z.string()
    }),
  ])
  type Parsed = z.infer<typeof Parsed>

  export const tryParseFile = (path: string): Parsed => {
    const raw = fs.readFileSync(path, "utf-8");
    try {
      return { type: "ok", data: JSON.parse(raw) };
    } catch (e) {
      return { type: "error", error: (e as Error).message };
    }
  }
}
