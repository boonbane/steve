/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import { App } from "../src/app.tsx";
import { createApi } from "../src/api.ts";
import { createAppStore } from "../src/store.ts";
import { startDevServer } from "../tools/dev-server.ts";

const server = startDevServer(0, { chatter: false });
afterAll(() => server.stop());

// waitForFrame spins render passes without letting wall-clock timers fire
// (debounces, focusLater); poll with real sleeps instead.
async function frameWhen(
  setup: TestRendererSetup,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now();
  let frame = "";
  while (true) {
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (predicate(frame)) return frame;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`frameWhen timed out; last frame:\n${frame}`);
    }
    await Bun.sleep(25);
  }
}

async function boot() {
  const setup = await testRender(
    () => <App store={createAppStore(createApi(server.url))} />,
    { width: 110, height: 32 },
  );
  await frameWhen(setup, (f) => f.includes("Jerry Garcia"));
  return setup;
}

test("renders conversations and previews the first thread", async () => {
  const setup = await boot();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Jerry Garcia");
  expect(frame).toContain("Truckin'");
  // Selection preview auto-opens the first conversation after the debounce.
  const thread = await frameWhen(setup, (f) => f.includes("Sugar Magnolia"));
  expect(thread).toContain("me · ");
  setup.renderer.destroy();
});

test("j moves selection, enter focuses composer, send round-trips", async () => {
  const setup = await boot();
  setup.mockInput.pressKey("j");
  await frameWhen(setup, (f) =>
    f.includes("Truckin' — Jerry Garcia, Bill Kreutzmann"),
  );

  setup.mockInput.pressKey("RETURN");
  await frameWhen(setup, (f) => f.includes("enter send"));

  await setup.mockInput.typeText("hello from the harness");
  setup.mockInput.pressKey("RETURN");
  const sent = await frameWhen(
    setup,
    (f) => f.includes("hello from the harness") && !f.includes("sending…"),
  );
  expect(sent).toContain("hello from the harness");
  setup.renderer.destroy();
});

test("slash focuses search and filters; escape restores", async () => {
  const setup = await boot();
  setup.mockInput.pressKey("/");
  await Bun.sleep(30); // focusLater tick
  await setup.mockInput.typeText("phil");
  const filtered = await frameWhen(
    setup,
    (f) => f.includes("Phil Lesh") && !f.includes("Truckin'"),
  );
  expect(filtered).toContain("Phil Lesh");

  setup.mockInput.pressEscape();
  const restored = await frameWhen(setup, (f) => f.includes("Truckin'"));
  expect(restored).toContain("Jerry Garcia");
  setup.renderer.destroy();
});

test("tab cycles into messages pane; g loads older history", async () => {
  const setup = await boot();
  await frameWhen(setup, (f) => f.includes("Sugar Magnolia"));

  setup.mockInput.pressKey("TAB");
  await Bun.sleep(30);
  // Jump to top of loaded history, which triggers an older-page fetch.
  setup.mockInput.pressKey("g");
  const older = await frameWhen(setup, (f) => f.includes("(#21)"));
  expect(older).toContain("(#21)");
  setup.renderer.destroy();
});
