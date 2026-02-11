import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { Client } from "./index.ts";

const APPLE_EPOCH_MS = 978_307_200_000;

describe("Client", () => {
  it("list() returns SOMETHING", async () => {
    const dir = path.join(
      import.meta.dir,
      "..",
      ".cache",
      "scratch",
      crypto.randomUUID(),
    );
    await fs.promises.mkdir(dir, { recursive: true });

    const dbPath = path.join(dir, "chat.db");
    const db = new Database(dbPath, { create: true });

    db.run(
      "CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, service_name TEXT)",
    );
    db.run("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, date INTEGER)");
    db.run(
      "CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)",
    );

    db.run(
      "INSERT INTO chat(ROWID, chat_identifier, display_name, service_name) VALUES (?1, ?2, ?3, ?4)",
      [1, "+15551234567", "Test Chat", "iMessage"],
    );

    const now = BigInt(Date.now() - APPLE_EPOCH_MS) * 1_000_000n;
    db.run("INSERT INTO message(ROWID, date) VALUES (?1, ?2)", [1, now]);
    db.run(
      "INSERT INTO chat_message_join(chat_id, message_id) VALUES (?1, ?2)",
      [1, 1],
    );

    db.close();

    const client = Client({ dbPath });
    const chats = client.list();
    client.close();

    expect(chats.length).toBeGreaterThan(0);

    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
