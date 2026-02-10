import { describe, it, expect, afterAll } from "bun:test";
import { Wav } from "./wav.ts";
import { resolve } from "path";
import { Context } from "./context.ts";

const FIXTURE = resolve(import.meta.dir, "../test/jfk.wav");

afterAll(() => {
  Context.reset();
});

describe("Whisper", () => {
  it("transcribes streamed pcm from jfk.wav", async () => {
    const buf = Buffer.from(await Bun.file(FIXTURE).arrayBuffer());
    const pcm = Wav.samples(buf)!;

    // simulate streaming: split into 100ms chunks, reassemble
    const CHUNK = 1600;
    const chunks: Int16Array[] = [];
    for (let i = 0; i < pcm.length; i += CHUNK) {
      chunks.push(pcm.slice(i, i + CHUNK));
    }

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const reassembled = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      reassembled.set(chunk, offset);
      offset += chunk.length;
    }

    // convert Int16 -> Float32 (whisper expects -1..1 floats)
    const float = new Float32Array(reassembled.length);
    for (let i = 0; i < reassembled.length; i++) {
      float[i] = reassembled[i]! / 32768.0;
    }

    // transcribe
    const ctx = await Context.whisper();
    const segments = await ctx.transcribe({ pcm: float, language: "en" });

    expect(segments.length).toBeGreaterThan(0);

    const text = segments
      .map((s) => s.text)
      .join("")
      .toLowerCase();
    expect(text).toContain("ask not");
    expect(text).toContain("country");
  });
});
