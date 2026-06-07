// @see https://eslint.org/
// @see https://github.com/nozomiishii/configs/tree/main/packages/eslint-config
import { defineConfig, node } from "@nozomiishii/eslint-config";

export default defineConfig([
  ...node(),

  {
    rules: {
      // bash test の execSync 用 (HOME/PATH) と TS 実装が読む runtime env を許可
      "n/no-process-env": [
        "error",
        { allowedVariables: ["HOME", "PATH", "NO_COLOR", "GIT_HARVEST_CLAUDE_SESSIONS_DIR"] },
      ],
    },
  },
]);
