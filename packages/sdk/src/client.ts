import { createClient } from "./gen/client/client.gen.ts";
import { SteveClient as GeneratedSteveClient } from "./gen/sdk.gen.ts";

const DEFAULT_URL = "http://127.0.0.1:1977";

type Result<T> = { data?: T; error?: unknown } | undefined;

export type SteveClient = GeneratedSteveClient;

export function createSteveClient(
  url: string = process.env.STEVE_SERVER_URL ?? DEFAULT_URL,
  signal?: AbortSignal,
): SteveClient {
  const client = createClient({ baseUrl: url, signal });
  return new GeneratedSteveClient({ client });
}

export namespace Client {
  export function url(): string {
    return process.env.STEVE_SERVER_URL ?? DEFAULT_URL;
  }

  export function attach(url: string, signal?: AbortSignal): SteveClient {
    return createSteveClient(url, signal);
  }

  export async function connect(signal?: AbortSignal): Promise<SteveClient> {
    return attach(url(), signal);
  }

  export function unwrap<T>(result: Result<T>): T {
    if (!result || result.error || !result.data) {
      throw result?.error ?? new Error("No data");
    }
    return result.data;
  }
}
