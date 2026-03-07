export namespace SQL {
  export const INIT = [
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL UNIQUE,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )`,
    `CREATE TABLE IF NOT EXISTS app (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS trigger_state (
      name TEXT PRIMARY KEY,
      last_scheduled_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS trigger_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      error TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_responses_timestamp ON responses(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_responses_message_id ON responses(message_id)",
    "CREATE INDEX IF NOT EXISTS idx_trigger_runs_name ON trigger_runs(name)",
    "CREATE INDEX IF NOT EXISTS idx_trigger_runs_scheduled_at ON trigger_runs(scheduled_at)",
  ];

  export const MESSAGE_ADD =
    "INSERT INTO messages (text, timestamp) VALUES (?1, ?2) RETURNING id, text, timestamp";

  export const RESPONSE_ADD =
    "INSERT INTO responses (message_id, text, timestamp) VALUES (?1, ?2, ?3) RETURNING id, message_id, text, timestamp";

  export const MESSAGE_LIST = `
SELECT
  m.id as id,
  m.text as text,
  m.timestamp as timestamp,
  r.id as response_id,
  r.text as response_text,
  r.timestamp as response_timestamp
FROM messages m
LEFT JOIN responses r ON r.message_id = m.id
ORDER BY m.timestamp DESC
LIMIT ?1
`;

  export const APP_GET = "SELECT key, value FROM app WHERE key = ?1";

  export const APP_SET =
    "INSERT INTO app (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

  export const TRIGGER_STATE_GET =
    "SELECT name, last_scheduled_at FROM trigger_state WHERE name = ?1";

  export const TRIGGER_STATE_SET = `
INSERT INTO trigger_state (name, last_scheduled_at)
VALUES (?1, ?2)
ON CONFLICT(name) DO UPDATE SET
  last_scheduled_at = excluded.last_scheduled_at
RETURNING name, last_scheduled_at
`;

  export const TRIGGER_RUN_ADD =
    "INSERT INTO trigger_runs (name, scheduled_at, started_at, status) VALUES (?1, ?2, ?3, ?4) RETURNING id, name, scheduled_at, started_at, finished_at, status, error";

  export const TRIGGER_RUN_FINISH =
    "UPDATE trigger_runs SET finished_at = ?2, status = ?3, error = ?4 WHERE id = ?1 RETURNING id, name, scheduled_at, started_at, finished_at, status, error";

  export const TRIGGER_RUN_LIST = `
SELECT
  id,
  name,
  scheduled_at,
  started_at,
  finished_at,
  status,
  error
FROM trigger_runs
WHERE name = ?1
ORDER BY scheduled_at ASC, id ASC
`;
}
