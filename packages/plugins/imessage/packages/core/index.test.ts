import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Client, type Message, type UnreadChange } from "./index.ts";

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
        date_read INTEGER DEFAULT 0,
        is_from_me INTEGER,
        is_read INTEGER DEFAULT 0,
        is_sent INTEGER DEFAULT 0,
        error INTEGER DEFAULT 0,
        item_type INTEGER DEFAULT 0,
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

  it("history() decodes typedstream attributedBody, including multi-byte lengths", async () => {
    const { dbPath } = await fixture();

    const framed = (text: string): Buffer => {
      const bytes = Buffer.from(text, "utf8");
      const length =
        bytes.length < 0x80
          ? Buffer.from([bytes.length])
          : Buffer.from([0x81, bytes.length & 0xff, bytes.length >> 8]);
      return Buffer.concat([
        Buffer.from("streamtyped???NSAttributedString", "latin1"),
        Buffer.from([0x01, 0x2b]),
        length,
        bytes,
        Buffer.from([0x86, 0x84]),
      ]);
    };

    const short = "hello";
    const long = "long message body ".repeat(20).trim();

    const db = new Database(dbPath);
    db.run("INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111')");
    const insert = db.query(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, service, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    );
    insert.run(1, 1, "", toAppleNs(Date.now() - 2000), 0, "iMessage", framed(short));
    insert.run(2, 1, "", toAppleNs(Date.now() - 1000), 0, "iMessage", framed(long));
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1), (1, 2)",
    );
    db.close();

    const client = Client({ dbPath });
    const messages = client.history(1, 10, true);
    client.close();

    expect(messages[0]?.text).toBe(short);
    expect(messages[1]?.text).toBe(long);
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

    await client.send(1, "hello world");
    client.close();

    // Routes through the chat thread by guid: text, guid, attachment.
    expect(source).toContain('tell application "Messages"');
    expect(args[0]).toBe("hello world");
    expect(args[1]).toBe("iMessage;+;chat123");
    expect(args[2]).toBe("");
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
    await client.send(1, "hello world");
    client.close();

    expect(args[1]).toBe("SMS;-;+15551234567");
  });

  it("send() prefers the RCS thread over the SMS thread when both exist for a carrier recipient", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    // The same recipient split across a carrier SMS row and an RCS row, both
    // alongside the fixture's iMessage row. On modern macOS Messages only
    // exposes the RCS thread to scripting; `chat id "SMS;-;..."` errors (-1728),
    // so the resolver must route to the RCS guid.
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name) VALUES (?1, ?2, ?3, ?4, ?5)",
      [2, "+15551234567", "SMS;-;+15551234567", "Test Chat", "SMS"],
    );
    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name) VALUES (?1, ?2, ?3, ?4, ?5)",
      [3, "+15551234567", "RCS;-;+15551234567", "Test Chat", "RCS"],
    );

    db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
      1,
      "+15551234567",
    ]);

    // A delivered carrier message pins the service to sms.
    db.run(
      "INSERT INTO message(ROWID, handle_id, date, is_from_me, is_sent, error, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [1, 1, toAppleNs(Date.now() - 2000), 0, 0, 0, "RCS"],
    );
    db.close();

    let args: readonly string[] = [];
    const client = Client({
      dbPath,
      scriptRunner: (_script, scriptArgs) => {
        args = scriptArgs;
      },
    });

    await client.send(1, "hello world");
    client.close();

    expect(args[1]).toBe("RCS;-;+15551234567");
  });

  it("send() passes an attachment path as the trailing argv item", async () => {
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

    await client.send(1, "look at this", "/tmp/outgoing/pic.png");
    client.close();

    // The script sends the file before the text, and the path rides in slot 3.
    expect(source).toContain("send (POSIX file theAttachment)");
    expect(args[0]).toBe("look at this");
    expect(args[2]).toBe("/tmp/outgoing/pic.png");
  });

  it("send() allows an image with no caption", async () => {
    const { dbPath } = await fixture();
    let args: readonly string[] = [];

    const client = Client({
      dbPath,
      scriptRunner: (_script, scriptArgs) => {
        args = scriptArgs;
      },
    });

    await client.send(1, "", "/tmp/outgoing/pic.png");
    client.close();

    expect(args[0]).toBe("");
    expect(args[2]).toBe("/tmp/outgoing/pic.png");
  });

  it("send() rejects an empty text with no attachment", async () => {
    const { dbPath } = await fixture();
    const client = Client({ dbPath, scriptRunner: () => {} });

    await expect(client.send(1, "   ")).rejects.toThrow();
    client.close();
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

  it("markRead() opens the conversation, confirms the read, skips groups and read chats", async () => {
    const { dbPath } = await fixture();
    const seed = new Database(dbPath);
    seed.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [1, null, "hi", toAppleNs(Date.now()), 0, 0, "iMessage"],
    );
    seed.run("INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1)");
    seed.close();

    const opens: Array<readonly string[]> = [];
    const client = Client({
      dbPath,
      // Stands in for Messages: record the open, then flip is_read the way the
      // real app would.
      opener: (args) => {
        opens.push([...args]);
        const writer = new Database(dbPath);
        writer.run("UPDATE message SET is_read = 1 WHERE ROWID = 1");
        writer.close();
      },
    });

    try {
      const conversation = client.conversation("d:+15551234567");
      expect(conversation).toBeTruthy();

      // 1:1 with an unread message → one background open, read confirmed.
      expect(await client.markRead(conversation!)).toBe(true);
      expect(opens).toHaveLength(1);
      expect(opens[0]).toEqual(["-g", "imessage:+15551234567"]);

      // A group can't be addressed by handle → no-op, no open.
      expect(await client.markRead({ ...conversation!, isGroup: true })).toBe(
        false,
      );
      expect(opens).toHaveLength(1);

      // Already read → a repeat markRead is a no-op (nothing to clear).
      expect(await client.markRead(conversation!)).toBe(false);
      expect(opens).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  it("markRead() escalates to the foreground script when the background open doesn't land", async () => {
    const { dbPath } = await fixture();
    const seed = new Database(dbPath);
    seed.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [1, null, "hi", toAppleNs(Date.now()), 0, 0, "iMessage"],
    );
    seed.run("INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1)");
    seed.close();

    const opens: Array<readonly string[]> = [];
    const scripts: Array<readonly string[]> = [];
    const client = Client({
      dbPath,
      // The background open goes nowhere (idle machine); only the escalation
      // script flips the read.
      opener: (args) => {
        opens.push([...args]);
      },
      scriptRunner: (_source, args) => {
        scripts.push([...args]);
        const writer = new Database(dbPath);
        writer.run("UPDATE message SET is_read = 1 WHERE ROWID = 1");
        writer.close();
      },
    });

    try {
      const conversation = client.conversation("d:+15551234567");
      expect(await client.markRead(conversation!)).toBe(true);
      expect(opens).toEqual([["-g", "imessage:+15551234567"]]);
      expect(scripts).toEqual([["imessage:+15551234567"]]);
    } finally {
      client.close();
    }
  }, 10_000);

  it("subscribeUnread() emits when a message is marked read in place", async () => {
    const { dbPath } = await fixture();

    // An unread received message in the fixture's 1:1 chat (+15551234567).
    const seed = new Database(dbPath);
    seed.run(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [1, null, "unread", toAppleNs(Date.now()), 0, 0, "iMessage"],
    );
    seed.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 1],
    );
    seed.close();

    const client = Client({ dbPath, debounceMs: 10, batchLimit: 10 });
    let unsubscribe: (() => void) | undefined;

    try {
      // Baseline: the conversation starts with one unread message.
      expect(client.unread().get("d:+15551234567")).toBe(1);

      const change = new Promise<UnreadChange>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("unread timeout"));
        }, 3000);

        unsubscribe = client.subscribeUnread((changes) => {
          clearTimeout(timeout);
          resolve(changes[0]!);
        });
      });

      await Bun.sleep(25);

      // Read it elsewhere: a synced read lands as an in-place UPDATE (no new
      // ROWID), which the message tail can't see but the unread diff catches.
      const writer = new Database(dbPath);
      writer.run(
        "UPDATE message SET is_read = 1, date_read = ?1 WHERE ROWID = 1",
        [toAppleNs(Date.now())],
      );
      writer.close();

      const result = await change;

      expect(result.conversationId).toBe("d:+15551234567");
      expect(result.unread).toBe(0);
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

  it("unread() counts received-unread messages per conversation, across transports", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    // Same setup as the transport-collapse test: two chat rows for one handle,
    // so unread must sum across both into the single merged conversation.
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

    const insert = db.query(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, service, associated_message_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    );
    // received + unread on the iMessage row → counts
    insert.run(1, 1, "unread a", toAppleNs(Date.now() - 5000), 0, 0, "iMessage", null);
    // received but already read → ignored
    insert.run(2, 1, "read", toAppleNs(Date.now() - 4000), 0, 1, "iMessage", null);
    // received + unread on the SMS row → counts (same conversation)
    insert.run(3, 1, "unread b", toAppleNs(Date.now() - 3000), 0, 0, "SMS", null);
    // outgoing, unread flag irrelevant → ignored
    insert.run(4, 1, "mine", toAppleNs(Date.now() - 2000), 1, 0, "iMessage", null);
    // a tapback (reaction) that is received+unread → ignored, not a real reply
    insert.run(5, 1, "liked", toAppleNs(Date.now() - 1000), 0, 0, "iMessage", 2001);

    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1), (1, 2), (2, 3), (1, 4), (1, 5)",
    );
    db.close();

    const client = Client({ dbPath });
    const unread = client.unread();
    client.close();

    expect(unread.get("d:+15551234567")).toBe(2);
  });

  it("unread() ignores group system rows (renames/joins) that never get read", async () => {
    const { dbPath } = await fixture();
    const db = new Database(dbPath);

    db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [1, "+15551234567"]);
    db.run("INSERT INTO chat_handle_join(chat_id, handle_id) VALUES (1, 1)");

    const insert = db.query(
      "INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, item_type, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    );
    // received + unread real message → counts
    insert.run(1, 1, "real unread", toAppleNs(Date.now() - 3000), 0, 0, 0, "iMessage");
    // group rename (item_type=2), received with is_read=0 and never marked read
    // → must NOT count, or the conversation badges forever.
    insert.run(2, 1, "", toAppleNs(Date.now() - 2000), 0, 0, 2, "iMessage");
    // someone left the group (item_type=3) → must NOT count.
    insert.run(3, 1, "", toAppleNs(Date.now() - 1000), 0, 0, 3, "iMessage");

    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1), (1, 2), (1, 3)",
    );
    db.close();

    const client = Client({ dbPath });
    const unread = client.unread();
    client.close();

    expect(unread.get("d:+15551234567")).toBe(1);
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
