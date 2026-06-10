import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["lib/cli.ts"],
  outputOptions: { banner: "#!/usr/bin/env node" },
});
