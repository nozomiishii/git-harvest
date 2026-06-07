import { expect, test } from "vitest";
import { logo } from "./brand";

// logo に GIT / HARVEST の字が含まれる
test("logo contains the wordmark letters", () => {
  const out = logo(false);

  expect(out).toContain("G I T");
  expect(out).toContain("H A R V E S T");
});
