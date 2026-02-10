import type { Event } from "@opencode-ai/sdk/v2";
import { Context } from "./context.ts";

export namespace Agent {
  export interface PromptInput {
    cwd: string;
    text: string;
  }

  export interface PromptOutput {
    sessionID: string;
    text: string;
  }

  export interface SubscribeInput {
    cwd: string;
    signal?: AbortSignal;
  }

  export interface Client {
    url(): Promise<string>;
    prompt(input: PromptInput): Promise<PromptOutput>;
    subscribe(input: SubscribeInput): Promise<AsyncGenerator<Event>>;
  }

  export async function client(): Promise<Client> {
    const opencode = await Context.opencode();

    return {
      async url() {
        return opencode.url;
      },

      async prompt(input) {
        const providers = await opencode.client.config.providers(
          {
            directory: input.cwd,
          },
          { throwOnError: true },
        );

        const opencodeProvider = providers.data.providers.find(
          (provider) => provider.id === "opencode",
        );

        const modelID = opencodeProvider?.models["big-pickle"]
          ? "big-pickle"
          : Object.keys(opencodeProvider?.models ?? {})[0];

        if (!modelID) {
          throw new Error("No opencode model available");
        }

        const session = await opencode.client.session.create(
          {
            directory: input.cwd,
          },
          { throwOnError: true },
        );

        const sessionID = session.data.id;
        const response = await opencode.client.session.prompt(
          {
            sessionID,
            directory: input.cwd,
            model: {
              providerID: "opencode",
              modelID,
            },
            parts: [{ type: "text", text: input.text }],
          },
          { throwOnError: true },
        );

        const text = response.data.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("")
          .trim();

        return {
          sessionID,
          text,
        };
      },

      async subscribe(input) {
        const events = await opencode.client.event.subscribe(
          {
            directory: input.cwd,
          },
          {
            signal: input.signal,
            throwOnError: true,
          },
        );
        return events.stream;
      },
    };
  }
}
