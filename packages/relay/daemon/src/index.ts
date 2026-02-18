#!/usr/bin/env bun

import { Timer } from "@steve/core";

import { logger } from "./logger";
import { RELAY_URL, STEVE_URL, api } from "./api";

const getDaemonToken = () => {
  const token = process.env.STEVE_DAEMON_TOKEN;
  if (!token) {
    throw new Error("Missing STEVE_DAEMON_TOKEN");
  }

  return token;
};

const main = async () => {
  logger().info({
    relay: RELAY_URL,
    steve: STEVE_URL,
    auth: "STEVE_DAEMON_TOKEN",
  });

  const token = await Timer.run("Read daemon token", async () => {
    const value = getDaemonToken();
    logger().info({ tokenPrefix: value.slice(0, 16) });
    return value;
  });

  const ws = await Timer.run("Connect to WS", async () => {
    return new WebSocket(api.tunnel(), {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
  });

  ws.onopen = () => {
    logger().info("Opened WS");
  };

  // When the relay sends us data, it's a request that we should forward to Steve
  ws.onmessage = async (e) => {
    const { id, method, url, headers, body } = JSON.parse(e.data);
    logger().info(`Received WS message (${method} at URL ${url})`);

    const result = await fetch(api.server(url), {
      method,
      headers,
      ...(body !== null && { body }),
    });
    ws.send(
      JSON.stringify({
        id,
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body: await result.text(),
      }),
    );
  };
};

if (import.meta.main) {
  main();
}
