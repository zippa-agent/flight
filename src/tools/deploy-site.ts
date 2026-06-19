import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";
import { buildSiteInContainer, type ContainerBuildInput, type ContainerBuildResult } from "./container-build";
import { agentToolsToken, cleanSiteMessage, siteApiUrl } from "./site-api";

const MAX_DEPLOY_FILES = 600;
const MAX_DEPLOY_BYTES = 25 * 1024 * 1024;

const DeploySiteInput = v.object({
  site: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(63),
    v.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/u, "Use a lowercase site slug."),
  ),
  path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
  environment: v.optional(v.union([v.literal("preview"), v.literal("production")])),
  message: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
  mode: v.optional(v.union([v.literal("auto"), v.literal("static"), v.literal("worker")])),
  build: v.optional(v.boolean()),
  build_command: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(3000))),
  output_path: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
});

type DeploySiteInputValue = v.InferOutput<typeof DeploySiteInput>;

interface DeployFile {
  path: string;
  content: Uint8Array;
}

export interface DeploySiteResult {
  ok: true;
  site: string;
  environment: "preview" | "production";
  mode: "static" | "built" | "worker";
  sourcePath: string;
  files: number;
  bytes: number;
  build?: {
    command: string;
    outputPath: string;
    log: string;
  };
  deployment: unknown;
}

export function createDeploySiteTool(input: {
  env: Env;
  instanceId: string;
}): ToolDefinition {
  return defineTool({
    name: "deploy_site",
    description:
      "Deploy a website from /workspace to TinyFat Sites. Static sites publish directly. Unbuilt npm/Astro projects can be built in a temporary TinyFat container. Use mode \"worker\" for framework apps. EmDash can deploy dist/server plus dist/client. Payload/OpenNext should deploy a Wrangler dry-run bundle containing worker.js plus an assets/ directory copied from .open-next/assets; set the admin users collection to lockDocuments: false before building Payload/D1 workers unless document locks have been tested.",
    parameters: DeploySiteInput,
    execute: async (args, signal) => {
      const { ownerId, toolsToken } = await agentToolsToken(input);

      const result = await deploySiteFromWorkspace({
        env: input.env,
        ownerId,
        toolsToken,
        request: args,
        signal,
      });

      return JSON.stringify(result, null, 2);
    },
  });
}

export async function deploySiteFromWorkspace(input: {
  env: Env;
  ownerId: string;
  toolsToken: string;
  request: DeploySiteInputValue;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  buildImpl?: (input: ContainerBuildInput) => Promise<ContainerBuildResult>;
}): Promise<DeploySiteResult> {
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) throw new Error("Flight requires the FLIGHT_WORKSPACE R2 bucket binding.");

  const source = normalizeWorkspacePath(input.request.path || "/workspace");
  const files = await collectStaticFiles({
    bucket,
    ownerId: input.ownerId,
    relativePath: source.relativePath,
  });

  const shouldBuild = input.request.build === true || (input.request.build !== false && looksLikeBuildableApp(files) && !hasRootIndex(files));
  const environment = input.request.environment || "preview";
  const deployMode = input.request.mode || "auto";
  const workerMode = deployMode === "worker";
  const publishUrl = publishDeployUrl(input.env, input.request.site, workerMode ? "deploy-worker" : "deploy");

  if (shouldBuild) {
    const sourceTarball = await gzip(createTar(files));
    const buildResult = await (input.buildImpl || buildSiteInContainer)({
      env: input.env,
      agentId: input.ownerId,
      sourceFiles: files,
      sourceTarball,
      buildCommand: input.request.build_command,
      outputPath: input.request.output_path,
      signal: input.signal,
    });
    const deployment = await publishSiteTarball({
      fetchImpl: input.fetchImpl,
      publishUrl,
      toolsToken: input.toolsToken,
      environment,
      message: cleanDeployMessage(input.request.message),
      body: buildResult.tarball,
      signal: input.signal,
    });

    return {
      ok: true,
      site: input.request.site,
      environment,
      mode: workerMode ? "worker" : "built",
      sourcePath: source.displayPath,
      files: buildResult.files,
      bytes: buildResult.bytes,
      build: {
        command: buildResult.command,
        outputPath: `/workspace/${buildResult.outputPath === "." ? "" : buildResult.outputPath}`.replace(/\/$/u, "") || "/workspace",
        log: buildResult.log,
      },
      deployment,
    };
  }

  if (!workerMode) assertDeployableStaticSite(files, source.displayPath);
  const tarball = await gzip(createTar(files));
  const deployment = await publishSiteTarball({
    fetchImpl: input.fetchImpl,
    publishUrl,
    toolsToken: input.toolsToken,
    environment,
    message: cleanDeployMessage(input.request.message),
    body: tarball,
    signal: input.signal,
  });

  return {
    ok: true,
    site: input.request.site,
    environment,
    mode: workerMode ? "worker" : "static",
    sourcePath: source.displayPath,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.content.byteLength, 0),
    deployment,
  };
}

async function collectStaticFiles(input: {
  bucket: R2Bucket;
  ownerId: string;
  relativePath: string;
}): Promise<DeployFile[]> {
  const rootPrefix = workspaceRootPrefix(input.ownerId);
  const fileKey = input.relativePath ? `${rootPrefix}${input.relativePath}` : "";
  if (fileKey) {
    const object = await input.bucket.get(fileKey);
    if (object) {
      return [{
        path: basename(input.relativePath),
        content: await object.bytes(),
      }];
    }
  }

  const directoryPrefix = input.relativePath
    ? `${rootPrefix}${input.relativePath}/`
    : rootPrefix;
  const files: DeployFile[] = [];
  let totalBytes = 0;
  let cursor: string | undefined;

  do {
    const listed = await input.bucket.list({ prefix: directoryPrefix, cursor });
    for (const object of listed.objects) {
      const deployPath = object.key.slice(directoryPrefix.length);
      if (!deployPath || shouldSkipDeployPath(deployPath)) continue;
      if (deployPath.length > 100) {
        throw new Error(`Cannot deploy ${deployPath}: tar paths are limited to 100 bytes in this deploy path.`);
      }
      if (files.length >= MAX_DEPLOY_FILES) {
        throw new Error(`Static deploy is limited to ${MAX_DEPLOY_FILES} files.`);
      }
      totalBytes += object.size;
      if (totalBytes > MAX_DEPLOY_BYTES) {
        throw new Error(`Static deploy is limited to ${Math.round(MAX_DEPLOY_BYTES / 1024 / 1024)} MB.`);
      }
      const body = await input.bucket.get(object.key);
      if (!body) continue;
      files.push({ path: deployPath, content: await body.bytes() });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function assertDeployableStaticSite(files: DeployFile[], sourcePath: string): void {
  const paths = new Set(files.map((file) => file.path));
  if (paths.has("index.html")) return;

  if (paths.has("dist/index.html")) {
    throw new Error(`No index.html exists at ${sourcePath}. The workspace has dist/index.html; call deploy_site with path "/workspace/dist".`);
  }

  if (paths.has("package.json") || [...paths].some((path) => /^astro\.config\./u.test(path))) {
    throw new Error(
      "This looks like an unbuilt app. Call deploy_site with build true, or omit build so Flight can build it automatically.",
    );
  }

  throw new Error(`No index.html exists at ${sourcePath}. deploy_site needs a static output directory.`);
}

function hasRootIndex(files: DeployFile[]): boolean {
  return files.some((file) => file.path === "index.html");
}

function looksLikeBuildableApp(files: DeployFile[]): boolean {
  const paths = new Set(files.map((file) => file.path));
  return paths.has("package.json") || [...paths].some((path) => /^astro\.config\./u.test(path));
}

function normalizeWorkspacePath(path: string): { relativePath: string; displayPath: string } {
  const raw = path.trim() || "/workspace";
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
  if (normalized === "/workspace") return { relativePath: "", displayPath: "/workspace" };
  if (!normalized.startsWith("/workspace/")) {
    throw new Error(`Path is outside /workspace: ${path}`);
  }
  const relativePath = normalized.slice("/workspace/".length).replace(/\/+$/u, "");
  return {
    relativePath,
    displayPath: `/workspace/${relativePath}`,
  };
}

function shouldSkipDeployPath(path: string): boolean {
  if (path.endsWith("/.flight-dir")) return true;
  return path.split("/").some((part) => (
    part === ".git"
    || part === ".flight"
    || part === ".wrangler"
    || part === "node_modules"
    || part === ".DS_Store"
  ));
}

function publishDeployUrl(env: Env, site: string, path: "deploy" | "deploy-worker"): string {
  return siteApiUrl(env, site, path);
}

async function publishSiteTarball(input: {
  fetchImpl?: typeof fetch;
  publishUrl: string;
  toolsToken: string;
  environment: "preview" | "production";
  message: string;
  body: ArrayBuffer;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await (input.fetchImpl || fetch)(input.publishUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.toolsToken}`,
      "Content-Type": "application/gzip",
      "X-Environment": input.environment,
      "X-Deploy-Message": input.message,
    },
    body: input.body,
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sites deploy failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) as unknown : {};
}

function cleanDeployMessage(value: string | undefined): string {
  return cleanSiteMessage(value, "Flight site deploy");
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() || "index.html";
}

const encoder = new TextEncoder();

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value).slice(0, length);
  target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const octal = Math.max(0, value).toString(8).slice(-(length - 1));
  writeString(target, offset, length, `${octal.padStart(length - 1, "0")}\0`);
}

function tarHeader(file: DeployFile, mtime: number): Uint8Array {
  const header = new Uint8Array(512);
  writeString(header, 0, 100, file.path);
  writeOctal(header, 100, 8, 0o100644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, file.content.byteLength);
  writeOctal(header, 136, 12, mtime);
  header.fill(32, 148, 156);
  writeString(header, 156, 1, "0");
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumValue = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 8, `${checksumValue}\0 `);
  return header;
}

function createTar(files: DeployFile[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const file of files) {
    chunks.push(tarHeader(file, mtime));
    chunks.push(file.content);
    const padding = (512 - (file.content.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  return concatBytes(chunks);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function gzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([copyArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
