import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { Echo } from "../echo.ts";

export function EchoRoutes() {
  return new Hono().post(
    "/",
    describeRoute({
      summary: "Echo a message back with metadata",
      operationId: "echo",
      responses: {
        200: {
          description: "Echoed message",
          content: {
            "application/json": {
              schema: resolver(Echo.Output),
            },
          },
        },
      },
    }),
    validator("json", Echo.send.schema),
    async (c) => {
      const input = c.req.valid("json");
      const result = await Echo.send(input);
      return c.json(result);
    },
  );
}
