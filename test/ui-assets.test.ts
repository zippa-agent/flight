import assert from "node:assert/strict";
import test from "node:test";
import { APP_CSS, APP_JS } from "../src/ui/assets";

test("colocated UI does not reference Crawdad-hosted hashed assets", () => {
  const combined = `${APP_CSS}\n${APP_JS}`;
  assert.equal(combined.includes("crawdad"), false);
  assert.equal(/index-[A-Za-z0-9_-]+\.js/.test(combined), false);
  assert.equal(/index-[A-Za-z0-9_-]+\.css/.test(combined), false);
});

test("colocated UI includes tool and thinking render paths", () => {
  assert.match(APP_JS, /tool_start/);
  assert.match(APP_JS, /tool_result/);
  assert.match(APP_JS, /thinking_delta/);
});
