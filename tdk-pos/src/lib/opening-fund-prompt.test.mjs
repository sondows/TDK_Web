import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldPromptForOpeningFund } from "./opening-fund-prompt.ts";

test("opening fund prompt follows enabled daily registration and login dismissal", () => {
  assert.equal(shouldPromptForOpeningFund({ enabled: true, registered: false }, false), true);
  assert.equal(shouldPromptForOpeningFund({ enabled: true, registered: false }, true), false);
  assert.equal(shouldPromptForOpeningFund({ enabled: true, registered: true }, false), false);
  assert.equal(shouldPromptForOpeningFund({ enabled: false, registered: false }, false), false);
});
