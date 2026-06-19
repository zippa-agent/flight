import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("Flue runtime patch requires tool labels before execution", () => {
  const resultBundle = readFileSync(
    join(root, "node_modules", "@flue", "runtime", "dist", "result-BBoC0jFG.mjs"),
    "utf8",
  );

  assert.match(resultBundle, /TINYFAT_TOOL_LABEL_PATCH = "required-tool-label-v1"/);
  assert.match(resultBundle, /assertRequiredToolLabel\(tool\.name, params\)/);
  assert.match(resultBundle, /parameters: withRequiredToolLabelSchema\(tool\.parameters\)/);
  assert.match(resultBundle, /return withRequiredToolLabels\(tools\)/);
});

test("Flue runtime patch emits top-level tool labels", () => {
  const sessionBundle = readFileSync(
    join(root, "node_modules", "@flue", "runtime", "dist", "persisted-image-placement-qyxGKalp.mjs"),
    "utf8",
  );

  assert.match(sessionBundle, /label: cleanTinyFatToolLabel\(event\.args\?\.label\)/);
  assert.match(sessionBundle, /\.\.\.\(label \? \{ label \} : \{\}\)/);
});
