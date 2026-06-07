import { defineConfig } from "tsdown";

// entry 以外はデフォルト: outDir=dist / format=esm / 拡張子=.mjs。banner で shebang のみ付与
export default defineConfig({
  entry: ["lib/cli.ts"],
  outputOptions: { banner: "#!/usr/bin/env node" },
});
