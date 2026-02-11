import { websocket } from "hono/bun";
import { App } from "./app.ts";
import { logger } from "@steve/core";

export namespace Server {
  export type Options = {
    port?: number;
  };

  export function start(options: Options = {}): Bun.Server {
    const port = options.port ?? Number(process.env.PORT ?? 1977);

    const server = Bun.serve({
      port,
      fetch: App.get().fetch,
      websocket,
    });

    logger.info(`Listening on http://localhost:${server.port}`);
    return server;
  }
}
