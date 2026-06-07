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
      // bash test の execSync 用 (HOME/PATH) と TS 実装が読む runtime env を許可
      "n/no-process-env": [
        "error",
        { allowedVariables: ["HOME", "PATH", "NO_COLOR", "GIT_HARVEST_CLAUDE_SESSIONS_DIR"] },
      ],
    },
  },

  {
    files: ["**/*.test.ts"],
    rules: {
      // discriminated union を if で絞る型ナローイングガードを許可（テスト分岐ではない）
      "vitest/no-conditional-in-test": "off",
      // 定数名をそのままタイトルに使う場合（例: "SAFETY orders..."）を許可
      "vitest/prefer-lowercase-title": "off",
      // 型・undefined を厳密に区別しない配列比較は toEqual で十分
      "vitest/prefer-strict-equal": "off",
    },
  },
]);
