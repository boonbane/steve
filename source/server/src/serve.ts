import consola from "consola";
import { websocket } from "hono/bun";
import { App } from "./app.ts";

function main() {
  const port = Number(process.env.PORT ?? 1977);

  Bun.serve({
    port,
    fetch: App.get().fetch,
    websocket,
  });

  consola.info(`listening on http://localhost:${port}`);
}

main();
