// @see https://eslint.org/
// @see https://github.com/nozomiishii/configs/tree/main/packages/eslint-config
import { defineConfig, node } from "@nozomiishii/eslint-config";

export default defineConfig([
  ...node(),

  // エラーの解決手順や、よくある対応パターンはこちらにまとめています:
  // https://github.com/nozomiishii/configs/blob/main/packages/eslint-config/docs/troubleshooting.md
  {
    name: "project/overrides",
    rules: {
      // runtime が読む env のみ許可（NO_COLOR は ui.ts、SESSIONS_DIR は agent.ts + テスト）
      "n/no-process-env": [
        "error",
        { allowedVariables: ["NO_COLOR", "GIT_HARVEST_CLAUDE_SESSIONS_DIR"] },
      ],
      // node:sqlite は Node 24 で experimental だが、Codex の state DB 読み取りに使う
      "n/no-unsupported-features/node-builtins": ["error", { ignores: ["sqlite"] }],
    },
  },
]);
