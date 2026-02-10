import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  describeRoute,
  generateSpecs,
  resolver,
  validator,
} from "hono-openapi";
import { z } from "zod";
import { Agent, Message } from "@steve/core";
import { HealthRoutes } from "./routes/health.ts";
import { EchoRoutes } from "./routes/echo.ts";
import { VoiceRoutes } from "./routes/voice.ts";

const PromptInput = z.object({
  text: z.string().min(1),
});

const ListInput = z.object({
  limit: z.coerce.number().int().positive().max(200).default(20),
});

const ErrorOutput = z.object({
  error: z.string(),
});

export namespace App {
  const app = new Hono()
    .use(logger())
    .route("/health", HealthRoutes())
    .route("/echo", EchoRoutes())
    .route("/voice", VoiceRoutes())
    .post(
      "/prompt",
      describeRoute({
        summary: "Create a prompt message",
        operationId: "prompt",
        responses: {
          200: {
            description: "Stored message",
            content: {
              "application/json": {
                schema: resolver(Message.Info),
              },
            },
          },
          400: {
            description: "Invalid request body",
            content: {
              "application/json": {
                schema: resolver(ErrorOutput),
              },
            },
          },
        },
      }),
      validator("json", PromptInput),
      async (c) => {
        const input = c.req.valid("json");
        const message = await Message.add(input.text);
        const client = await Agent.client();
        const output = await client.prompt({
          cwd: process.cwd(),
          text: input.text,
        });
        const response = await Message.respond(message.id, output.text);
        return c.json({
          ...message,
          response,
        });
      },
    )
    .get(
      "/messages",
      describeRoute({
        summary: "List recent messages",
        operationId: "messages.list",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(Message.Info.array()),
              },
            },
          },
          400: {
            description: "Invalid query parameters",
            content: {
              "application/json": {
                schema: resolver(ErrorOutput),
              },
            },
          },
        },
      }),
      validator("query", ListInput),
      async (c) => {
        const query = c.req.valid("query");
        const messages = await Message.list(query.limit);
        return c.json(messages);
      },
    );

  export function get() {
    return app;
  }

  export async function spec(): Promise<Record<string, unknown>> {
    return generateSpecs(app, {
      documentation: {
        openapi: "3.1.1",
        info: {
          title: "steve",
          version: "0.0.1",
          description: "Steve server API",
        },
      },
    });
  }
}
