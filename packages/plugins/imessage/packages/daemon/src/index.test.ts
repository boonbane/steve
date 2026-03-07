import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { IMsgDaemon } from "./index.ts";

const APPLE_EPOCH_MS = 978_307_200_000;

const roots: string[] = [];

type Chunk =
  | {
      done: true;
      value?: Uint8Array;
    }
  | {
      done: false;
      value: Uint8Array;
    };

type Reader = {
  read(): Promise<Chunk>;
  cancel(): Promise<void>;
};

function toAppleNs(time: number): bigint {
  return BigInt(time - APPLE_EPOCH_MS) * 1_000_000n;
}

async function fixture() {
  const dir = path.join(
    import.meta.dir,
    "..",
    "..",
    ".cache",
    "scratch",
    crypto.randomUUID(),
  );

  roots.push(dir);
  await fs.promises.mkdir(dir, { recursive: true });

  const dbPath = path.join(dir, "chat.db");
  const db = new Database(dbPath, { create: true });

  db.run(
    `
      CREATE TABLE chat (
        ROWID INTEGER PRIMARY KEY,
        chat_identifier TEXT,
        guid TEXT,
        display_name TEXT,
        service_name TEXT
      )
    `,
  );

  db.run(
    `
      CREATE TABLE handle (
        ROWID INTEGER PRIMARY KEY,
        id TEXT
      )
    `,
  );

  db.run(
    `
      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY,
        handle_id INTEGER,
        text TEXT,
        destination_caller_id TEXT,
        date INTEGER,
        is_from_me INTEGER,
        service TEXT,
        associated_message_type INTEGER,
        attributedBody BLOB
      )
    `,
  );

  db.run(
    `
      CREATE TABLE chat_message_join (
        chat_id INTEGER,
        message_id INTEGER
      )
    `,
  );

  db.run(
    "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name) VALUES (?1, ?2, ?3, ?4, ?5)",
    [1, "+15551234567", "iMessage;+;chat123", "Test Chat", "iMessage"],
  );

  db.close();
  return { dbPath };
}

async function readUntil(
  reader: Reader,
  needle: string,
  timeoutMs = 3000,
): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let output = "";

  while (Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 1);
    const chunk = await new Promise<Chunk>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${needle}`));
      }, remaining);

      reader.read().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

    if (chunk.done) {
      break;
    }

    output += decoder.decode(chunk.value, { stream: true });

    if (output.includes(needle)) {
      return output;
    }
  }

  throw new Error(`Timed out waiting for ${needle}`);
}

afterEach(async () => {
  while (roots.length > 0) {
    const dir = roots.pop();

    if (dir) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("IMsgDaemon", () => {
  it("emits hello and message events on database update", async () => {
    const { dbPath } = await fixture();
    const daemon = IMsgDaemon.start({
      port: 0,
      dbPath,
      debounceMs: 10,
      batchLimit: 10,
    });

    let reader: Reader | null = null;

    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/events`);
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      reader = response.body!.getReader() as Reader;

      await Bun.sleep(50);

      const db = new Database(dbPath);
      db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
        1,
        "+15550001111",
      ]);
      db.run(
        "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        [
          1,
          1,
          "live",
          "",
          toAppleNs(Date.now()),
          0,
          "iMessage",
          null,
          Buffer.alloc(0),
        ],
      );
      db.run(
        "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
        [1, 1],
      );
      db.close();

      if (!reader) {
        throw new Error("Missing stream reader");
      }

      const output = await readUntil(reader, "event: message.received");

      expect(output).toContain("data: hello world");
      expect(output).toContain('"text":"live"');
    } finally {
      if (reader) {
        await reader.cancel();
      }

      daemon.close();
    }
  });
});
