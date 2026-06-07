import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // .ascii を text として読み込む（tsdown の loader 設定に対応）
  plugins: [
    {
      load(id: string) {
        if (id.endsWith(".ascii")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }

        return null;
      },
      name: "ascii-as-text",
    },
  ],
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
