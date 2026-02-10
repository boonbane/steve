import consola from "consola";
import {
  createContext,
  type Context as WhisperContext,
  type Segment,
} from "node-whisper-cpp";

export namespace Wav {
  export interface Header {
    channels: number;
    rate: number;
    bits: number;
    bytes: number;
  }

  export function header(buf: Buffer): Header | undefined {
    if (buf.length < 44) return undefined;
    if (buf.toString("ascii", 0, 4) !== "RIFF") return undefined;
    if (buf.toString("ascii", 8, 12) !== "WAVE") return undefined;
    if (buf.toString("ascii", 12, 16) !== "fmt ") return undefined;
    const format = buf.readUInt16LE(20);
    if (format !== 1) return undefined; // only PCM
    const channels = buf.readUInt16LE(22);
    const rate = buf.readUInt32LE(24);
    const bits = buf.readUInt16LE(34);
    // find the "data" chunk — it's not always at offset 36
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === "data") {
        return { channels, rate, bits, bytes: size };
      }
      offset += 8 + size;
    }
    return undefined;
  }

  export function samples(buf: Buffer): Int16Array | undefined {
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === "data") {
        const start = offset + 8;
        return new Int16Array(
          buf.buffer.slice(
            buf.byteOffset + start,
            buf.byteOffset + start + size,
          ),
        );
      }
      offset += 8 + size;
    }
    return undefined;
  }

  export function encode(
    pcm: Int16Array,
    rate: number,
    channels = 1,
    bits = 16,
  ): Buffer {
    const bytes = pcm.byteLength;
    const buf = Buffer.alloc(44 + bytes);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + bytes, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * channels * (bits / 8), 28);
    buf.writeUInt16LE(channels * (bits / 8), 32);
    buf.writeUInt16LE(bits, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(bytes, 40);
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, 44);
    return buf;
  }

  export function whisper(model: string): WhisperContext {
    const ctx = createContext({ model });
    consola.success("voice: whisper model loaded");
    return ctx;
  }
}

export namespace Transcriber {
  export interface Handle {
    push(data: ArrayBuffer): void;
    transcribe(): Promise<string>;
  }

  export interface Input {
    whisper: Promise<WhisperContext>;
  }

  export function create(input: Input): Handle {
    const chunks: ArrayBuffer[] = [];

    return {
      push(data) {
        chunks.push(data);
      },

      async transcribe() {
        const bytes = chunks.reduce((n, c) => n + c.byteLength, 0);
        if (bytes === 0) return "";

        const combined = new Int16Array(bytes / 2);
        let offset = 0;
        for (const chunk of chunks) {
          const samples = new Int16Array(chunk);
          combined.set(samples, offset);
          offset += samples.length;
        }

        const pcm = new Float32Array(combined.length);
        for (let i = 0; i < combined.length; i++) {
          pcm[i] = combined[i]! / 32768.0;
        }

        const whisper = await input.whisper;
        const segments = await whisper.transcribe({
          pcm,
          language: "en",
          threads: 4,
        });

        const text = segments
          .map((s: Segment) => s.text)
          .join("")
          .trim();
        consola.success(`voice: "${text}"`);
        return text;
      },
    };
  }
}
