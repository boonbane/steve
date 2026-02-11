import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";

const APPLE_EPOCH_MS = 978_307_200_000;

function toAppleNs(time: number): bigint {
  return BigInt(time - APPLE_EPOCH_MS) * 1_000_000n;
}

async function makeDb(): Promise<{ dir: string; dbPath: string }> {
  const dir = path.join(
    import.meta.dir,
    "..",
    "..",
    ".cache",
    "scratch",
    crypto.randomUUID(),
  );
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
    [1, "iMessage;+;chat123", "iMessage;+;chat123", "Friends", "iMessage"],
  );

  db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [1, "+15551234567"]);
  db.run(
    "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    [
      1,
      1,
      "hello",
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

  return { dir, dbPath };
}

describe("imessage cli", () => {
  it("prints chats in table output", async () => {
    const { dir, dbPath } = await makeDb();
    const cliPath = path.join(import.meta.dir, "index.ts");

    const proc = Bun.spawn(
      [process.execPath, cliPath, "chats", "--db", dbPath],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    await fs.promises.rm(dir, { recursive: true, force: true });

    expect(code).toBe(0);
    expect(out).toContain("identifier");
    expect(out).toContain("Friends");
  });

  it("prints history in table output", async () => {
    const { dir, dbPath } = await makeDb();
    const cliPath = path.join(import.meta.dir, "index.ts");

    const proc = Bun.spawn(
      [process.execPath, cliPath, "history", "1", "--db", dbPath],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    await fs.promises.rm(dir, { recursive: true, force: true });

    expect(code).toBe(0);
    expect(out).toContain("service");
    expect(out).toContain("hello");
  });

  it("prints one watched message and exits with count", async () => {
    const { dir, dbPath } = await makeDb();
    const cliPath = path.join(import.meta.dir, "index.ts");

    const proc = Bun.spawn(
      [process.execPath, cliPath, "watch", "--db", dbPath, "--count", "1"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await Bun.sleep(300);

    const db = new Database(dbPath);
    db.run("INSERT INTO handle(ROWID, id) VALUES (?1, ?2)", [
      2,
      "+15550002222",
    ]);
    db.run(
      "INSERT INTO message(ROWID, handle_id, text, destination_caller_id, date, is_from_me, service, associated_message_type, attributedBody) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      [
        2,
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
      [1, 2],
    );
    db.close();

    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    await fs.promises.rm(dir, { recursive: true, force: true });

    expect(code).toBe(0);
    expect(out).toContain("watching for new messages");
    expect(out).toContain("live");
  });

  it("returns non-zero when send chat id is missing", async () => {
    const { dir, dbPath } = await makeDb();
    const cliPath = path.join(import.meta.dir, "index.ts");

    const proc = Bun.spawn(
      [process.execPath, cliPath, "send", "999", "hello", "--db", dbPath],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    await fs.promises.rm(dir, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(err).toContain("Chat 999 not found");
  });

  it("uses custom help output", async () => {
    const cliPath = path.join(import.meta.dir, "index.ts");

    const proc = Bun.spawn([process.execPath, cliPath, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(out).toContain("usage:");
    expect(out).toContain("commands");
    expect(out).toContain("chats");
    expect(out).toContain("history");
    expect(out).toContain("send");
    expect(out).toContain("watch");
  });
});
