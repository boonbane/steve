import consola from "consola";
import { websocket } from "hono/bun";
import { App } from "./app.ts";

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

    consola.info(`listening on http://localhost:${server.port}`);
    return server;
  }
}
