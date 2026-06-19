import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtimeDist = join(root, "node_modules", "@flue", "runtime", "dist");
const resultBundle = join(runtimeDist, "result-BBoC0jFG.mjs");
const sessionBundle = join(runtimeDist, "persisted-image-placement-qyxGKalp.mjs");
const checkOnly = process.argv.includes("--check");

patchResultBundle();
patchSessionBundle();

function patchResultBundle() {
  let source = readRequired(resultBundle);
  const original = source;

  source = replaceOnce(source,
    'const PACKAGED_SKILLS_ROOT = "/.flue/packaged-skills/";',
    `const PACKAGED_SKILLS_ROOT = "/.flue/packaged-skills/";
const TINYFAT_TOOL_LABEL_PATCH = "required-tool-label-v1";
const TINYFAT_TOOL_LABEL_DESCRIPTION = "Required. A concise, user-facing one-sentence description of why this tool is being used right now.";
function withRequiredToolLabelSchema(schema) {
\tif (!schema || typeof schema !== "object") return schema;
\tif (schema.properties?.label && Array.isArray(schema.required) && schema.required.includes("label")) return schema;
\tif (schema.type !== "object" || !schema.properties) return schema;
\tconst required = Array.isArray(schema.required) ? schema.required : [];
\treturn {
\t\t...schema,
\t\tproperties: {
\t\t\tlabel: Type.String({ description: TINYFAT_TOOL_LABEL_DESCRIPTION }),
\t\t\t...schema.properties
\t\t},
\t\trequired: [...new Set(["label", ...required])]
\t};
}
function assertRequiredToolLabel(toolName, params) {
\tconst label = params && typeof params === "object" && !Array.isArray(params) ? params.label : void 0;
\tif (typeof label === "string" && label.replace(/\\s+/gu, " ").trim()) return;
\tthrow new Error(\`[flue] Tool "\${toolName}" requires a non-empty label argument describing the action for the user.\`);
}
function withoutToolLabel(params) {
\tif (!params || typeof params !== "object" || Array.isArray(params)) return params;
\tconst { label: _label, ...rest } = params;
\treturn rest;
}
function withRequiredToolLabel(tool) {
\tif (tool?.__tinyfatRequiresToolLabel) return tool;
\treturn {
\t\t...tool,
\t\t__tinyfatRequiresToolLabel: true,
\t\tparameters: withRequiredToolLabelSchema(tool.parameters),
\t\tasync execute(toolCallId, params, signal) {
\t\t\tassertRequiredToolLabel(tool.name, params);
\t\t\treturn tool.execute(toolCallId, withoutToolLabel(params), signal);
\t\t}
\t};
}
function withRequiredToolLabels(tools) {
\treturn tools.map((tool) => withRequiredToolLabel(tool));
}`,
    "insert tool label helpers in Flue result bundle",
  );

  source = replaceOnce(source,
    "\treturn tools;\n}",
    "\treturn withRequiredToolLabels(tools);\n}",
    "wrap default Flue built-in tools",
  );

  writeIfChanged(resultBundle, original, source);
}

function patchSessionBundle() {
  let source = readRequired(sessionBundle);
  const original = source;

  source = replaceOnce(source,
    `\treturn {
\t\ttype: "toolCall",
\t\tid: block.id,
\t\tname: block.name,
\t\targuments: block.arguments,
\t\tthoughtSignature: block.thoughtSignature
\t};`,
    `\tconst label = cleanTinyFatToolLabel(block.label) || cleanTinyFatToolLabel(block.arguments?.label);
\treturn {
\t\ttype: "toolCall",
\t\tid: block.id,
\t\tname: block.name,
\t\t...(label ? { label } : {}),
\t\targuments: block.arguments,
\t\tthoughtSignature: block.thoughtSignature
\t};`,
    "preserve Flue tool labels in turn content",
  );

  source = replaceOnce(source,
    "function getRegisteredPackagedSkills(skills, packagedSkills) {",
    `const TINYFAT_TOOL_LABEL_DESCRIPTION = "Required. A concise, user-facing one-sentence description of why this tool is being used right now.";
function cleanTinyFatToolLabel(value) {
\tif (typeof value !== "string") return "";
\treturn value.replace(/\\s+/gu, " ").trim();
}
function withTinyFatRequiredToolLabelSchema(schema) {
\tif (!schema || typeof schema !== "object") return schema;
\tif (schema.properties?.label && Array.isArray(schema.required) && schema.required.includes("label")) return schema;
\tif (schema.type !== "object" || !schema.properties) return schema;
\tconst required = Array.isArray(schema.required) ? schema.required : [];
\treturn {
\t\t...schema,
\t\tproperties: {
\t\t\tlabel: { type: "string", description: TINYFAT_TOOL_LABEL_DESCRIPTION },
\t\t\t...schema.properties
\t\t},
\t\trequired: [...new Set(["label", ...required])]
\t};
}
function assertTinyFatRequiredToolLabel(toolName, params) {
\tconst label = params && typeof params === "object" && !Array.isArray(params) ? params.label : void 0;
\tif (cleanTinyFatToolLabel(label)) return;
\tthrow new Error(\`[flue] Tool "\${toolName}" requires a non-empty label argument describing the action for the user.\`);
}
function withoutTinyFatToolLabel(params) {
\tif (!params || typeof params !== "object" || Array.isArray(params)) return params;
\tconst { label: _label, ...rest } = params;
\treturn rest;
}
function withTinyFatRequiredToolLabel(tool) {
\tif (tool?.__tinyfatRequiresToolLabel) return tool;
\treturn {
\t\t...tool,
\t\t__tinyfatRequiresToolLabel: true,
\t\tparameters: withTinyFatRequiredToolLabelSchema(tool.parameters),
\t\tasync execute(toolCallId, params, signal) {
\t\t\tassertTinyFatRequiredToolLabel(tool.name, params);
\t\t\treturn tool.execute(toolCallId, withoutTinyFatToolLabel(params), signal);
\t\t}
\t};
}
function withTinyFatRequiredToolLabels(tools) {
\treturn tools.map((tool) => withTinyFatRequiredToolLabel(tool));
}
function getRegisteredPackagedSkills(skills, packagedSkills) {`,
    "insert Flue tool label cleaner",
  );

  source = replaceOnce(source,
    `\t\t\t\t\tthis.emit({
\t\t\t\t\t\ttype: "tool_start",
\t\t\t\t\t\ttoolName: event.toolName,
\t\t\t\t\t\ttoolCallId: event.toolCallId,
\t\t\t\t\t\targs: event.args
\t\t\t\t\t});`,
    `\t\t\t\t\tthis.emit({
\t\t\t\t\t\ttype: "tool_start",
\t\t\t\t\t\ttoolName: event.toolName,
\t\t\t\t\t\ttoolCallId: event.toolCallId,
\t\t\t\t\t\tlabel: cleanTinyFatToolLabel(event.args?.label),
\t\t\t\t\t\targs: event.args
\t\t\t\t\t});`,
    "emit Flue tool_start labels",
  );

  source = replaceOnce(source,
    "\t\tconst appendActivateSkillTool = (builtinTools) => activateSkillTool ? [...builtinTools, activateSkillTool] : builtinTools;",
    "\t\tconst appendActivateSkillTool = (builtinTools) => activateSkillTool ? [...builtinTools, withTinyFatRequiredToolLabel(activateSkillTool)] : builtinTools;",
    "wrap Flue activate_skill tool",
  );

  source = replaceOnce(source,
    "\t\t\treturn appendActivateSkillTool([...adapterTools, createTaskTool(runTask, this.config.subagents ?? {})]);",
    "\t\t\treturn withTinyFatRequiredToolLabels(appendActivateSkillTool([...adapterTools, createTaskTool(runTask, this.config.subagents ?? {})]));",
    "wrap Flue adapter tools",
  );

  source = replaceOnce(source,
    `\t\treturn appendActivateSkillTool(createTools(env, {
\t\t\tsubagents: this.config.subagents ?? {},
\t\t\tpackagedSkills,
\t\t\ttask: runTask
\t\t}));
\t}`,
    `\t\treturn withTinyFatRequiredToolLabels(appendActivateSkillTool(createTools(env, {
\t\t\tsubagents: this.config.subagents ?? {},
\t\t\tpackagedSkills,
\t\t\ttask: runTask
\t\t})));
\t}`,
    "wrap Flue default tool set",
  );

  source = replaceOnce(source,
    `\t\t\treturn {
\t\t\t\tname: toolDef.name,
\t\t\t\tlabel: toolDef.name,
\t\t\t\tdescription: toolDef.description,
\t\t\t\tparameters: toolDef.parameters,
\t\t\t\tasync execute(_toolCallId, params, signal) {
\t\t\t\t\tif (signal?.aborted) throw abortErrorFor(signal);
\t\t\t\t\treturn {
\t\t\t\t\t\tcontent: [{
\t\t\t\t\t\t\ttype: "text",
\t\t\t\t\t\t\ttext: await toolDef.execute(params, signal)
\t\t\t\t\t\t}],
\t\t\t\t\t\tdetails: { customTool: toolDef.name }
\t\t\t\t\t};
\t\t\t\t}
\t\t\t};`,
    `\t\t\treturn withTinyFatRequiredToolLabel({
\t\t\t\tname: toolDef.name,
\t\t\t\tlabel: toolDef.name,
\t\t\t\tdescription: toolDef.description,
\t\t\t\tparameters: toolDef.parameters,
\t\t\t\tasync execute(_toolCallId, params, signal) {
\t\t\t\t\tif (signal?.aborted) throw abortErrorFor(signal);
\t\t\t\t\treturn {
\t\t\t\t\t\tcontent: [{
\t\t\t\t\t\t\ttype: "text",
\t\t\t\t\t\t\ttext: await toolDef.execute(params, signal)
\t\t\t\t\t\t}],
\t\t\t\t\t\tdetails: { customTool: toolDef.name }
\t\t\t\t\t};
\t\t\t\t}
\t\t\t});`,
    "wrap Flue custom tools",
  );

  writeIfChanged(sessionBundle, original, source);
}

function readRequired(file) {
  if (!existsSync(file)) {
    throw new Error(`Cannot patch Flue runtime; missing ${file}`);
  }
  return readFileSync(file, "utf8");
}

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const index = source.indexOf(search);
  if (index === -1) {
    throw new Error(`Cannot patch Flue runtime: missing expected block for ${label}.`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function writeIfChanged(file, original, source) {
  if (source === original) return;
  if (checkOnly) {
    throw new Error(`Flue runtime patch is missing in ${file}. Run node scripts/patch-flue-tool-labels.mjs.`);
  }
  writeFileSync(file, source);
  console.log(`patched ${file.replace(`${root}/`, "")}`);
}
