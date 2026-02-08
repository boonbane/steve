import consola from "consola";
import { App } from "./app.ts";

function main() {
  const port = Number(process.env.PORT ?? 3000);

  Bun.serve({
    port,
    fetch: App.get().fetch,
  });

  consola.info(`listening on http://localhost:${port}`);
}

main();
