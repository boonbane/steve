#!/usr/bin/env bun
import { logger } from "../src//logger"
import { RELAY_URL, STEVE_URL, AUTH_URL, api } from "../src/api";
import { getToken } from "../src//auth";

export namespace Timer {
  export async function run<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Bun.nanoseconds();
    const result = await fn();
    const elapsed = (Bun.nanoseconds() - start) / 1_000_000;
    logger().info({ elapsed: `${elapsed.toFixed(1)}ms` }, label);
    return result;
  }
}


const main = async () => {
  logger().info({
    relay: RELAY_URL,
    steve: STEVE_URL,
    auth: AUTH_URL
  })

  const token = await Timer.run("Request auth token", async () => {
    const tokens = await getToken()
    logger().info(tokens)
    return tokens.access_token
  })

  const request = {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`
    }
  }

  const local = await fetch(api.server("hello"), request)
  logger().info({ local: await local.text(), status: local.status })

  const remote = await fetch(api.relay("hello"), request)
  logger().info({ remote: await remote.text(), status: remote.status })

  const post = await fetch(api.relay("echo"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: "Echo time..."
  })
  logger().info({ post: await post.text(), status: post.status })

}

if (import.meta.main) {
  main()
}
