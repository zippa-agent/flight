import assert from "node:assert/strict";
import test from "node:test";
import {
  formatContactList,
  formatResolvedIdentity,
  readContactBook,
  rememberContactIdentity,
} from "../src/listener/contacts";
import { FakeR2Bucket } from "./support/fake-r2";
import type { Env } from "../src/env";

const agentId = "6884e994-60f4-4395-8008-38f73989c34d";

test("contact book stores normalized identities in the agent R2 workspace", async () => {
  const bucket = new FakeR2Bucket();
  const env = { FLIGHT_WORKSPACE: bucket.r2 } as unknown as Env;

  const result = await rememberContactIdentity({
    env,
    agentId,
    identityKind: "phone",
    identity: "(512) 417-8113",
    displayName: "Alex",
    kind: "person",
    confidence: "confirmed",
  });

  assert.equal(result.identityKey, "phone:+15124178113");
  assert.deepEqual(bucket.keys(), [
    `tiny-agents-data/${agentId}/.flight/contacts.json`,
  ]);

  const book = await readContactBook(env, agentId);
  assert.equal(book.identities["phone:+15124178113"].displayName, "Alex");
  assert.equal(formatResolvedIdentity(book, "+1 512 417 8113"), "Alex (+15124178113)");
  assert.deepEqual(formatContactList(book, ["+15124178113", "+1 (512) 417-8113"]), [
    "Alex (+15124178113)",
  ]);
});
