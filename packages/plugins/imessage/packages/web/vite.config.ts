import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3001,
    // Reachable from other devices (e.g. `tailscale funnel 3001`).
    host: true,
    // Personal tool on a private tailnet, reached by MagicDNS name ("miles"),
    // funnel hostname (*.ts.net), or tailscale IP — disable Vite's host check.
    allowedHosts: true,
    proxy: {
      // The browser only ever talks to this Vite origin; Vite forwards
      // /api to the local API over loopback, so the API stays on localhost.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
