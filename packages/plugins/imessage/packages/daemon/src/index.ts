#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { streamSSE, type SSEMessage } from "hono/streaming";
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

type Subscriber = (event: SSEMessage) => void;

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

  class Runtime {
    private readonly watchedFiles: Set<string>;
    private readonly watchedPaths: string[];
    private readonly subscribers = new Set<Subscriber>();
    private readonly client;
    private watcher: fs.FSWatcher | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private cursor: Date;

    constructor(private readonly options: Options) {
      this.client = Client({
        dbPath: options.dbPath,
      });
      this.watchedFiles = new Set<string>([
        path.basename(options.dbPath),
        `${path.basename(options.dbPath)}-wal`,
        `${path.basename(options.dbPath)}-shm`,
      ]);
      this.watchedPaths = Array.from(this.watchedFiles, (file) => {
        return path.join(path.dirname(options.dbPath), file);
      });
      this.cursor = this.client.latestMessageAt();
    }

    start(): void {
      this.startWatcher();
    }

    close(): void {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
      }

      for (const watchedPath of this.watchedPaths) {
        fs.unwatchFile(watchedPath);
      }

      this.subscribers.clear();
      this.client.close();
    }

    subscribe(fn: Subscriber): () => void {
      this.subscribers.add(fn);

      return () => {
        this.subscribers.delete(fn);
      };
    }

    private startWatcher(): void {
      if (this.watcher) {
        return;
      }

      for (const watchedPath of this.watchedPaths) {
        fs.watchFile(watchedPath, { interval: 1000 }, (curr, prev) => {
          if (curr.mtimeMs === prev.mtimeMs) {
            return;
          }

          log.info(
            {
              file: path.basename(watchedPath),
              mode: "watchFile",
            },
            "database file updated",
          );

          this.schedulePoll();
        });
      }

      this.watcher = fs.watch(
        path.dirname(this.options.dbPath),
        (_event, file) => {
          if (file == null) {
            return;
          }

          const name = file.toString();

          if (!this.watchedFiles.has(name)) {
            return;
          }

          log.info(
            {
              file: name,
              mode: "watch",
            },
            "database file updated",
          );

          this.schedulePoll();
        },
      );
    }

    private schedulePoll(): void {
      if (this.timer) {
        clearTimeout(this.timer);
      }

      this.timer = setTimeout(() => {
        this.timer = null;
        this.poll();
      }, this.options.debounceMs);
    }

    private poll(): void {
      let shouldContinue = true;

      while (shouldContinue) {
        const messages = this.client.since(
          this.cursor,
          this.options.batchLimit,
        );

        if (messages.length === 0) {
          return;
        }

        for (const message of messages) {
          if (message.createdAt.getTime() > this.cursor.getTime()) {
            this.cursor = message.createdAt;
          }

          this.emitMessage(message);
        }

        shouldContinue = messages.length >= this.options.batchLimit;
      }
    }

    private emitMessage(message: Message): void {
      this.emit({
        event: "message.received",
        data: JSON.stringify(message),
      });
    }

    private emit(event: SSEMessage): void {
      for (const subscriber of this.subscribers) {
        try {
          subscriber(event);
        } catch {
          continue;
        }
      }
    }
  }

  export function start(input: Partial<Options> = {}): Handle {
    const options = StartOptions.parse(input);
    const runtime = new Runtime(options);

    runtime.start();

    const app = new Hono();

    app.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({
            status: "ok",
          }),
        });

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

        let queue = Promise.resolve();

        const stop = runtime.subscribe((event) => {
          queue = queue
            .then(async () => {
              if (stream.aborted || stream.closed) {
                return;
              }

              await stream.writeSSE(event);
            })
            .catch(() => undefined);
        });

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
        runtime.close();
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
