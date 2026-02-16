#!/usr/bin/env bun

import fs from "fs";
import path from "path";

const DIR = process.env.DEMO_DIR || ".";

const main = () => {
  Bun.serve({
    port: 3000,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/") {
        return new Response(
          Bun.file(path.join(import.meta.dir, "index.html")),
          {
            headers: { "content-type": "text/html" },
          },
        );
      }

      if (url.pathname === "/demo") {
        const entries = fs.readdirSync(DIR, { withFileTypes: true });
        const html = entries
          .map((e) => {
            const icon = e.isDirectory() ? "dir" : "file";
            return `<li><code>[${icon}]</code> ${e.name}</li>`;
          })
          .join("\n");
        return new Response(`<ul>\n${html}\n</ul>`, {
          headers: { "content-type": "text/html" },
        });
      }

      if (url.pathname === "/hello") {
        return new Response("hello, world", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`demo server listening on :3000 (listing ${path.resolve(DIR)})`);
};

main();
