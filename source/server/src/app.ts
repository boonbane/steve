import { Hono } from "hono";
import { HealthRoutes } from "./routes/health.ts";
import { EchoRoutes } from "./routes/echo.ts";
import { VoiceRoutes } from "./routes/voice.ts";

export namespace App {
  const app = new Hono()
    .route("/health", HealthRoutes())
    .route("/echo", EchoRoutes())
    .route("/voice", VoiceRoutes());

  export function get() {
    return app;
  }
}
