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
    "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_responses_timestamp ON responses(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_responses_message_id ON responses(message_id)",
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
}
