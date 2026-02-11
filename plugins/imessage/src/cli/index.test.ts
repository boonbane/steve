import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";

const APPLE_EPOCH_MS = 978_307_200_000;

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
    "CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, service_name TEXT)",
  );
  db.run("CREATE TABLE message (ROWID INTEGER PRIMARY KEY, date INTEGER)");
  db.run(
    "CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)",
  );

  db.run(
    "INSERT INTO chat(ROWID, chat_identifier, display_name, service_name) VALUES (?1, ?2, ?3, ?4)",
    [1, "iMessage;+;chat123", "Friends", "iMessage"],
  );

  const now = BigInt(Date.now() - APPLE_EPOCH_MS) * 1_000_000n;
  db.run("INSERT INTO message(ROWID, date) VALUES (?1, ?2)", [1, now]);
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
  });
});
