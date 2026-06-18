import { DatabaseSync } from "node:sqlite";

export function createCodexStateDb(
  dbPath: string,
  rows: { archived: number; cwd: string; id: string; threadSource: string }[],
): void {
  const db = new DatabaseSync(dbPath);

  db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, archived INTEGER, thread_source TEXT)");

  const stmt = db.prepare(
    "INSERT INTO threads (id, cwd, archived, thread_source) VALUES (?, ?, ?, ?)",
  );

  for (const row of rows) {
    stmt.run(row.id, row.cwd, row.archived, row.threadSource);
  }
  db.close();
}
