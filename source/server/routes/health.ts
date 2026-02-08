import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { Health } from "../health.ts";

export function HealthRoutes() {
  return new Hono().get(
    "/",
    describeRoute({
      summary: "Health check",
      operationId: "health",
      responses: {
        200: {
          description: "Server is healthy",
          content: {
            "application/json": {
              schema: resolver(Health.Info),
            },
          },
        },
      },
    }),
    (c) => c.json(Health.check()),
  );
}
