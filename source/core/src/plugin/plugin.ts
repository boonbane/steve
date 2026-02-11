import { z } from "zod";
import { Prompt } from "../prompt.ts";

const steveTask = {
  description:
    "Compile a Steve workflow task into a detailed execution prompt.",
  args: {
    task: z.string().describe("Task name to compile"),
  },
  async execute(args: { task: string }) {
    return Prompt.task(args.task);
  },
};

export default async function plugin() {
  return {
    tool: {
      steve_task: steveTask,
    },
  };
}
