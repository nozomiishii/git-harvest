// @see https://eslint.org/
// @see https://github.com/nozomiishii/configs/tree/main/packages/eslint-config
import { defineConfig, node } from "@nozomiishii/eslint-config";

export default defineConfig([
  ...node(),

  {
    rules: {
      // process.env を直接読んでよい env だけ許可する（ほかは禁止のまま）。
      "n/no-process-env": [
        "error",
        { allowedVariables: ["GIT_HARVEST_CLAUDE_SESSIONS_DIR", "NO_COLOR"] },
      ],
    },
  },
]);
