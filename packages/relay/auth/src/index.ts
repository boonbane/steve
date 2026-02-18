import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import type { KVNamespace, ExecutionContext } from "@cloudflare/workers-types";
import type { Provider } from "@openauthjs/openauth/provider/provider";
import { subjects } from "./subjects.js";

interface Env {
  AUTH_KV: KVNamespace;
  DB: D1Database;
}

// Dummy provider for testing the token round trip.
// Swap for Google/Apple providers once credentials are in place.
const dummy = {
  type: "dummy",
  init(route, ctx) {
    route.get("/authorize", async (c) => {
      const email = c.req.query("email") || "test@test.com";
      return ctx.success(c, { email });
    });
  },
  client: async ({ clientID, clientSecret }) => {
    return { email: clientID };
  },
} satisfies Provider<{ email: string }>;

interface User {
  id: string;
}

async function getUser(env: Env, email: string, provider: string) {
  const row = await env.DB.prepare(
    "INSERT INTO users (email, provider) VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id",
  )
    .bind(email, provider)
    .first<User>();

  if (!row) throw new Error("failed to upsert user");

  return row.id;
}


const SLOW_MS = 100
const log = (obj: Record<string, unknown>) => {
  console.info(JSON.stringify(obj))
}
const timed = async <T>(
  rid: string,
  step: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>,
): Promise<T> => {
  const start = performance.now()
  const out = await fn()
  const ms = Math.round(performance.now() - start)
  if (ms >= SLOW_MS) {
    log({ rid, step, ms, ...extra })
  }
  return out
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const rid = crypto.randomUUID()
    const base = CloudflareStorage({ namespace: env.AUTH_KV })
    const storage = {
      async get(key: string[]) {
        return timed(rid, "kv.get", () => base.get(key), { key: key.join(":") })
      },
      async set(key: string[], value: any, expiry?: Date) {
        return timed(rid, "kv.set", () => base.set(key, value, expiry), { key: key.join(":") })
      },
      async remove(key: string[]) {
        return timed(rid, "kv.remove", () => base.remove(key), { key: key.join(":") })
      },
      async *scan(prefix: string[]) {
        const start = performance.now()
        let n = 0
        for await (const item of base.scan(prefix)) {
          n++
          yield item
        }
        const ms = Math.round(performance.now() - start)
        if (ms >= SLOW_MS) {
          log({ rid, step: "kv.scan", ms, prefix: prefix.join(":"), count: n })
        }
      },
    }
    return issuer({
      storage,
      //storage: CloudflareStorage({ namespace: env.AUTH_KV }),
      subjects,
      providers: { dummy },
      success: async (ctx, value) => {
        console.log(`Succeeded for provider ${value.provider}`)
        if (value.provider === "dummy") {
          const id = await getUser(env, value.email, value.provider);
          console.log(id)
          return ctx.subject("user", { id });
        }

        throw new Error("unknown provider");
      },
      error: async(err) => {
        return new Response(err.message, {
          status: 400,
          headers: {
            "Content-Type": "text/plain",
          },
        })
      }
    }).fetch(request, env, ctx);
  },
};
