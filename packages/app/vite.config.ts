import { defineConfig } from "vite";
import appPlugin from "./vite";

export default defineConfig({
  plugins: appPlugin,
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
  },
});
