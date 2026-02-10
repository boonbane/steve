#!/usr/bin/env bun

import consola from "consola";
import { Client } from "@steve/sdk/client";

export namespace WebInterface {
  export type Options = {
    port?: number;
  };

  export function start(options: Options = {}): Bun.Server {
    const port = options.port ?? Number(process.env.PORT ?? 3080);

    const server = Bun.serve({
      port,
      routes: {
        "/": {
          GET: () => {
            const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Steve Chat</title>
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <style>
      :root {
        --background: #111315;
        --surface: #191c20;
        --surface-soft: #232831;
        --primary: #2f7df6;
        --primary-contrast: #f4f8ff;
        --text: #e6ebf2;
        --muted: #8e99a8;
        --bubble-steve: #353b45;
        --border: #2a2f37;
        --radius-lg: 18px;
        --radius-md: 14px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--background);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .shell {
        width: min(56vw, 960px);
        min-width: 320px;
        height: min(84vh, 900px);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .messages {
        flex: 1;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }

      .message {
        width: fit-content;
        max-width: 50%;
        border-radius: var(--radius-md);
        padding: 10px 12px;
      }

      .message.user {
        align-self: flex-end;
        background: var(--primary);
        color: var(--primary-contrast);
      }

      .message.steve {
        align-self: flex-start;
        background: var(--bubble-steve);
        color: var(--text);
      }

      .message-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 18px;
        margin-bottom: 8px;
        font-size: 0.84rem;
      }

      .sender {
        font-weight: 500;
      }

      .time {
        color: var(--muted);
      }

      .text {
        margin: 0;
        white-space: pre-wrap;
        line-height: 1.35;
      }

      .composer {
        border-top: 1px solid var(--border);
        background: var(--surface-soft);
        padding: 12px;
      }

      .row {
        display: flex;
        gap: 10px;
      }

      .input {
        flex: 1;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: #11151a;
        color: var(--text);
        padding: 10px 14px;
        font-size: 0.95rem;
        outline: none;
      }

      .input:focus {
        border-color: var(--primary);
      }

      .button {
        border: 0;
        border-radius: 999px;
        background: var(--primary);
        color: var(--primary-contrast);
        padding: 10px 16px;
        font-size: 0.95rem;
        cursor: pointer;
      }

      .typing {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 18px;
      }

      .typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--muted);
        animation: pulse 1s ease-in-out infinite;
      }

      .typing-dot:nth-child(2) {
        animation-delay: 0.15s;
      }

      .typing-dot:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes pulse {
        0%,
        80%,
        100% {
          opacity: 0.3;
          transform: translateY(0);
        }

        40% {
          opacity: 1;
          transform: translateY(-2px);
        }
      }

      @media (max-width: 1000px) {
        .shell {
          width: min(96vw, 640px);
        }

        .message {
          max-width: 85%;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section id="messages" class="messages"></section>
      <form
        class="composer"
        hx-post="/prompt"
        hx-swap="none"
        hx-on::config-request="window.steveChat.configRequest(event)"
        hx-on::after-request="window.steveChat.afterRequest(event)"
      >
        <div class="row">
          <input class="input" type="text" name="text" placeholder="Message Steve" autocomplete="off" required />
          <button class="button" type="submit">Send</button>
        </div>
      </form>
    </main>
    <script>
      (() => {
        const esc = (v) =>
          v
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");

        const stamp = (ts) =>
          new Date(ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

        const bubble = (role, text, time, id = "") => {
          const attr = id ? ' id="' + id + '"' : "";
          return (
            '<article' +
            attr +
            ' class="message ' +
            role +
            '"><header class="message-head"><span class="sender">' +
            role +
            '</span><time class="time">' +
            esc(time) +
            '</time></header><p class="text">' +
            esc(text) +
            "</p></article>"
          );
        };

        const pending = (id) =>
          '<article id="assistant-' +
          id +
          '" class="message steve"><header class="message-head"><span class="sender">steve</span><time class="time">thinking...</time></header><p class="text"><span class="typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span></p></article>';

        window.steveChat = {
          configRequest(event) {
            const form = event.target;
            const input = form.querySelector("input[name=text]");
            const messages = document.getElementById("messages");
            const text = input.value.trim();
            const params = event.detail && event.detail.parameters ? event.detail.parameters : null;

            if (!text) {
              event.preventDefault();
              input.focus();
              return;
            }

            if (!params) {
              event.preventDefault();
              input.focus();
              return;
            }

            const id = crypto.randomUUID();
            params.requestID = id;
            params.text = text;

            messages.insertAdjacentHTML("beforeend", bubble("user", text, stamp(Date.now())) + pending(id));
            messages.scrollTop = messages.scrollHeight;
            input.value = "";
          },

          afterRequest(event) {
            const form = event.target;
            const input = form.querySelector("input[name=text]");
            const messages = document.getElementById("messages");

            messages.scrollTop = messages.scrollHeight;
            input.focus();
          },
        };
      })();
    </script>
  </body>
</html>`;

            return new Response(body, {
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
            });
          },
        },
        "/prompt": {
          POST: async (req) => {
            const esc = (v: string) =>
              v
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#39;");
            const stamp = (ts: number) =>
              new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });

            const form = await req.formData();
            const text = String(form.get("text") ?? "").trim();
            const requestID = String(form.get("requestID") ?? "")
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, "");
            const bubbleID = requestID
              ? `assistant-${requestID}`
              : `assistant-${Date.now()}`;
            const swap = requestID
              ? `id="${bubbleID}" hx-swap-oob="outerHTML"`
              : `hx-swap-oob="beforeend:#messages"`;

            if (!text) {
              const html = `<article ${swap} class="message steve"><header class="message-head"><span class="sender">steve</span><time class="time">now</time></header><p class="text">Message was empty.</p></article>`;
              return new Response(html, {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                },
              });
            }

            const client = await Client.connect();
            const result = await client.prompt({ text });

            if (!result || result.error || !result.data) {
              const html = `<article ${swap} class="message steve"><header class="message-head"><span class="sender">steve</span><time class="time">now</time></header><p class="text">Unable to reach Steve server.</p></article>`;
              return new Response(html, {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                },
              });
            }

            const steveTime = result.data.response?.timestamp ?? Date.now();
            const steveText =
              result.data.response?.text ?? "No response from Steve.";
            const steveHtml = `<article ${swap} class="message steve"><header class="message-head"><span class="sender">steve</span><time class="time">${esc(stamp(steveTime))}</time></header><p class="text">${esc(steveText)}</p></article>`;

            return new Response(steveHtml, {
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
            });
          },
        },
      },
    });

    consola.info(`web interface listening on http://localhost:${server.port}`);
    return server;
  }
}

function main() {
  WebInterface.start();
}

main();
