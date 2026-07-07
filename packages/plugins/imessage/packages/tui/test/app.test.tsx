/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { setRendererCapabilities, type TestRendererSetup } from "@opentui/core/testing";
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

test("hide-unknown checkbox: x toggles from sidebar, space when focused", async () => {
  const setup = await boot();
  // "87654" is the unresolved shortcode fixture.
  await frameWhen(setup, (f) => f.includes("87654"));
  setup.mockInput.pressKey("x");
  const hidden = await frameWhen(setup, (f) => !f.includes("87654"));
  expect(hidden).toContain("[x] hide unknown numbers");

  // Tab moves sidebar → checkbox; space toggles it back off.
  setup.mockInput.pressKey("TAB");
  await Bun.sleep(30);
  setup.mockInput.pressKey(" ");
  const restored = await frameWhen(setup, (f) => f.includes("87654"));
  expect(restored).toContain("[ ] hide unknown numbers");
  setup.renderer.destroy();
});

test("image attachments render as kitty placeholder cells when supported", async () => {
  const setup = await testRender(
    () => <App store={createAppStore(createApi(server.url))} />,
    { width: 110, height: 32 },
  );
  // The panes sample capabilities at mount and then listen for the renderer's
  // "capabilities" event (the real terminal answers the startup query
  // asynchronously); the test helper only sets the field, so emit the event
  // the way the query response would.
  const caps = setRendererCapabilities(setup.renderer, { kitty_graphics: true });
  setup.renderer.emit("capabilities", caps);
  await frameWhen(setup, (f) => f.includes("Jerry Garcia"));

  // The seeded thread has image attachments; with kitty graphics enabled they
  // render as a multi-row grid of U+10EEEE placeholder cells instead of the
  // text label. (Sidebar avatars also emit single placeholder cells, so
  // require a tall run to know the thread image itself rendered.)
  const frame = await frameWhen(
    setup,
    (f) => f.split("\n").filter((line) => line.includes("\u{10EEEE}")).length >= 10,
  );
  expect(frame).not.toContain("IMG_0042.jpg");
  setup.renderer.destroy();
});

test("image attachments fall back to labels without kitty graphics", async () => {
  const setup = await boot();
  const frame = await frameWhen(setup, (f) => f.includes("IMG_0042.jpg"));
  expect(frame).not.toContain("\u{10EEEE}");
  setup.renderer.destroy();
});

test("ctrl-v attaches a clipboard image; enter sends it over multipart", async () => {
  const clip = () => ({
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    name: "clip.png",
  });
  const setup = await testRender(
    () => <App store={createAppStore(createApi(server.url))} clipboard={clip} />,
    { width: 110, height: 32 },
  );
  await frameWhen(setup, (f) => f.includes("Jerry Garcia"));

  // Send to Bob Weir so the paginated Jerry Garcia thread other tests rely on
  // stays untouched (the dev server is shared across this file).
  setup.mockInput.pressKey("j");
  setup.mockInput.pressKey("j");
  await frameWhen(setup, (f) => f.includes("Bob Weir — "));
  setup.mockInput.pressKey("RETURN");
  await frameWhen(setup, (f) => f.includes("enter send"));

  setup.mockInput.pressKey("v", { ctrl: true });
  const chip = await frameWhen(setup, (f) => f.includes("clip.png"));
  expect(chip).toContain("KB — esc removes");

  await setup.mockInput.typeText("with caption");
  setup.mockInput.pressKey("RETURN");
  // 202 + SSE: the optimistic bubble is adopted by the broadcast file row and
  // the caption arrives as its own message.
  const sent = await frameWhen(
    setup,
    (f) => f.includes("with caption") && f.includes("clip.png") && !f.includes("sending…"),
  );
  // Chip is gone from the composer but the attachment shows in the thread.
  expect(sent).not.toContain("esc removes");
  setup.renderer.destroy();
});

test("tab cycles into messages pane; g loads older history", async () => {
  const setup = await boot();
  await frameWhen(setup, (f) => f.includes("Sugar Magnolia"));

  // sidebar → filter checkbox → messages
  setup.mockInput.pressKey("TAB");
  setup.mockInput.pressKey("TAB");
  await Bun.sleep(30);
  // Jump to top of loaded history, which triggers an older-page fetch.
  setup.mockInput.pressKey("g");
  const older = await frameWhen(setup, (f) => f.includes("(#21)"));
  expect(older).toContain("(#21)");
  setup.renderer.destroy();
});
