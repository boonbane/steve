#!/usr/bin/env bun

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import pino from "pino";
import {
  Client,
  Options as CoreOptions,
  type Message,
} from "steve-plugin-imessage-core";
import { z } from "zod/v4";

const DEFAULT_PORT = 3199;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_BATCH_LIMIT = 100;

const log = pino(
  pino.transport({
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    ],
  }),
);

const StartOptions = z.object({
  port: z.number().int().nonnegative().default(DEFAULT_PORT),
  dbPath: z.string().default(CoreOptions.parse({}).dbPath),
  debounceMs: z.number().int().positive().default(DEFAULT_DEBOUNCE_MS),
  batchLimit: z.number().int().positive().default(DEFAULT_BATCH_LIMIT),
});

export namespace IMsgDaemon {
  export type Options = z.infer<typeof StartOptions>;

  export type Handle = {
    port: number;
    close(): void;
  };

  export function start(input: Partial<Options> = {}): Handle {
    const options = StartOptions.parse(input);
    const client = Client({
      dbPath: options.dbPath,
      debounceMs: options.debounceMs,
      batchLimit: options.batchLimit,
    });

    const app = new Hono();

    app.get("/events", (c) => {
      const lastEventId =
        c.req.header("last-event-id") ?? c.req.query("lastEventId");
      const resumeFrom = lastEventId == null ? NaN : Number(lastEventId);
      const hasCursor = Number.isFinite(resumeFrom) && resumeFrom > 0;

      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({
            status: "ok",
          }),
        });

        let high = hasCursor ? resumeFrom : 0;
        let queue = Promise.resolve();

        const flush = (message: Message) => {
          if (message.id <= high) {
            return;
          }

          high = message.id;
          queue = queue
            .then(async () => {
              if (stream.aborted || stream.closed) {
                return;
              }

              await stream.writeSSE({
                event: "message.received",
                data: JSON.stringify(message),
                id: String(message.id),
              });
            })
            .catch(() => undefined);
        };

        const stop = client.subscribe(flush);

        if (hasCursor) {
          let from = resumeFrom;
          while (true) {
            const batch = client.after(from, options.batchLimit);
            if (batch.length === 0) {
              break;
            }
            for (const message of batch) {
              flush(message);
            }
            from = batch[batch.length - 1]!.id;
            if (batch.length < options.batchLimit) {
              break;
            }
          }
        }

        const heartbeat = setInterval(() => {
          if (stream.aborted || stream.closed) {
            return;
          }

          stream
            .writeSSE({
              event: "heartbeat",
              data: "ok",
            })
            .catch(() => undefined);
        }, 5000);

        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(heartbeat);
            stop();
            resolve();
          });
        });
      });
    });

    const server = Bun.serve({
      port: options.port,
      idleTimeout: 255,
      fetch: app.fetch,
    });

    log.info(
      {
        port: server.port ?? options.port,
        dbPath: options.dbPath,
      },
      "imessage daemon listening",
    );

    return {
      port: server.port ?? options.port,
      close() {
        client.close();
        server.stop(true);
      },
    };
  }

  export function main(): void {
    start();
  }
}

if (import.meta.main) {
  IMsgDaemon.main();
}
