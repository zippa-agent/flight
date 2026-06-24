import assert from "node:assert/strict";
import test from "node:test";
import { readGoalState } from "../src/agent/goal-state";
import { createAbandonGoalTool } from "../src/tools/abandon-goal";
import { createCompleteGoalTool } from "../src/tools/complete-goal";
import { createSetGoalTool } from "../src/tools/set-goal";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";
const instanceId = `${agentId}--agent--d2Vi`;

test("goal tools set and complete the active goal", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  const setGoal = createSetGoalTool({ env, instanceId });
  const completeGoal = createCompleteGoalTool({ env, instanceId });

  const setResult = await setGoal.execute?.({
    label: "Set the active goal",
    goal: "Ship the Flight goal-mode PR",
  }, new AbortController().signal);

  assert.equal(setResult, "Set active goal: Ship the Flight goal-mode PR");
  let state = await readGoalState(bucket.r2, agentId);
  assert.equal(state?.status, "active");
  assert.equal(state?.goal, "Ship the Flight goal-mode PR");

  const completeResult = await completeGoal.execute?.({
    label: "Complete the active goal",
  }, new AbortController().signal);

  assert.equal(completeResult, "Completed goal: Ship the Flight goal-mode PR");
  state = await readGoalState(bucket.r2, agentId);
  assert.equal(state?.status, "completed");
  assert.equal(typeof state?.completedAt, "string");
});

test("abandon_goal stores a reason for the active goal", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;
  const setGoal = createSetGoalTool({ env, instanceId });
  const abandonGoal = createAbandonGoalTool({ env, instanceId });

  await setGoal.execute?.({
    label: "Set the active goal",
    goal: "Draft the old goal",
  }, new AbortController().signal);

  const result = await abandonGoal.execute?.({
    label: "Abandon the active goal",
    reason: "Superseded by PR cleanup",
  }, new AbortController().signal);

  assert.equal(result, "Abandoned goal: Draft the old goal (Superseded by PR cleanup)");
  const state = await readGoalState(bucket.r2, agentId);
  assert.equal(state?.status, "abandoned");
  assert.equal(state?.reason, "Superseded by PR cleanup");
  assert.equal(typeof state?.completedAt, "string");
});
