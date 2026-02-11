import { logger } from "../context.ts";

export namespace Timer {
  export async function run<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Bun.nanoseconds();
    const result = await fn();
    const elapsed = (Bun.nanoseconds() - start) / 1_000_000;
    logger.info(`${label} ${elapsed.toFixed(1)}ms`);
    return result;
  }
}
