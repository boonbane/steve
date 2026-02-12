import { Prompt } from "../prompt.ts";
import { tool } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode-ai/plugin"

export const Steve: Plugin = async () => {
  return {
    tool: {
      steve_task: tool({
        description: "Read full instructions for one of Steve's tasks",
        args: {
          task: tool.schema.string().describe("Task name"),
        },
        async execute(args: { task: string }) {
          return Prompt.task(args.task);
        },
      }),
    }
  }
}
