import { describe, it, expect, afterAll } from "bun:test";
import { Wav } from "./wav.ts";
import { resolve } from "path";
import { unlinkSync } from "fs";

const FIXTURE = resolve(import.meta.dir, "../test/jfk.wav");
const OUTPATH = resolve(import.meta.dir, "../test/jfk_roundtrip.wav");

afterAll(() => {
  try {
    unlinkSync(OUTPATH);
  } catch {}
});

describe("Wav", () => {
  it("parses header from jfk.wav", async () => {
    const buf = Buffer.from(await Bun.file(FIXTURE).arrayBuffer());
    const h = Wav.header(buf);
    expect(h).toBeDefined();
    expect(h!.channels).toBe(1);
    expect(h!.rate).toBe(16000);
    expect(h!.bits).toBe(16);
    expect(h!.bytes).toBeGreaterThan(0);
  });

  it("extracts samples from jfk.wav", async () => {
    const buf = Buffer.from(await Bun.file(FIXTURE).arrayBuffer());
    const pcm = Wav.samples(buf);
    expect(pcm).toBeDefined();
    expect(pcm!.length).toBeGreaterThan(0);
  });

  it("round-trips: read jfk.wav, stream chunks, write back out", async () => {
    const buf = Buffer.from(await Bun.file(FIXTURE).arrayBuffer());
    const original = Wav.header(buf)!;
    const pcm = Wav.samples(buf)!;

    // simulate streaming: split pcm into chunks as the phone would send them
    const CHUNK = 1600; // 100ms at 16kHz
    const chunks: Int16Array[] = [];
    for (let i = 0; i < pcm.length; i += CHUNK) {
      chunks.push(pcm.slice(i, i + CHUNK));
    }
    expect(chunks.length).toBeGreaterThan(1);

    // reassemble on "server side"
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const reassembled = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      reassembled.set(chunk, offset);
      offset += chunk.length;
    }

    // encode back to wav
    const out = Wav.encode(
      reassembled,
      original.rate,
      original.channels,
      original.bits,
    );
    await Bun.write(OUTPATH, out);

    // verify the output
    const roundtrip = Wav.header(out)!;
    expect(roundtrip.channels).toBe(original.channels);
    expect(roundtrip.rate).toBe(original.rate);
    expect(roundtrip.bits).toBe(original.bits);
    expect(roundtrip.bytes).toBe(original.bytes);

    // verify sample-level equality
    const outSamples = Wav.samples(out)!;
    expect(outSamples.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      expect(outSamples[i]!).toBe(pcm[i]!);
    }
  });
});
