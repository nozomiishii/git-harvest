import { homedir } from "node:os";
import { expect, test } from "vitest";
import { relpath } from "./relpath";

// home dir は ~ に短縮
test("relpath shortens the home directory to a tilde", () => {
  expect(relpath(`${homedir()}/repo/x`)).toBe("~/repo/x");
});
