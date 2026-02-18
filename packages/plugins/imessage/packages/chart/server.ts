import { Client } from "steve-plugin-imessage-core";

const PORT = 3119;

function bucketByDay(messages: { createdAt: Date }[]): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const msg of messages) {
    const key = msg.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

function api(client: ReturnType<typeof Client>, url: URL): Response {
  if (url.pathname === "/api/chats") {
    const chats = client.list(100);
    chats.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    return Response.json(chats);
  }

  if (url.pathname === "/api/history") {
    const raw = url.searchParams.get("chatId");
    if (raw === null) {
      return Response.json({ error: "chatId required" }, { status: 400 });
    }
    const chatId = Number(raw);
    if (!Number.isInteger(chatId) || chatId < 0) {
      return Response.json({ error: "invalid chatId" }, { status: 400 });
    }
    const messages = client.history(chatId, 1_000_000);
    const buckets = bucketByDay(messages);
    const sorted = [...buckets.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const timestamps = sorted.map(([d]) =>
      Math.floor(new Date(d).getTime() / 1000),
    );
    const counts = sorted.map(([, c]) => c);
    return Response.json({ timestamps, counts });
  }

  return new Response("not found", { status: 404 });
}

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>iMessage Chart</title>
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.31/dist/uPlot.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 16px; font-weight: 500; }
    select { background: #222; color: #eee; border: 1px solid #444; padding: 6px 10px; border-radius: 4px; font-size: 14px; margin-bottom: 20px; }
    #chart { background: #1a1a1a; border-radius: 8px; padding: 16px; display: inline-block; }
    .empty { color: #666; padding: 40px; }
  </style>
</head>
<body>
  <h1>Messages per day</h1>
  <select id="picker"><option value="">Loading chats...</option></select>
  <div id="chart"></div>
  <script src="https://unpkg.com/uplot@1.6.31/dist/uPlot.iife.min.js"></script>
  <script>
    const picker = document.getElementById("picker");
    const chartEl = document.getElementById("chart");
    let plot = null;

    async function loadChats() {
      const res = await fetch("/api/chats");
      const chats = await res.json();
      picker.innerHTML = '<option value="">Select a chat</option>';
      for (const chat of chats) {
        const opt = document.createElement("option");
        opt.value = chat.id;
        opt.textContent = chat.name || chat.identifier;
        picker.appendChild(opt);
      }
    }

    async function loadHistory(chatId) {
      chartEl.innerHTML = "";
      if (plot) { plot.destroy(); plot = null; }
      if (!chatId) return;

      const res = await fetch("/api/history?chatId=" + chatId);
      const data = await res.json();

      if (!data.timestamps || data.timestamps.length === 0) {
        chartEl.innerHTML = '<div class="empty">No messages</div>';
        return;
      }

      plot = new uPlot({
        width: Math.min(window.innerWidth - 80, 1000),
        height: 300,
        series: [
          {},
          {
            label: "Messages",
            stroke: "steelblue",
            fill: "rgba(70,130,180,0.15)",
            width: 2,
            paths: uPlot.paths.bars({ size: [0.6, 100] }),
          },
        ],
        scales: { x: { time: true } },
        axes: [
          { stroke: "#666", grid: { stroke: "#2a2a2a" } },
          { stroke: "#666", grid: { stroke: "#2a2a2a" } },
        ],
      }, [data.timestamps, data.counts], chartEl);
    }

    picker.addEventListener("change", () => loadHistory(picker.value));
    loadChats();
  </script>
</body>
</html>`;

function main() {
  const client = Client();

  Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        return api(client, url);
      }

      return new Response(HTML, {
        headers: { "content-type": "text/html" },
      });
    },
  });

  process.stdout.write(`http://localhost:${PORT}\n`);
}

main();
