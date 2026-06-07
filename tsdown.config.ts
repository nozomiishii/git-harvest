import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["lib/cli.ts"],
  loader: { ".ascii": "text" },
  outputOptions: { banner: "#!/usr/bin/env node" },
});
