import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { SQL } from "./sql.ts";
export { App, Message } from "./db/index.ts";

export namespace DB {
  export async function open(file: string): Promise<Database> {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const db = new Database(file, { create: true });
    for (const query of SQL.INIT) {
      db.run(query);
    }
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA foreign_keys=ON");
    return db;
  }

  export async function close(db: Promise<Database> | Database) {
    const handle = await db;
    handle.close();
  }
}
