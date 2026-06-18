import type { Env } from "../env";

const DEFAULT_BUILD_COMMAND = [
  "if [ -f package-lock.json ]; then",
  "  npm ci --no-audit --no-fund;",
  "else",
  "  npm install --no-audit --no-fund;",
  "fi",
  "npm run build",
].join("\n");
const DEFAULT_OUTPUT_PATH = "dist";
const BUILD_TIMEOUT_SECONDS = 900;

export interface ContainerBuildSourceFile {
  path: string;
  content: Uint8Array;
}

export interface ContainerBuildInput {
  env: Env;
  agentId: string;
  sourceFiles: ContainerBuildSourceFile[];
  sourceTarball: ArrayBuffer;
  buildCommand?: string;
  outputPath?: string;
  signal?: AbortSignal;
}

export interface ContainerBuildResult {
  tarball: ArrayBuffer;
  command: string;
  outputPath: string;
  files: number;
  bytes: number;
  log: string;
}

interface HostToolResponse {
  ok?: boolean;
  error?: string;
  result?: unknown;
}

interface BuildMetadata {
  files?: number;
  bytes?: number;
}

export async function buildSiteInContainer(input: ContainerBuildInput): Promise<ContainerBuildResult> {
  if (!input.env.CRAWDAD_API_BASE || !input.env.CRAWDAD_API_TOKEN) {
    throw new Error("deploy_site needs Crawdad API access to build an unbuilt project.");
  }
  if (input.sourceFiles.length === 0) {
    throw new Error("No workspace files exist to build.");
  }

  const buildId = `flight-build-${crypto.randomUUID().replace(/-/g, "")}`;
  const targetDir = buildId;
  const sourceArchivePath = `${targetDir}/source.tar.gz`;
  const artifactPath = `${targetDir}/dist.tar.gz.b64`;
  const workDir = `/tmp/${buildId}`;
  const outputPath = normalizeOutputPath(input.outputPath || DEFAULT_OUTPUT_PATH);
  const command = cleanBuildCommand(input.buildCommand) || DEFAULT_BUILD_COMMAND;

  await uploadContainerFile({
    env: input.env,
    agentId: input.agentId,
    targetDir,
    filename: "source.tar.gz",
    content: input.sourceTarball,
    signal: input.signal,
  });

  let log = "";
  try {
    log = await executeContainerBash({
      env: input.env,
      agentId: input.agentId,
      command: buildScript({
        sourceArchivePath,
        artifactPath,
        workDir,
        outputPath,
        command,
      }),
      timeout: BUILD_TIMEOUT_SECONDS,
      signal: input.signal,
    });

    const encoded = await readContainerTextFile({
      env: input.env,
      agentId: input.agentId,
      path: artifactPath,
      signal: input.signal,
    });
    const tarball = base64ToArrayBuffer(encoded);
    const metadata = parseBuildMetadata(log);

    return {
      tarball,
      command,
      outputPath,
      files: metadata.files ?? 0,
      bytes: metadata.bytes ?? tarball.byteLength,
      log: logTail(log),
    };
  } finally {
    await executeContainerBash({
      env: input.env,
      agentId: input.agentId,
      command: `rm -rf ${shellQuote(workDir)} ${shellQuote(targetDir)}`,
      timeout: 60,
      signal: input.signal,
    }).catch(() => undefined);
  }
}

function buildScript(input: {
  sourceArchivePath: string;
  artifactPath: string;
  workDir: string;
  outputPath: string;
  command: string;
}): string {
  const sourceArchive = shellQuote(input.sourceArchivePath);
  const artifactPath = shellQuote(input.artifactPath);
  const workDir = shellQuote(input.workDir);
  const outputPath = shellQuote(input.outputPath);

  return [
    "set -eu",
    "ROOT=$(pwd)",
    `WORK=${workDir}`,
    `SOURCE_ARCHIVE=${sourceArchive}`,
    `ARTIFACT_PATH=${artifactPath}`,
    `OUTPUT_PATH=${outputPath}`,
    "rm -rf \"$WORK\"",
    "mkdir -p \"$WORK/source\" \"$WORK/home\" \"$WORK/npm-cache\" \"$(dirname \"$ARTIFACT_PATH\")\"",
    "cp \"$SOURCE_ARCHIVE\" \"$WORK/source.tar.gz\"",
    "tar -xzf \"$WORK/source.tar.gz\" -C \"$WORK/source\"",
    "cd \"$WORK/source\"",
    "export HOME=\"$WORK/home\"",
    "export npm_config_cache=\"$WORK/npm-cache\"",
    "export npm_config_update_notifier=false",
    input.command,
    "test -d \"$OUTPUT_PATH\"",
    "FILES=$(find \"$OUTPUT_PATH\" -type f | wc -l | tr -d ' ')",
    "BYTES=$(du -sb \"$OUTPUT_PATH\" | awk '{print $1}')",
    "tar -czf \"$WORK/dist.tar.gz\" -C \"$OUTPUT_PATH\" .",
    "base64 \"$WORK/dist.tar.gz\" > \"$ROOT/$ARTIFACT_PATH\"",
    "printf '__FLIGHT_BUILD_METADATA__{\"files\":%s,\"bytes\":%s}\\n' \"$FILES\" \"$BYTES\"",
  ].join("\n");
}

async function uploadContainerFile(input: {
  env: Env;
  agentId: string;
  targetDir: string;
  filename: string;
  content: ArrayBuffer;
  signal?: AbortSignal;
}): Promise<void> {
  const form = new FormData();
  form.set("targetDir", input.targetDir);
  form.set("file", new Blob([input.content], { type: "application/gzip" }), input.filename);
  const response = await fetch(crawdadUrl(input.env, `/api/v2/agents/${encodeURIComponent(input.agentId)}/upload`), {
    method: "POST",
    headers: authHeaders(input.env),
    body: form,
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Container source upload failed (${response.status}): ${text}`);
  }
}

async function executeContainerBash(input: {
  env: Env;
  agentId: string;
  command: string;
  timeout: number;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(crawdadUrl(input.env, `/api/v2/agents/${encodeURIComponent(input.agentId)}/tools/execute`), {
    method: "POST",
    headers: {
      ...authHeadersObject(input.env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: "bash",
      args: {
        label: "Build site",
        command: input.command,
        timeout: input.timeout,
      },
    }),
    signal: input.signal,
  });
  const text = await response.text();
  const body = parseHostToolResponse(text);
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || text || `Container bash failed (${response.status})`);
  }
  return hostToolResultText(body?.result);
}

async function readContainerTextFile(input: {
  env: Env;
  agentId: string;
  path: string;
  signal?: AbortSignal;
}): Promise<string> {
  const url = new URL(crawdadUrl(input.env, `/api/v2/agents/${encodeURIComponent(input.agentId)}/file`));
  url.searchParams.set("path", input.path);
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(input.env),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Container artifact read failed (${response.status}): ${text}`);
  }
  return text;
}

function crawdadUrl(env: Env, path: string): string {
  const base = env.CRAWDAD_API_BASE?.replace(/\/+$/g, "");
  if (!base) throw new Error("CRAWDAD_API_BASE is not configured.");
  return `${base}${path}`;
}

function authHeaders(env: Env): Headers {
  return new Headers(authHeadersObject(env));
}

function authHeadersObject(env: Env): Record<string, string> {
  if (!env.CRAWDAD_API_TOKEN) throw new Error("CRAWDAD_API_TOKEN is not configured.");
  return { Authorization: `Bearer ${env.CRAWDAD_API_TOKEN}` };
}

function parseHostToolResponse(text: string): HostToolResponse | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as HostToolResponse
      : null;
  } catch {
    return null;
  }
}

function hostToolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content.map((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block)) return "";
        const raw = block as Record<string, unknown>;
        return raw.type === "text" && typeof raw.text === "string" ? raw.text : "";
      }).filter(Boolean).join("\n");
      if (text) return text;
    }
  }
  return result === undefined ? "" : JSON.stringify(result);
}

function normalizeOutputPath(value: string): string {
  const raw = value.trim() || DEFAULT_OUTPUT_PATH;
  const absolute = raw.startsWith("/") ? raw : `/workspace/${raw}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (normalized === "/workspace") return ".";
  if (!normalized.startsWith("/workspace/")) {
    throw new Error(`Build output path is outside /workspace: ${value}`);
  }
  return normalized.slice("/workspace/".length).replace(/\/+$/u, "") || ".";
}

function cleanBuildCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("\0")) throw new Error("Build command contains an invalid character.");
  return trimmed;
}

function parseBuildMetadata(log: string): BuildMetadata {
  const match = log.match(/__FLIGHT_BUILD_METADATA__(\{[^\n]+\})/u);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as BuildMetadata;
    return {
      files: Number.isFinite(parsed.files) ? parsed.files : undefined,
      bytes: Number.isFinite(parsed.bytes) ? parsed.bytes : undefined,
    };
  } catch {
    return {};
  }
}

function logTail(value: string): string {
  const lines = value.trim().split("\n").filter(Boolean);
  return lines.slice(-60).join("\n");
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const cleaned = value.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
