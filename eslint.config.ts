// @see https://eslint.org/
// @see https://github.com/nozomiishii/configs/tree/main/packages/eslint-config
import { defineConfig, node } from "@nozomiishii/eslint-config";

export default defineConfig([
  ...node(),

  {
    rules: {
      // test は execSync(bash) で子プロセスに env を渡すため、必要な変数だけ process.env から読む
      "n/no-process-env": ["error", { allowedVariables: ["HOME", "PATH"] }],
    },
  },
]);
