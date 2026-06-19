import assert from "node:assert/strict";
import test from "node:test";
import { settleDetachedMirror } from "../src/turns/submit";

test("settleDetachedMirror reports completed mirrors", async () => {
  const status = await settleDetachedMirror({
    promise: Promise.resolve(),
  });

  assert.deepEqual(status, { status: "completed" });
});

test("settleDetachedMirror times out and keeps background work alive", async () => {
  let resolveMirror!: () => void;
  const mirror = new Promise<void>((resolve) => {
    resolveMirror = resolve;
  });
  const waitUntilPromises: Promise<void>[] = [];

  const status = await settleDetachedMirror({
    promise: mirror,
    timeoutMs: 1,
    waitUntil: (promise) => waitUntilPromises.push(promise),
  });

  assert.deepEqual(status, { status: "timed_out" });
  assert.equal(waitUntilPromises.length, 1);

  resolveMirror();
  await waitUntilPromises[0];
});

test("settleDetachedMirror can tolerate mirror errors after admission", async () => {
  const errors: unknown[] = [];

  const status = await settleDetachedMirror({
    promise: Promise.reject(new Error("Network connection lost.")),
    tolerateErrors: true,
    onError: (error) => errors.push(error),
  });

  assert.deepEqual(status, { status: "failed", error: "Network connection lost." });
  assert.equal(errors.length, 1);
});

test("settleDetachedMirror throws mirror errors by default", async () => {
  await assert.rejects(
    settleDetachedMirror({
      promise: Promise.reject(new Error("boom")),
    }),
    /boom/,
  );
});
