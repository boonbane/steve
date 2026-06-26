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
        service_name TEXT,
        style INTEGER,
        group_id TEXT
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
      CREATE TABLE chat_handle_join (
        chat_id INTEGER,
        handle_id INTEGER
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
        is_sent INTEGER DEFAULT 0,
        error INTEGER DEFAULT 0,
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

  it("since() and latestMessageAt() support timestamp cursors", async () => {
    const { dbPath } = await fixture();
    const firstAt = 1_700_000_000_000;
    const secondAt = firstAt + 1000;
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
        toAppleNs(firstAt),
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
        "second",
        "",
        toAppleNs(secondAt),
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
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 2],
    );
    db.close();

    const client = Client({ dbPath });
    const latest = client.latestMessageAt();
    const messages = client.since(new Date(firstAt));
    client.close();

    expect(latest.getTime()).toBe(secondAt);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(2);
    expect(messages[0]?.text).toBe("second");
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

    // Routes through the chat thread by guid (chat-target path), not the buddy
    // path: empty recipient, the chat guid in slot 3, useChat flag set.
    expect(source).toContain('tell application "Messages"');
    expect(args[0]).toBe("");
    expect(args[1]).toBe("hello world");
    expect(args[3]).toBe("iMessage;+;chat123");
    expect(args[4]).toBe("1");
  });

  it("send() resolves the service from the latest delivered message and routes to the matching thread", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    // Same recipient, a separate carrier (SMS) chat row alongside the iMessage
    // row from the fixture — mirrors how chat.db splits a person across services.
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name) VALUES (?1, ?2, ?3, ?4, ?5)",
      [2, "+15551234567", "SMS;-;+15551234567", "Test Chat", "SMS"],
    );

    db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
      1,
      "+15551234567",
    ]);

    // A genuine, delivered RCS message proves the working service.
    db.run(
      "INSERT INTO message(ROWID, handle_id, date, is_from_me, is_sent, error, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [1, 1, toAppleNs(Date.now() - 2000), 0, 0, 0, "RCS"],
    );

    // A more recent iMessage send that bounced — it is the newest row but must
    // be ignored because it failed.
    db.run(
      "INSERT INTO message(ROWID, handle_id, date, is_from_me, is_sent, error, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [2, 1, toAppleNs(Date.now() - 1000), 1, 0, 22, "iMessage"],
    );
    db.close();

    let args: readonly string[] = [];
    const client = Client({
      dbPath,
      scriptRunner: (_script, scriptArgs) => {
        args = scriptArgs;
      },
    });

    // Caller references the iMessage chat row, but the resolver must pick the
    // carrier service and route to the SMS thread guid.
    client.send(1, "hello world");
    client.close();

    expect(args[2]).toBe("sms");
    expect(args[3]).toBe("SMS;-;+15551234567");
    expect(args[4]).toBe("1");
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

  it("conversations() collapses a person's transports under one stable id", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    // A second, carrier chat row for the same handle as the fixture's iMessage
    // row — exactly how chat.db splits one person across services.
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name, style, group_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [2, "+15551234567", "SMS;-;+15551234567", "", "SMS", null, null],
    );
    db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
      1,
      "+15551234567",
    ]);
    db.run(
      "INSERT INTO chat_handle_join(chat_id, handle_id) VALUES (1, 1), (2, 1)",
    );
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [1, 1, "imsg", toAppleNs(Date.now() - 2000), 0, "iMessage"],
    );
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [2, 1, "sms", toAppleNs(Date.now() - 1000), 0, "SMS"],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1), (2, 2)",
    );
    db.close();

    const client = Client({ dbPath });
    const direct = client
      .conversations()
      .find((c) => c.id === "d:+15551234567");

    expect(direct).toBeTruthy();
    expect([...(direct?.chatIds ?? [])].sort()).toEqual([1, 2]);
    expect(direct?.isGroup).toBe(false);
    // Both transport rows resolve to the same conversation.
    expect(client.conversationByChat(1)?.id).toBe("d:+15551234567");
    expect(client.conversationByChat(2)?.id).toBe("d:+15551234567");
    expect(client.conversation("d:+15551234567")?.identifier).toBe(
      "+15551234567",
    );
    client.close();
  });

  it("conversations() keys groups on group_id, stable across membership changes", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    // Two group rows that share Apple's group_id but have *different* member
    // sets — the situation a member-set hash would wrongly split into two
    // conversations. They must merge into one, keyed on the group_id.
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name, style, group_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [3, "chat900", "iMessage;+;chat900", "Squad", "iMessage", 43, "GROUP-ABC"],
    );
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name, style, group_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [4, "chat901", "iMessage;+;chat901", "", "iMessage", 43, "GROUP-ABC"],
    );
    db.run(
      "INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111'), (2, '+15550002222')",
    );
    db.run(
      "INSERT INTO chat_handle_join(chat_id, handle_id) VALUES (3, 1), (4, 1), (4, 2)",
    );
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [5, 1, "a", toAppleNs(Date.now() - 2000), 0, "iMessage"],
    );
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [6, 2, "b", toAppleNs(Date.now() - 1000), 0, "iMessage"],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (3, 5), (4, 6)",
    );
    db.close();

    const client = Client({ dbPath });
    const group = client.conversations().find((c) => c.id === "g:GROUP-ABC");

    expect(group).toBeTruthy();
    expect(group?.isGroup).toBe(true);
    expect([...(group?.chatIds ?? [])].sort()).toEqual([3, 4]);
    expect(group?.name).toBe("Squad");
    client.close();
  });

  it("sent() locates the outgoing message a send produced", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    db.run(
      "INSERT INTO message(ROWID, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5)",
      [50, "earlier", toAppleNs(Date.now() - 3000), 1, "iMessage"],
    );
    db.run(
      "INSERT INTO message(ROWID, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5)",
      [51, "hello there", toAppleNs(Date.now() - 1000), 1, "iMessage"],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 50), (1, 51)",
    );
    db.close();

    const client = Client({ dbPath });
    // The newest outgoing row past the cursor whose text matches.
    expect(client.sent([1], 50, "hello there")?.id).toBe(51);
    // Nothing newer than the row itself.
    expect(client.sent([1], 51, "hello there")).toBeNull();
    // Text must match — a different send isn't ours.
    expect(client.sent([1], 50, "different")).toBeNull();
    client.close();
  });

  it("after() replays messages newer than a ROWID, oldest first", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    db.run("INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111')");
    for (const id of [60, 61, 62]) {
      db.run(
        "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        [id, 1, `m${id}`, toAppleNs(Date.now() - (70 - id) * 1000), 0, "iMessage"],
      );
      db.run("INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, ?1)", [
        id,
      ]);
    }
    db.close();

    const client = Client({ dbPath });
    expect(client.after(60).map((m) => m.id)).toEqual([61, 62]);
    expect(client.latestRowId()).toBe(62);
    client.close();
  });

  it("historyAcross() paginates newest-first with a before cursor", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    db.run("INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111')");
    for (const id of [70, 71, 72]) {
      db.run(
        "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        [id, 1, `m${id}`, toAppleNs(Date.now() - (80 - id) * 1000), 0, "iMessage"],
      );
      db.run("INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, ?1)", [
        id,
      ]);
    }
    db.close();

    const client = Client({ dbPath });
    expect(client.historyAcross([1], 2).map((m) => m.id)).toEqual([72, 71]);
    expect(client.historyAcross([1], 2, 71).map((m) => m.id)).toEqual([70]);
    client.close();
  });

  it("historyAcross() orders by message date even when ROWID disagrees", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    db.run("INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111')");
    // ROWID 80 was inserted first but carries the *newer* date (a backfill /
    // out-of-order sync). Display order must follow date, not ROWID.
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [80, 1, "newer", toAppleNs(Date.now()), 0, "iMessage"],
    );
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [81, 1, "older", toAppleNs(Date.now() - 60_000), 0, "iMessage"],
    );
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 80), (1, 81)",
    );
    db.close();

    const client = Client({ dbPath });
    // Newest-first by date: 80 (newer) precedes 81 (older), despite 80 < 81.
    expect(client.historyAcross([1], 10).map((m) => m.id)).toEqual([80, 81]);
    // The (date, ROWID) cursor pages strictly older than 80 — i.e. 81.
    expect(client.historyAcross([1], 10, 80).map((m) => m.id)).toEqual([81]);
    client.close();
  });
});
