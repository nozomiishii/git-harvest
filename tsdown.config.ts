import { copyFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "tsdown";

// logo.ascii は lib/ui/ に置き、build 時に dist/ へコピーする。
// dev (tsx) は lib/ui/logo.ascii、bundle 後の dist/cli.mjs は隣の dist/logo.ascii を読む
export default defineConfig({
  entry: ["lib/cli.ts"],
  hooks: {
    "build:done": async (context) => {
      await copyFile("lib/ui/logo.ascii", path.join(context.options.outDir, "logo.ascii"));
    },
  },
  outputOptions: { banner: "#!/usr/bin/env node" },
});
