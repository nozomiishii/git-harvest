import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

interface AntigravityConversationFixture {
  archived?: boolean;
  id: string;
  killed?: number;
  parentConversationId?: string;
  title?: string;
  workspacePaths: string[];
}

/**
テスト用の Antigravity 会話 DB と annotations ファイルを作る。

@param baseDir - Antigravity ホームディレクトリの保存先。

@param rows - DB に書き込む会話情報。
*/
export function createAntigravityState(
  baseDir: string,
  rows: AntigravityConversationFixture[],
): void {
  const dbPath = path.join(baseDir, "conversation_summaries.db");
  const annotationsDir = path.join(baseDir, "annotations");
  mkdirSync(annotationsDir, { recursive: true });

  const db = new DatabaseSync(dbPath);

  try {
    db.exec(
      "CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, parent_conversation_id TEXT NOT NULL DEFAULT '', killed INTEGER NOT NULL DEFAULT 0, workspace_uris TEXT NOT NULL DEFAULT '')",
    );

    const stmt = db.prepare(
      "INSERT INTO conversation_summaries (conversation_id, parent_conversation_id, killed, workspace_uris) VALUES (?, ?, ?, ?)",
    );

    for (const row of rows) {
      const uris = JSON.stringify(row.workspacePaths.map((dir) => pathToFileURL(dir).href));
      stmt.run(row.id, row.parentConversationId ?? "", row.killed ?? 0, uris);

      if (row.archived === undefined && row.title === undefined) {
        continue;
      }

      const title = JSON.stringify(row.title ?? "test");
      const content = row.archived ? `title:${title} archived:true\n` : `title:${title}\n`;
      writeFileSync(path.join(annotationsDir, `${row.id}.pbtxt`), content);
    }
  } finally {
    db.close();
  }
}
