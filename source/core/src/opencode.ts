import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2";
import { App } from "./db.ts";
import { Context } from "./context.ts";

const HOST = "127.0.0.1";
const KEY = "opencode.port";
const MIN = 43100;
const MAX = 43120;

type StartInput = Parameters<typeof createOpencode>[0];
type Started = Awaited<ReturnType<typeof createOpencode>>;

type Deps = {
  start: (input: StartInput) => Promise<Started>;
  client: (input: { baseUrl: string }) => OpencodeClient;
  health: (url: string) => Promise<boolean>;
};

const defaults: Deps = {
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

let deps: Deps = defaults;

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
    const plugin = new URL("./plugin/plugin.ts", import.meta.url).href;
    const saved = await App.get(KEY).then(parsePort);
    const errors: string[] = [];

    if (saved !== undefined) {
      const url = toUrl(saved);
      const healthy = await deps.health(url);
      if (healthy) {
        return {
          client: deps.client({ baseUrl: url }),
          url,
          close: () => {},
        };
      }
    }

    for (const port of ports(saved)) {
      const runtime = await deps
        .start({
          hostname: HOST,
          port,
          timeout: 5000,
          config: {
            permission: "allow",
            plugin: [plugin],
          },
        })
        .catch((error) => {
          errors.push(String(error));
          return undefined;
        });
      if (!runtime) continue;

      const found = parsePort(String(new URL(runtime.server.url).port)) ?? port;
      const persisted = await App.set(KEY, String(found))
        .then(() => true)
        .catch(() => false);
      if (!persisted) {
        runtime.server.close();
        throw new Error(`Failed to persist opencode port ${found}`);
      }

      return {
        client: runtime.client,
        url: runtime.server.url,
        close: runtime.server.close,
      };
    }

    const error = errors.at(-1);
    throw new Error(
      `Failed to start opencode on ports ${MIN}-${MAX} (data: ${dir.data})${error ? `, last error: ${error}` : ""}`,
    );
  }

  export function override(values: Partial<Deps>) {
    deps = {
      ...deps,
      ...values,
    };
  }

  export function reset() {
    deps = defaults;
  }
}
