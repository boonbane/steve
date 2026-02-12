import os from "os";
import { Context } from "./context.ts";
import { Prompt } from "./prompt.ts";
import { logger } from "./context.ts";

export namespace Agent {
  export interface PromptInput {
    text: string;
  }

  export interface PromptOutput {
    session: string;
    text: string;
    error?: string;
  }

  export interface Client {
    url(): Promise<string>;
    prompt(input: PromptInput): Promise<PromptOutput>;
  }

  export async function client(): Promise<Client> {
    const opencode = await Context.opencode();
    const home = os.homedir();

    return {
      async url() {
        return opencode.url;
      },

      async prompt(input) {
        const session = await opencode.client.session.create();
        if (session.error) {
          return { session: "", text: "", error: "failed to create session" };
        }

        const system = Prompt.system();

        const prompt = {
          sessionID: session.data.id,
          model: {
            providerID: "opencode",
            modelID: "kimi-k2.5-free",
          },
          tools: {
            "*": true,
          },
          system,
          parts: [{ type: "text" as const, text: input.text }],
        };
        logger.info(prompt, "Prompting opencode");

        const text = await opencode.client.session.prompt(prompt).then((r) => {
          return r.data?.parts?.find((p) => p.type === "text")?.text ?? "";
        });
        logger.info({ text }, "Received agent response");

        // if (response.error) {
        //   return { session: session.data.id, text: "", error: "prompt failed" };
        // }
        //
        // const text =
        //   response.data?.parts?.find((p) => p.type === "text")?.text ?? "";
        //
        return { session: session.data.id, text };
      },
    };
  }
}
