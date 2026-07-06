#!/usr/bin/env bun
import { render } from "@opentui/solid";
import { Config } from "@steve/core/config";
import { App } from "./app.tsx";
import { baseUrlFrom, DEFAULT_BASE_URL } from "./api.ts";

// Server base URL precedence: --url flag > IMSG_TUI_URL env > steve.json
// (~/.config/steve/steve.json `plugins.imessage.{url,port}`) > local default.
// e.g. a Mac reachable over Tailscale: { "plugins": { "imessage": { "url": "miles" } } }
function resolveServerUrl(argv: string[]): string {
  const flag = argv.findIndex((arg) => arg === "--url" || arg === "-u");
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (!value) {
      console.error("usage: imessage-tui [--url <server base URL>]");
      process.exit(1);
    }
    return value;
  }
  const inline = argv.find((arg) => arg.startsWith("--url="));
  if (inline) return inline.slice("--url=".length);

  if (process.env.IMSG_TUI_URL) return process.env.IMSG_TUI_URL;

  try {
    const imessage = Config.load().plugins?.imessage;
    if (imessage && (imessage.url || imessage.port != null)) {
      return baseUrlFrom(imessage.url, imessage.port);
    }
  } catch (err) {
    console.error(
      `ignoring steve.json: ${err instanceof Error ? err.message : err}`,
    );
  }
  return DEFAULT_BASE_URL;
}

if (import.meta.main) {
  const url = resolveServerUrl(process.argv.slice(2));
  await render(() => <App url={url} />, {
    targetFps: 30,
    useKittyKeyboard: {},
  });
}

export { App } from "./app.tsx";
export { createAppStore } from "./store.ts";
export { createApi } from "./api.ts";
