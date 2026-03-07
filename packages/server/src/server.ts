import { websocket } from "hono/bun";
import { App } from "./app.ts";
import { Context, Trigger, logger, Opencode } from "@steve/core";

export namespace Server {
  export type Options = {
    port?: number;
    trigger?: boolean;
  };

  function wait() {
    const now = Date.now();
    const next = now - (now % 60_000) + 60_000;
    return next - now;
  }

  export function start(options: Options = {}): Bun.Server {
    const port = options.port ?? Number(process.env.PORT ?? 1977);

    Context.preload();
    Opencode.log();

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loop = () => {
      if (closed) return;

      timer = setTimeout(() => {
        if (closed) return;

        void Trigger.poll()
          .then((runs) => {
            for (const run of runs) {
              logger.info(run, "trigger started");
            }
          })
          .catch((error) => {
            logger.error({ error: String(error) }, "trigger poll failed");
          })
          .finally(loop);
      }, wait());
      timer.unref?.();
    };

    if (options.trigger) {
      void Trigger.poll()
        .then((runs) => {
          for (const run of runs) {
            logger.info(run, "trigger started");
          }
        })
        .catch((error) => {
          logger.error({ error: String(error) }, "trigger poll failed");
        });
    }

    loop();

    const server = Bun.serve({
      port,
      fetch: App.get().fetch,
      websocket,
    });

    const stop = server.stop.bind(server);
    server.stop = ((closeActiveConnections?: boolean) => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      return stop(closeActiveConnections);
    }) as typeof server.stop;

    logger.info(`Listening on http://localhost:${server.port}`);
    return server;
  }
}
