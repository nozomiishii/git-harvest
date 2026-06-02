import { defineConfig } from "tsdown";

export default defineConfig({
  banner: "#!/usr/bin/env node",
  dts: false,
  entry: ["lib/cli.ts"],
  format: "esm",
  outputOptions: {
    entryFileNames: "git-harvest",
  },
  platform: "node",
});
