import { copyFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "tsdown";

// logo.ascii はソースと同じ lib/ に置き、build 時に dist/ へコピーする。
// 実行時は new URL("./logo.ascii", import.meta.url) で dev / build どちらの隣も指す
export default defineConfig({
  entry: ["lib/cli.ts"],
  hooks: {
    "build:done": async (context) => {
      await copyFile("lib/logo.ascii", path.join(context.options.outDir, "logo.ascii"));
    },
  },
  outputOptions: { banner: "#!/usr/bin/env node" },
});
