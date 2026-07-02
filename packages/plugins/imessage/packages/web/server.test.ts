import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Client } from "steve-plugin-imessage-core";
import fs from "fs";
import os from "os";
import path from "path";

import { createApp, createServer, type NameDirectory } from "./server.ts";

const APPLE_EPOCH_MS = 978_307_200_000;
const appleNs = (ms: number): bigint =>
  BigInt(ms - APPLE_EPOCH_MS) * 1_000_000n;

// A name directory that never touches Contacts/FFI — the API only needs the
// shape, and the unread tests don't care about resolved names.
const nameDir: NameDirectory = {
  resolve: () => new Map(),
  label: () => null,
  avatar: () => null,
};

// Minimal chat.db the core Client can read: a POKER-NIGHT-style group whose only
// received rows are group *system* events (a rename + a join), and a 1:1 with one
// genuinely-unread message. The system rows arrive is_read=0 and never flip — the
// exact shape that used to badge a conversation forever.
function fixture(): { dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imsg-api-"));
  const dbPath = path.join(dir, "chat.db");
  const db = new Database(dbPath);

  db.run(`CREATE TABLE chat (
    ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, guid TEXT,
    display_name TEXT, service_name TEXT, style INTEGER, group_id TEXT
  )`);
  db.run(`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT)`);
  db.run(`CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER)`);
  db.run(`CREATE TABLE message (
    ROWID INTEGER PRIMARY KEY, handle_id INTEGER, text TEXT, date INTEGER,
    date_read INTEGER DEFAULT 0, is_from_me INTEGER, is_read INTEGER DEFAULT 0,
    is_sent INTEGER DEFAULT 0, error INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0,
    service TEXT, associated_message_type INTEGER
  )`);
  db.run(`CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)`);

  // chat 1 = group (style 43), chat 2 = 1:1 (style 45).
  db.run(
    `INSERT INTO chat(ROWID, chat_identifier, guid, display_name, service_name, style, group_id)
     VALUES (1, 'chat999', 'iMessage;+;chat999', 'POKER NIGHT', 'iMessage', 43, 'grp1'),
            (2, '+15553334444', 'iMessage;-;+15553334444', '', 'iMessage', 45, NULL)`,
  );
  db.run(
    `INSERT INTO handle(ROWID, id) VALUES (1, '+15550001111'), (2, '+15550002222'), (3, '+15553334444')`,
  );
  db.run(
    `INSERT INTO chat_handle_join(chat_id, handle_id) VALUES (1, 1), (1, 2), (2, 3)`,
  );

  const now = Date.now();
  const insert = db.query(
    `INSERT INTO message(ROWID, handle_id, text, date, is_from_me, is_read, item_type, service)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  );
  // Group: only system rows (rename=2, join=1) — received, never read. Must NOT badge.
  insert.run(1, 1, "", appleNs(now - 5000), 0, 0, 2, "iMessage");
  insert.run(2, 2, "", appleNs(now - 4000), 0, 0, 1, "iMessage");
  // 1:1: one real, genuinely-unread message → badges 1.
  insert.run(3, 3, "you up?", appleNs(now - 3000), 0, 0, 0, "iMessage");
  db.run(
    `INSERT INTO chat_message_join(chat_id, message_id) VALUES (1, 1), (1, 2), (2, 3)`,
  );

  db.close();
  return { dbPath };
}

describe("conversations API unread counts", () => {
  let server: ReturnType<typeof createServer> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  it("does not badge a group whose only unread rows are system events", async () => {
    const { dbPath } = fixture();
    const client = Client({ dbPath, scriptRunner: () => {} });
    server = createServer({ client, nameDir }, 0);

    const res = await fetch(`http://localhost:${server.port}/api/conversations`);
    const list = (await res.json()) as Array<{
      id: string;
      isGroup: boolean;
      unread: number;
    }>;
    client.close();

    const group = list.find((c) => c.isGroup);
    const direct = list.find((c) => !c.isGroup);
    // Pre-fix this was 2 (the rename + join rows). They never get marked read,
    // so the badge was permanent — exactly the POKER NIGHT symptom.
    expect(group?.unread).toBe(0);
    // A real received-unread message still counts.
    expect(direct?.unread).toBe(1);
  });

  // The handlers are usable without a socket too — handy for pure unit assertions.
  it("createApp exposes handlers callable without listening", async () => {
    const { dbPath } = fixture();
    const client = Client({ dbPath, scriptRunner: () => {} });
    const app = createApp({ client, nameDir });

    const res = app.listConversations(new Request("http://x/api/conversations"));
    const list = (await res.json()) as Array<{ isGroup: boolean; unread: number }>;
    client.close();

    expect(list.find((c) => c.isGroup)?.unread).toBe(0);
  });
});

describe("read API", () => {
  let server: ReturnType<typeof createServer> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  it("POST /read drives the injected script runner for a 1:1", async () => {
    const { dbPath } = fixture();
    const calls: string[][] = [];
    let fired: () => void;
    const ran = new Promise<void>((resolve) => (fired = resolve));
    const client = Client({
      dbPath,
      scriptRunner: (_source, args) => {
        calls.push([...args]);
        fired();
      },
    });
    server = createServer({ client, nameDir }, 0);

    // d:<handle> is the stable id of the 1:1 conversation.
    const id = encodeURIComponent("d:+15553334444");
    const res = await fetch(
      `http://localhost:${server.port}/api/conversations/${id}/read`,
      { method: "POST" },
    );
    expect(res.status).toBe(202); // fire-and-forget

    // markRead runs async off the request; wait for the AppleScript boundary.
    await Promise.race([
      ran,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("script runner never fired")), 2000),
      ),
    ]);
    client.close();

    // First arg to MarkReadScript is the handle to open.
    expect(calls[0]?.[0]).toBe("+15553334444");
  });
});
