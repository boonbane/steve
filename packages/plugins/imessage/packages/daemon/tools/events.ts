#!/usr/bin/env bun

import pino from "pino";

const DEFAULT_URL = "http://127.0.0.1:3199/events";

type Event = {
  event: string;
  data: unknown;
  id: string;
  retry: number | null;
};

function logger() {
  const transport = pino.transport({
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    ],
  });

  return pino(transport);
}

function parseEvent(block: string): Event | null {
  const out: Event = {
    event: "message",
    data: "",
    id: "",
    retry: null,
  };
  let rawData = "";

  for (const line of block.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    const index = line.indexOf(":");
    const key = index === -1 ? line : line.slice(0, index);
    const raw = index === -1 ? "" : line.slice(index + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;

    if (key === "event") {
      out.event = value;
      continue;
    }

    if (key === "data") {
      rawData = rawData.length === 0 ? value : `${rawData}\n${value}`;
      continue;
    }

    if (key === "id") {
      out.id = value;
      continue;
    }

    if (key === "retry") {
      const retry = Number(value);
      out.retry = Number.isFinite(retry) ? retry : null;
      continue;
    }
  }

  if (out.event.length === 0 && rawData.length === 0 && out.id.length === 0) {
    return null;
  }

  if (rawData.length > 0) {
    try {
      out.data = JSON.parse(rawData);
    } catch {
      out.data = rawData;
    }
  }

  return out;
}

async function main() {
  const log = logger();
  const target = process.argv[2] ?? DEFAULT_URL;

  log.info({ target }, "connecting to daemon events");

  const response = await fetch(target, {
    headers: {
      accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    log.error(
      {
        status: response.status,
        statusText: response.statusText,
      },
      "sse request failed",
    );
    process.exit(1);
  }

  if (!response.body) {
    log.error("sse response missing body");
    process.exit(1);
  }

  log.info("connected; waiting for events");

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const part = await reader.read();

    if (part.done) {
      log.warn("sse stream closed");
      return;
    }

    buffer += decoder.decode(part.value, { stream: true });
    buffer = buffer.replaceAll("\r\n", "\n");

    while (buffer.includes("\n\n")) {
      const marker = buffer.indexOf("\n\n");
      const block = buffer.slice(0, marker);
      buffer = buffer.slice(marker + 2);

      const event = parseEvent(block);

      if (!event) {
        continue;
      }

      if (event.event === "heartbeat") {
        continue;
      }

      log.info(event, "sse event");
    }
  }
}

main();
