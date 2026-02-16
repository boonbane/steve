import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClerkClient } from "@clerk/backend";

interface Env {
  RELAY: DurableObjectNamespace;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_MACHINE_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  CORS_ORIGIN?: string;
}

const errors = {
  MISSING_HEADER: "Missing authorization header",
  MISSING_TOKEN: "Could not parse bearer token from header",
  INVALID_TOKEN: "Invalid token",
  UNAUTHENTICATED: "Unauthenticated request",
  MISSING_SUBJECT: "Could not resolve relay subject",
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

const createClerk = (env: Env) =>
  createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: env.CLERK_JWT_KEY,
  });

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowedOrigin = c.env.CORS_ORIGIN;
      if (!allowedOrigin || allowedOrigin === "*") {
        return "*";
      }

      if (!origin) {
        return allowedOrigin;
      }

      return origin === allowedOrigin ? origin : allowedOrigin;
    },
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.post("/daemon/register", async (c) => {
  const clerkClient = createClerk(c.env);
  const requestState = await clerkClient.authenticateRequest(c.req.raw, {
    acceptsToken: "session_token",
    authorizedParties: c.env.CORS_ORIGIN ? [c.env.CORS_ORIGIN] : undefined,
  });

  if (!requestState.isAuthenticated) {
    return Response.json({ error: errors.UNAUTHENTICATED }, { status: 401 });
  }

  const auth = requestState.toAuth();
  if (!auth.userId) {
    return Response.json({ error: errors.INVALID_TOKEN }, { status: 401 });
  }

  const issued = await clerkClient.m2m.createToken({
    machineSecretKey: c.env.CLERK_MACHINE_SECRET_KEY,
    claims: { userId: auth.userId },
    secondsUntilExpiration: 60 * 60,
  });

  return Response.json({
    userId: auth.userId,
    daemonToken: issued.token,
    expiresAt: issued.expiration,
  });
});

app.all("*", async (c) => {
  const header = c.req.header("authorization");
  if (!header) {
    return new Response(errors.MISSING_HEADER, { status: 401 });
  }

  const token = getToken(header);
  if (!token) {
    return new Response(errors.MISSING_TOKEN, { status: 401 });
  }

  const clerkClient = createClerk(c.env);
  const requestState = await clerkClient.authenticateRequest(c.req.raw, {
    acceptsToken: ["session_token", "m2m_token"],
    authorizedParties: c.env.CORS_ORIGIN ? [c.env.CORS_ORIGIN] : undefined,
  });

  if (!requestState.isAuthenticated) {
    return new Response(errors.UNAUTHENTICATED, { status: 401 });
  }

  const auth = requestState.toAuth();
  const claimsUserId =
    auth.claims && typeof auth.claims === "object" && "userId" in auth.claims
      ? (auth.claims as Record<string, unknown>).userId
      : null;

  const subject =
    auth.tokenType === "session_token"
      ? auth.userId
      : typeof claimsUserId === "string"
        ? claimsUserId
        : (auth.subject ?? auth.id ?? null);

  if (!subject) {
    return new Response(errors.MISSING_SUBJECT, { status: 401 });
  }

  if (auth.tokenType === "session_token" && !auth.userId) {
    return new Response(errors.INVALID_TOKEN, { status: 401 });
  }

  const id = c.env.RELAY.idFromName(subject);
  console.log(subject);

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
    console.log("Got response from Daemon");

    const { id, status, body } = JSON.parse(String(message));
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.resolve(new Response(body, { status }));
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // cleanup
  }
  async webSocketError(ws: WebSocket, error: unknown) {
    // handle errors
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}

export default app;

// export default {
//   async fetch(request: Request, env: Env): Promise<Response> {
//     const header = request.headers.get("authorization");
//     if (!header) {
//       return new Response(errors.MISSING_HEADER, { status: 401 });
//     }
//
//     const token = getToken(header);
//     if (!token) {
//       return new Response(errors.MISSING_TOKEN, { status: 401 });
//     }
//
//     console.log(token);
//
//     const client = createClient({
//       clientID: "relay",
//       issuer: env.AUTH_ISSUER,
//       fetch: (input: any, init: any) => env.AUTH.fetch(input, init),
//     });
//     const verified = await client.verify(subjects, token);
//     if (verified.err) {
//       if (verified.err instanceof InvalidAccessTokenError) {
//         return new Response(errors.INVALID_TOKEN, { status: 401 });
//       }
//       else if (verified.err instanceof InvalidRefreshTokenError) {
//         return new Response(errors.INVALID_REFRESH_TOKEN, { status: 401 });
//       }
//
//       return new Response(errors.UNKNOWN_VERIFICATION, { status: 401 });
//     }
//
//     const id = env.RELAY.idFromName(verified.subject.properties.id);
//     console.log(verified.subject.properties.id)
//     const stub = env.RELAY.get(id);
//     return stub.fetch(request);
//   },
// };
//
//
// export class RelayDO implements DurableObject {
//   tunnel: WebSocket | null = null;
//   pending = new Map<string, (res: { status: number; body: string }) => void>();
//   nextId = 0;
//
//   constructor(
//     private state: DurableObjectState,
//     private env: Env,
//   ) {}
//
//   async fetch(request: Request): Promise<Response> {
//     const url = new URL(request.url);
//
//     if (url.pathname === "/_tunnel") {
//       if (request.headers.get("upgrade") !== "websocket")
//         return new Response("expected websocket", { status: 426 });
//
//       const pair = new WebSocketPair();
//       const client = pair[0];
//       const server = pair[1];
//
//       server.accept();
//
//       server.addEventListener("message", (event) => {
//         console.log("message")
//         const { id, status, body } = JSON.parse(String(event.data));
//         const resolve = this.pending.get(id);
//         if (resolve) {
//           this.pending.delete(id);
//           resolve({ status, body });
//         }
//       });
//
//       server.addEventListener("close", () => {
//         console.log("close")
//         if (this.tunnel === server) this.tunnel = null;
//       });
//
//       // Replace existing tunnel
//       if (this.tunnel) {
//         this.tunnel.close(1000, "replaced");
//       }
//
//       console.log("setting tunnel")
//       this.tunnel = server;
//
//       return new Response(null, { status: 101, webSocket: client });
//     }
//
//     if (!this.tunnel)
//       return new Response("home server not connected", { status: 502 });
//
//     const id = String(this.nextId++);
//
//     return new Promise<Response>((resolve) => {
//       this.pending.set(id, ({ status, body }) => {
//         resolve(new Response(body, { status }));
//       });
//
//       this.tunnel!.send(
//         JSON.stringify({
//           id,
//           method: request.method,
//           path: url.pathname,
//           headers: Object.fromEntries(request.headers),
//         }),
//       );
//     });
//   }
// }
