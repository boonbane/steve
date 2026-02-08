import { Hono } from "hono";
import { HealthRoutes } from "./routes/health.ts";
import { EchoRoutes } from "./routes/echo.ts";

export namespace App {
  const app = new Hono()
    .route("/health", HealthRoutes())
    .route("/echo", EchoRoutes());

  export function get() {
    return app;
  }
}
