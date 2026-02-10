import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import consola from "consola";
import { z } from "zod";
import path from "path";
import { Context, Transcriber } from "@steve/core";

namespace Voice {
  export const Transcription = z.object({
    type: z.literal("transcription"),
    text: z.string(),
    final: z.boolean(),
  });

  export const Error = z.object({
    type: z.literal("error"),
    message: z.string(),
  });

  export const Done = z.object({
    type: z.literal("done"),
    text: z.string(),
  });

  export const Event = z.discriminatedUnion("type", [
    Transcription,
    Error,
    Done,
  ]);
  export type Event = z.infer<typeof Event>;
}

function send(ws: { send: (data: string) => void }, event: Voice.Event) {
  ws.send(JSON.stringify(event));
}

export function VoiceRoutes() {
  return new Hono().get(
    "/",
    upgradeWebSocket(() => {
      const transcriber = Transcriber.create({
        whisper: Context.whisper(),
        storage: Context.dirs().then((dirs) =>
          path.join(dirs.storage, "audio"),
        ),
      });

      return {
        onOpen(_, ws) {
          consola.info("voice: connection opened");
          send(ws, {
            type: "transcription",
            text: "",
            final: false,
          });
        },

        onMessage(event) {
          if (typeof event.data === "string") return;
          transcriber.push(event.data as ArrayBuffer);
        },

        async onClose(_, ws) {
          const text = await transcriber.transcribe();

          send(ws, {
            type: "done",
            text,
          });
        },

        onError(event) {
          consola.error("voice: websocket error:", event);
        },
      };
    }),
  );
}
