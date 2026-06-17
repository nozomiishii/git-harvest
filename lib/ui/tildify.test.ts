import { homedir } from "node:os";
import { expect, test } from "vitest";
import { tildify } from "./tildify";

// home dir は ~ に短縮
test("tildify shortens the home directory to a tilde", () => {
  expect(tildify(`${homedir()}/repo/x`)).toBe("~/repo/x");
});
