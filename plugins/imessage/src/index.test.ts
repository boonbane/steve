import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Client, type Message } from "./index.ts";

const APPLE_EPOCH_MS = 978_307_200_000;

const roots: string[] = [];

async function fixture() {
  const dir = path.join(
    import.meta.dir,
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

function toAppleNs(time: number): bigint {
  return BigInt(time - APPLE_EPOCH_MS) * 1_000_000n;
}

afterEach(async () => {
  while (roots.length > 0) {
    const dir = roots.pop();

    if (dir) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("Client", () => {
  it("list() returns SOMETHING", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);
    db.run("INSERT INTO message(ROWID, date) VALUES (?1, ?2)", [
      1,
      toAppleNs(Date.now()),
    ]);
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 1],
    );
    db.close();

    const client = Client({ dbPath });
    const chats = client.list();
    client.close();

    expect(chats.length).toBeGreaterThan(0);
  });

  it("history() filters reaction rows and resolves sender/text fallback", async () => {
    const { dbPath } = await fixture();
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
        "first",
        "",
        toAppleNs(Date.now() - 3000),
        0,
        "iMessage",
        null,
        Buffer.alloc(0),
      ],
    );

    db.run(
      "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      [
        2,
        1,
        "liked",
        "",
        toAppleNs(Date.now() - 2000),
        0,
        "iMessage",
        2001,
        Buffer.alloc(0),
      ],
    );

    db.run(
      "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      [
        3,
        null,
        "",
        "me@icloud.com",
        toAppleNs(Date.now() - 1000),
        1,
        "iMessage",
        null,
        Buffer.from("fallback body"),
      ],
    );

    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 1],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 2],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 3],
    );
    db.close();

    const client = Client({ dbPath });
    const messages = client.history(1, 10);
    client.close();

    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe(3);
    expect(messages[0]?.sender).toBe("me@icloud.com");
    expect(messages[0]?.text).toBe("fallback body");
    expect(messages[1]?.id).toBe(1);
  });

  it("send() executes AppleScript via configured runner", async () => {
    const { dbPath } = await fixture();
    let source = "";
    let args: readonly string[] = [];

    const client = Client({
      dbPath,
      scriptRunner: (script, scriptArgs) => {
        source = script;
        args = scriptArgs;
      },
    });

    client.send(1, "hello world");
    client.close();

    expect(source).toContain('tell application "Messages"');
    expect(args[0]).toBe("+15551234567");
    expect(args[1]).toBe("hello world");
    expect(args[3]).toBe("");
    expect(args[4]).toBe("0");
  });

  it("subscribe() emits new messages", async () => {
    const { dbPath } = await fixture();
    const client = Client({ dbPath, debounceMs: 10, batchLimit: 10 });

    let unsubscribe: (() => void) | undefined;

    try {
      const next = new Promise<Message>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("subscribe timeout"));
        }, 2000);

        unsubscribe = client.subscribe((message) => {
          clearTimeout(timeout);
          resolve(message);
        });
      });

      await Bun.sleep(25);

      const db = new Database(dbPath);
      db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
        2,
        "+15550002222",
      ]);
      db.run(
        "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        [
          10,
          2,
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
        [1, 10],
      );
      db.close();

      const message = await next;

      expect(message.id).toBe(10);
      expect(message.chatId).toBe(1);
      expect(message.text).toBe("live");
    } finally {
      unsubscribe?.();
      client.close();
    }
  });
});
