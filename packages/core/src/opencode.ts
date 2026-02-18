import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Config,
} from "@opencode-ai/sdk/v2";
import { App } from "./db.ts";
import { Context } from "./context.ts";
import { logger } from "./context.ts";

const HOST = "127.0.0.1";
const PORT_KEY = "opencode.port";
const MIN = 43100;
const MAX = 43120;

type StartInput = Parameters<typeof createOpencode>[0];
type Started = Awaited<ReturnType<typeof createOpencode>>;

type ServerInterface = {
  start: (input: StartInput) => Promise<Started>;
  client: (input: { baseUrl: string }) => OpencodeClient;
  health: (url: string) => Promise<boolean>;
};

const defaultServer: ServerInterface = {
  start: createOpencode,
  client: createOpencodeClient,
  health: async (url) => {
    const response = await fetch(`${url}/global/health`, {
      signal: AbortSignal.timeout(750),
    }).catch(() => undefined);
    if (!response) return false;

    const data = await response.json().catch(() => undefined);
    if (!data) return false;
    if (typeof data !== "object") return false;
    if (!("healthy" in data)) return false;
    if (data.healthy !== true) return false;
    return response.ok;
  },
};

let server: ServerInterface = defaultServer;
let eventLogger: Promise<void> | undefined;

function toUrl(port: number): string {
  return `http://${HOST}:${port}`;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < 1) return undefined;
  if (parsed > 65535) return undefined;
  return parsed;
}

function ports(saved: number | undefined): number[] {
  const all = Array.from({ length: MAX - MIN + 1 }, (_x, i) => MIN + i);
  if (saved === undefined) return all;
  const without = all.filter((port) => port !== saved);
  return [saved, ...without];
}

export namespace Opencode {
  export interface Resolved {
    client: OpencodeClient;
    url: string;
    close: () => void;
  }

  export async function load(): Promise<Resolved> {
    const dir = Context.dirs();
    const plugin = new URL("./plugin/steve.ts", import.meta.url).href;
    const saved = await App.get(PORT_KEY).then(parsePort);
    const errors: string[] = [];

    if (saved !== undefined) {
      const url = toUrl(saved);
      const healthy = await server.health(url);
      if (healthy) {
        return {
          client: server.client({ baseUrl: url }),
          url,
          close: () => {},
        };
      }
    }

    const config: Config = {
      plugin: [plugin],
    };
    logger.info(config, "Resolved Opencode config");

    for (const port of ports(saved)) {
      const runtime = await server
        .start({
          hostname: HOST,
          port,
          timeout: 5000,
          config,
        })
        .catch((error) => {
          errors.push(String(error));
          return undefined;
        });

      if (runtime) {
        const url = new URL(runtime.server.url);
        App.set(PORT_KEY, url.port);

        return {
          client: runtime.client,
          url: runtime.server.url,
          close: runtime.server.close,
        };
      }
    }

    logger.error(
      {
        min: MIN,
        max: MAX,
        dir: dir.data,
        error: errors.at(-1),
      },
      "Failed to start opencode server",
    );

    throw new Error("Failed to start opencode server");
  }

  export function log() {
    if (eventLogger) return;

    const next = Context.opencode()
      .then((runtime) => runtime.client.event.subscribe())
      .then(async (events) => {
        for await (const event of events.stream) {
          logger.info(
            {
              kind: event.type,
              timestamp: Date.now(),
            },
            "opencode event",
          );
        }
      })
      .catch((error) => {
        logger.warn({ error: String(error) }, "opencode event logging stopped");
      });

    eventLogger = next;
    void next.finally(() => {
      if (eventLogger !== next) return;
      eventLogger = undefined;
    });
  }

  export function override(values: Partial<ServerInterface>) {
    server = {
      ...server,
      ...values,
    };
  }

  export function reset() {
    eventLogger = undefined;
    server = defaultServer;
  }
}
