import assert from "node:assert/strict";
import test from "node:test";
import { readGoalState, writeGoalState, renderGoalContext, type GoalState } from "../src/agent/goal-state";
import { FakeR2Bucket } from "./support/fake-r2";

const AGENT_ID = "6884e994-60f4-4395-8008-38f73989c34d";

test("readGoalState returns null when no goal is stored", async () => {
  const bucket = new FakeR2Bucket();
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.equal(result, null);
});

test("writeGoalState and readGoalState round-trip an active goal", async () => {
  const bucket = new FakeR2Bucket();
  const state: GoalState = {
    goal: "Ship the phone SMS reply PR today",
    setAt: "2026-06-23T21:00:00.000Z",
    status: "active",
  };
  await writeGoalState(bucket.r2, AGENT_ID, state);
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.deepEqual(result, state);
});

test("writeGoalState and readGoalState round-trip a completed goal", async () => {
  const bucket = new FakeR2Bucket();
  const state: GoalState = {
    goal: "Review Flight PR #1",
    setAt: "2026-06-23T20:00:00.000Z",
    status: "completed",
    completedAt: "2026-06-23T21:30:00.000Z",
  };
  await writeGoalState(bucket.r2, AGENT_ID, state);
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.deepEqual(result, state);
});

test("writeGoalState and readGoalState round-trip an abandoned goal with reason", async () => {
  const bucket = new FakeR2Bucket();
  const state: GoalState = {
    goal: "Draft scheduling DO design",
    setAt: "2026-06-23T19:00:00.000Z",
    status: "abandoned",
    completedAt: "2026-06-23T20:00:00.000Z",
    reason: "Blocked on issue #5 discussion first",
  };
  await writeGoalState(bucket.r2, AGENT_ID, state);
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.deepEqual(result, state);
});

test("readGoalState returns null for malformed JSON", async () => {
  const bucket = new FakeR2Bucket();
  const prefix = `tiny-agents-data/${AGENT_ID}/`;
  await bucket.r2.put(`${prefix}goal.json`, "not-json{{{");
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.equal(result, null);
});

test("readGoalState returns null for missing required fields", async () => {
  const bucket = new FakeR2Bucket();
  const prefix = `tiny-agents-data/${AGENT_ID}/`;
  await bucket.r2.put(`${prefix}goal.json`, JSON.stringify({ goal: "test" })); // missing status
  const result = await readGoalState(bucket.r2, AGENT_ID);
  assert.equal(result, null);
});

test("renderGoalContext returns empty string for null state", () => {
  const result = renderGoalContext(null);
  assert.equal(result, "");
});

test("renderGoalContext renders an active goal", () => {
  const state: GoalState = {
    goal: "Ship the phone SMS reply PR today",
    setAt: "2026-06-23T21:00:00.000Z",
    status: "active",
  };
  const result = renderGoalContext(state);
  assert.match(result, /ACTIVE/);
  assert.match(result, /Ship the phone SMS reply PR today/);
  assert.match(result, /2026-06-23T21:00:00.000Z/);
});

test("renderGoalContext renders a completed goal with closedAt", () => {
  const state: GoalState = {
    goal: "Review Flight PR #1",
    setAt: "2026-06-23T20:00:00.000Z",
    status: "completed",
    completedAt: "2026-06-23T21:30:00.000Z",
  };
  const result = renderGoalContext(state);
  assert.match(result, /COMPLETED/);
  assert.match(result, /2026-06-23T21:30:00.000Z/);
});

test("renderGoalContext renders an abandoned goal with reason", () => {
  const state: GoalState = {
    goal: "Draft scheduling DO",
    setAt: "2026-06-23T19:00:00.000Z",
    status: "abandoned",
    completedAt: "2026-06-23T20:00:00.000Z",
    reason: "Blocked on issue #5",
  };
  const result = renderGoalContext(state);
  assert.match(result, /ABANDONED/);
  assert.match(result, /Blocked on issue #5/);
});
