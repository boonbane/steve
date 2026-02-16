Deploy to Cloudflare with `wrangler dev`. The worker serves a page that shows:
- Logging in with OAuth
- Getting the token that the daemon uses to authenticate with the relay server
- A local server, `server.ts`, which will be called via the relay once authenticated
