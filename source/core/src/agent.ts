import os from "os";
import type { Event } from "@opencode-ai/sdk/v2";
import { Context } from "./context.ts";
import { Prompt } from "./prompt.ts";
import { logger } from "./context.ts";

export namespace Agent {
  export interface PromptInput {
    text: string;
  }

  export interface PromptOutput {
    sessionID: string;
    text: string;
  }

  export interface SubscribeInput {
    signal?: AbortSignal;
  }

  export interface Client {
    url(): Promise<string>;
    prompt(input: PromptInput): Promise<PromptOutput>;
    subscribe(input: SubscribeInput): Promise<AsyncGenerator<Event>>;
  }

  export async function client(): Promise<Client> {
    const opencode = await Context.opencode();
    const home = os.homedir();

    return {
      async url() {
        return opencode.url;
      },

      async prompt(input) {
        const system = await Prompt.system({
          "steve.prompt": input.text,
        });

        const providers = await opencode.client.config.providers(
          {
            directory: home,
          },
          { throwOnError: true },
        );

        const provider = providers.data.providers.find(
          (provider) => provider.id === "opencode",
        );

        const modelID = provider?.models["big-pickle"]
          ? "big-pickle"
          : Object.keys(provider?.models ?? {})[0];

        if (!modelID) {
          throw new Error("No opencode model available");
        }

        const session = await opencode.client.session.create(
          {
            directory: home,
            permission: [
              {
                permission: "*",
                pattern: "*",
                action: "allow",
              },
            ],
          },
          { throwOnError: true },
        );

        const sessionID = session.data.id;
        logger.info(system);
        logger.info(sessionID);
        const response = await opencode.client.session.prompt(
          {
            sessionID,
            directory: home,
            model: {
              providerID: "opencode",
              modelID,
            },
            system,
            parts: [{ type: "text", text: input.text }],
          },
          { throwOnError: true },
        );
        logger.warn(JSON.stringify(response));

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
            directory: home,
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
