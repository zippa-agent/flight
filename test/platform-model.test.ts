import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FIREWORKS_MODEL, fireworksModelId, fireworksModelLimits } from "../src/platform/model";

test("flight defaults to Fireworks GLM 5.2", () => {
  assert.equal(DEFAULT_FIREWORKS_MODEL, "fireworks/accounts/fireworks/models/glm-5p2");
  assert.equal(fireworksModelId(DEFAULT_FIREWORKS_MODEL), "accounts/fireworks/models/glm-5p2");
});

test("flight records GLM 5.2 token limits for dynamic TinyFat providers", () => {
  assert.deepEqual(fireworksModelLimits("accounts/fireworks/models/glm-5p2"), {
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  });
});
