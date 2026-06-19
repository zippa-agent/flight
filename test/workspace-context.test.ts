import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkspaceContext } from "../src/agent/workspace-context";
import { workspaceRootPrefix } from "../src/sandboxes/r2-workspace";
import { FakeR2Bucket } from "./support/fake-r2";

const AGENT_ID = "6884e994-60f4-4395-8008-38f73989c34d";

test("workspace context loads the same identity and memory files as Troublemaker", async () => {
  const bucket = new FakeR2Bucket();
  const prefix = workspaceRootPrefix(AGENT_ID);

  await bucket.r2.put(`${prefix}AGENTS.md`, "Agent operating notes.");
  await bucket.r2.put(`${prefix}IDENTITY.md`, "Floopy identity.");
  await bucket.r2.put(`${prefix}SOUL.md`, "Floopy soul.");
  await bucket.r2.put(`${prefix}USER.md`, "Alex profile.");
  await bucket.r2.put(`${prefix}MEMORY.md`, "Persistent memory.");
  await bucket.r2.put(`${prefix}BRIEF.md`, "Current operator brief.");
  await bucket.r2.put(`${prefix}memory/2026-06-19.md`, "Today memory.");
  await bucket.r2.put(`${prefix}memory/2026-06-18.md`, "Yesterday memory.");

  const context = await loadWorkspaceContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    ownerId: AGENT_ID,
    now: new Date("2026-06-19T14:15:00.000Z"),
  });

  assert.match(context, /Flight workspace context/);
  assert.match(context, /Agents:\nAgent operating notes/);
  assert.match(context, /Identity:\nFloopy identity/);
  assert.match(context, /Soul:\nFloopy soul/);
  assert.match(context, /User Profile:\nAlex profile/);
  assert.match(context, /Memory:\nPersistent memory/);
  assert.match(context, /Current Brief \(assigned by operator\):\nCurrent operator brief/);
  assert.match(context, /Recent:\n### 2026-06-19\nToday memory/);
  assert.match(context, /### 2026-06-18\nYesterday memory/);
});

test("workspace context lets BOOTSTRAP.md replace the broader identity stack", async () => {
  const bucket = new FakeR2Bucket();
  const prefix = workspaceRootPrefix(AGENT_ID);

  await bucket.r2.put(`${prefix}BOOTSTRAP.md`, "Bootstrap wins.");
  await bucket.r2.put(`${prefix}IDENTITY.md`, "Hidden identity.");
  await bucket.r2.put(`${prefix}MEMORY.md`, "Hidden memory.");

  const context = await loadWorkspaceContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    ownerId: AGENT_ID,
    now: new Date("2026-06-19T14:15:00.000Z"),
  });

  assert.match(context, /Bootstrap:\nBootstrap wins/);
  assert.doesNotMatch(context, /Hidden identity/);
  assert.doesNotMatch(context, /Hidden memory/);
});

test("workspace context reports empty memory when no memory file exists", async () => {
  const bucket = new FakeR2Bucket();

  const context = await loadWorkspaceContext({
    env: { FLIGHT_WORKSPACE: bucket.r2 },
    ownerId: AGENT_ID,
    now: new Date("2026-06-19T14:15:00.000Z"),
  });

  assert.match(context, /Memory:\n\(no working memory yet\)/);
});
