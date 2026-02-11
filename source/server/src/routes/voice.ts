import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import {
  Agent,
  Context,
  Message,
  Timer,
  Transcriber,
  logger,
} from "@steve/core";

namespace Voice {
  export namespace Client {
    export const Done = z.object({ type: z.literal("done") });

    export const Event = z.discriminatedUnion("type", [Done]);
    export type Event = z.infer<typeof Event>;
  }

  export namespace Server {
    export const Transcription = z.object({
      type: z.literal("transcription"),
      text: z.string(),
      final: z.boolean(),
    });

    export const Done = z.object({
      type: z.literal("done"),
      text: z.string(),
    });

    export const Response = z.object({
      type: z.literal("response"),
      text: z.string(),
    });

    export const Error = z.object({
      type: z.literal("error"),
      message: z.string(),
    });

    export const Event = z.discriminatedUnion("type", [
      Transcription,
      Done,
      Response,
      Error,
    ]);
    export type Event = z.infer<typeof Event>;
  }
}

interface Socket {
  send: (data: string) => void;
}

export function VoiceRoutes() {
  return new Hono().get(
    "/",
    upgradeWebSocket(() => {
      const whisper = Context.whisper();
      const transcriber = Transcriber.create(whisper);

      const send = (socket: Socket, event: Voice.Server.Event) => {
        socket.send(JSON.stringify(event));
      };

      return {
        onOpen(_, ws) {
          logger.info("voice: connection opened");
          send(ws, {
            type: "transcription",
            text: "",
            final: false,
          });
        },

        async onMessage(event, ws) {
          if (typeof event.data === "string") {
            const data = JSON.parse(event.data);
            const msg = Voice.Client.Event.safeParse(data);
            if (!msg.success) return;

            const text = await Timer.run("voice: transcription", () =>
              transcriber.transcribe(),
            );

            if (!text) {
              send(ws, { type: "done", text: "" });
              return;
            }

            send(ws, { type: "done", text });

            const message = await Message.add(text);
            const client = await Agent.client();
            const output = await Timer.run("voice: agent response", () =>
              client.prompt({ text }),
            );

            await Message.respond(message.id, output.text);
            send(ws, { type: "response", text: output.text });
          } else {
            transcriber.push(event.data as ArrayBuffer);
            return;
          }
        },

        onClose() {
          logger.info("voice: connection closed");
        },

        onError(event) {
          logger.error({ event }, "voice: websocket error");
        },
      };
    }),
  );
}
