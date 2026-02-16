import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@openauthjs/openauth/client";
import { subjects } from "@steve/relay-auth/subjects";
import {
  InvalidRefreshTokenError,
  InvalidAccessTokenError,
} from "@openauthjs/openauth/error";

interface Env {
  RELAY: DurableObjectNamespace;
  AUTH: Fetcher;
  AUTH_ISSUER: string;
}

const errors = {
  MISSING_HEADER: "Missing authorization header",
  MISSING_TOKEN: "Could not parse bearer token from header",
  INVALID_TOKEN: "Invalid token",
  INVALID_REFRESH_TOKEN: "Invalid refresh token",
  UNKNOWN_VERIFICATION: "Unknown verification",
  EXPECTED_WS_UPGRADE: "Expected WebSocket upgrade header",
};

const getToken = (header: string): string | null => {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() || null;
};

type Context = { Bindings: Env };

const app = new Hono<Context>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.all("*", async (c) => {
  const header = c.req.header("authorization");
  if (!header) {
    return new Response(errors.MISSING_HEADER, { status: 401 });
  }

  const token = getToken(header);
  if (!token) {
    return new Response(errors.MISSING_TOKEN, { status: 401 });
  }

  const client = createClient({
    clientID: "relay",
    issuer: c.env.AUTH_ISSUER,
    fetch: (input: any, init: any) => c.env.AUTH.fetch(input, init),
  });
  const verified = await client.verify(subjects, token);
  if (verified.err) {
    if (verified.err instanceof InvalidAccessTokenError) {
      return new Response(errors.INVALID_TOKEN, { status: 401 });
    } else if (verified.err instanceof InvalidRefreshTokenError) {
      return new Response(errors.INVALID_REFRESH_TOKEN, { status: 401 });
    }

    return new Response(errors.UNKNOWN_VERIFICATION, { status: 401 });
  }

  const id = c.env.RELAY.idFromName(verified.subject.properties.id);
  console.log(verified.subject.properties.id);

  const stub = c.env.RELAY.get(id);
  return stub.fetch(c.req.raw);
});

type Resolver = (response: Response) => void;
type Rejecter = (error: Error) => void;
type Pending = {
  promise: Promise<Response>;
  resolve: Resolver;
  reject: Rejecter;
};

export class RelayDO implements DurableObject {
  app: Hono<Context>;
  pending = new Map<string, Pending>();
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.app = new Hono<Context>()
      .get("/tunnel", async (c) => {
        console.log("/tunnel");

        if (c.req.header("upgrade") !== "websocket") {
          return new Response(errors.EXPECTED_WS_UPGRADE, { status: 426 });
        }
        this.ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair("ping", "pong"),
        );

        const sockets = new WebSocketPair();
        const client = sockets[0];
        const server = sockets[1];

        const existing = this.ctx.getWebSockets();
        for (const ws of existing) {
          ws.close(1000, "replaced");
        }

        this.ctx.acceptWebSocket(server);

        return new Response(null, { status: 101, webSocket: client });
      })
      .all("*", async (c) => {
        // Some client sent us a request. Forward it to the daemon.
        console.log("/hello");
        const [ws] = this.ctx.getWebSockets();
        if (!ws) {
          return new Response("Tunnel not connected", { status: 502 });
        }

        const id = crypto.randomUUID();
        const { promise, resolve, reject } = Promise.withResolvers<Response>();

        this.pending.set(id, { promise, resolve, reject });

        ws.send(
          JSON.stringify({
            id,
            url: new URL(c.req.url).pathname,
            method: c.req.method,
            path: c.req.url,
            headers: Object.fromEntries(c.req.raw.headers),
            body: ["POST", "PUT", "PATCH"].includes(c.req.method)
              ? await c.req.text()
              : null,
          }),
        );

        return promise;
      });
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const { id, status, body } = JSON.parse(String(message));
    console.log(`processing daemon response`});

    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.resolve(new Response(body, { status }));
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
  }
  async webSocketError(ws: WebSocket, error: unknown) {
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}

export default app;
