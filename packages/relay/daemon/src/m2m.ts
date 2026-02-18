#!/usr/bin/env bun

import { Timer } from "@steve/core";
import { createClerkClient } from "@clerk/backend";

import { logger } from "./logger";
import { RELAY_URL, STEVE_URL, api } from "./api";

const getClerkToken = async (): Promise<string> => {
  const machineSecretKey = process.env.CLERK_MACHINE_SECRET_KEY;

  if (!machineSecretKey) {
    throw new Error("Missing CLERK_MACHINE_SECRET_KEY");
  }

  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  const m2mToken = await clerkClient.m2m.createToken({
    machineSecretKey,
  });

  if (!m2mToken.token) {
    throw new Error("Failed to create Clerk token");
  }

  return m2mToken.token;
};

const main = async () => {
  logger().info({
    relay: RELAY_URL,
    steve: STEVE_URL,
    auth: "clerk-m2m",
  });

  const token = await Timer.run("Request Clerk token", async () => {
    const value = await getClerkToken();
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
