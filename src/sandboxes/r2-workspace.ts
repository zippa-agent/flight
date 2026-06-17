import {
  createSandboxSessionEnv,
  type FileStat,
  type SandboxApi,
  type SandboxFactory,
  type SessionEnv,
  type ShellResult,
} from "@flue/runtime";
import { parentAgentIdFromInstanceId } from "../awareness/id";

export const FLIGHT_WORKSPACE_BUCKET_NAME = "tiny-agents";
export const FLIGHT_WORKSPACE_DATA_PREFIX = "tiny-agents-data";
export const FLIGHT_WORKSPACE_CWD = "/workspace";

const DIRECTORY_MARKER = ".flight-dir";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function workspaceOwnerIdFromInstanceId(instanceId: string): string {
  const candidate = parentAgentIdFromInstanceId(instanceId) ?? instanceId;
  if (!UUID_PATTERN.test(candidate)) {
    throw new Error(`Flight workspace id must be a UUID; received ${candidate}`);
  }
  return candidate.toLowerCase();
}

export function workspaceRootPrefix(ownerId: string): string {
  const normalizedOwnerId = ownerId.toLowerCase();
  if (!UUID_PATTERN.test(normalizedOwnerId)) {
    throw new Error(`Flight workspace owner id must be a UUID; received ${ownerId}`);
  }
  return `${FLIGHT_WORKSPACE_DATA_PREFIX}/${normalizedOwnerId}/`;
}

export function r2Workspace(input: {
  bucket: R2Bucket;
  ownerId: string;
}): SandboxFactory {
  const rootPrefix = workspaceRootPrefix(input.ownerId);
  return {
    async createSessionEnv(): Promise<SessionEnv> {
      return createSandboxSessionEnv(
        new R2WorkspaceApi(input.bucket, rootPrefix),
        FLIGHT_WORKSPACE_CWD,
      );
    },
  };
}

class R2WorkspaceApi implements SandboxApi {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly rootPrefix: string,
  ) {}

  async readFile(path: string): Promise<string> {
    const object = await this.bucket.get(this.fileKey(path));
    if (!object) throw notFound(path);
    return object.text();
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const object = await this.bucket.get(this.fileKey(path));
    if (!object) throw notFound(path);
    return object.bytes();
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const relative = this.relativePath(path);
    if (!relative) throw isDirectory(path);

    const parent = parentRelativePath(relative);
    if (parent && await this.fileExists(parent)) {
      throw notDirectory(parent);
    }
    if (await this.directoryExists(relative)) {
      throw isDirectory(path);
    }

    await this.bucket.put(this.keyForRelativePath(relative), content);
  }

  async stat(path: string): Promise<FileStat> {
    const relative = this.relativePath(path);
    if (!relative) return { isFile: false, isDirectory: true };

    const object = await this.bucket.head(this.keyForRelativePath(relative));
    if (object) {
      return {
        isFile: true,
        isDirectory: false,
        size: object.size,
        mtime: object.uploaded,
      };
    }

    if (await this.directoryExists(relative)) {
      return { isFile: false, isDirectory: true };
    }

    throw notFound(path);
  }

  async readdir(path: string): Promise<string[]> {
    const stat = await this.stat(path);
    if (!stat.isDirectory) throw notDirectory(path);

    const prefix = this.directoryPrefix(this.relativePath(path));
    const names = new Set<string>();
    let cursor: string | undefined;

    do {
      const listed = await this.bucket.list({
        prefix,
        delimiter: "/",
        cursor,
      });

      for (const object of listed.objects) {
        const name = object.key.slice(prefix.length);
        if (name && name !== DIRECTORY_MARKER && !name.includes("/")) {
          names.add(name);
        }
      }

      for (const delimitedPrefix of listed.delimitedPrefixes) {
        const name = delimitedPrefix.slice(prefix.length).replace(/\/$/u, "");
        if (name) names.add(name);
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const relative = this.relativePath(path);
    if (!relative) return;

    if (await this.fileExists(relative)) {
      throw notDirectory(path);
    }

    if (!options?.recursive) {
      const parent = parentRelativePath(relative);
      if (parent && await this.fileExists(parent)) throw notDirectory(parent);
      if (parent && !(await this.directoryExists(parent))) throw notFound(parent);
    }

    await this.bucket.put(this.directoryMarkerKey(relative), "");
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const relative = this.relativePath(path);
    if (!relative) {
      throw new Error(`${FLIGHT_WORKSPACE_CWD} is the workspace root and cannot be removed`);
    }

    const fileKey = this.keyForRelativePath(relative);
    const fileObject = await this.bucket.head(fileKey);
    const directoryExists = await this.directoryExists(relative);

    if (!fileObject && !directoryExists) {
      if (options?.force) return;
      throw notFound(path);
    }

    if (fileObject) {
      await this.bucket.delete(fileKey);
    }

    if (!directoryExists) return;

    if (options?.recursive) {
      await this.deleteDirectoryTree(relative);
      return;
    }

    if (!(await this.directoryIsEmpty(relative))) {
      throw new Error(`Directory is not empty: ${path}`);
    }

    await this.bucket.delete(this.directoryMarkerKey(relative));
  }

  async exec(): Promise<ShellResult> {
    return {
      stdout: "",
      stderr: [
        "Generic bash is unavailable in Flight's durable R2 workspace.",
        "Use read, write, edit, grep, and glob for workspace files.",
        "Use a dedicated platform tool for build/deploy work when one is available.",
      ].join(" "),
      exitCode: 127,
    };
  }

  private fileKey(path: string): string {
    const relative = this.relativePath(path);
    if (!relative) throw isDirectory(path);
    return this.keyForRelativePath(relative);
  }

  private keyForRelativePath(relative: string): string {
    return `${this.rootPrefix}${relative}`;
  }

  private directoryPrefix(relative: string): string {
    return relative ? `${this.rootPrefix}${relative}/` : this.rootPrefix;
  }

  private directoryMarkerKey(relative: string): string {
    return `${this.directoryPrefix(relative)}${DIRECTORY_MARKER}`;
  }

  private async fileExists(relative: string): Promise<boolean> {
    return !!(await this.bucket.head(this.keyForRelativePath(relative)));
  }

  private async directoryExists(relative: string): Promise<boolean> {
    if (!relative) return true;
    if (await this.bucket.head(this.directoryMarkerKey(relative))) return true;
    const listed = await this.bucket.list({
      prefix: this.directoryPrefix(relative),
      delimiter: "/",
      limit: 1,
    });
    return listed.objects.length > 0 || listed.delimitedPrefixes.length > 0;
  }

  private async directoryIsEmpty(relative: string): Promise<boolean> {
    const prefix = this.directoryPrefix(relative);
    const listed = await this.bucket.list({ prefix, delimiter: "/", limit: 2 });
    if (listed.delimitedPrefixes.length > 0) return false;
    return listed.objects.every((object) => object.key === this.directoryMarkerKey(relative));
  }

  private async deleteDirectoryTree(relative: string): Promise<void> {
    const keys = new Set<string>([this.directoryMarkerKey(relative)]);
    let cursor: string | undefined;

    do {
      const listed = await this.bucket.list({
        prefix: this.directoryPrefix(relative),
        cursor,
      });
      for (const object of listed.objects) keys.add(object.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    const batch: string[] = [];
    for (const key of keys) {
      batch.push(key);
      if (batch.length === 1000) {
        await this.bucket.delete(batch.splice(0, batch.length));
      }
    }
    if (batch.length > 0) await this.bucket.delete(batch);
  }

  private relativePath(path: string): string {
    const normalized = normalizeAbsolutePath(path);
    if (normalized === FLIGHT_WORKSPACE_CWD) return "";
    if (normalized.startsWith(`${FLIGHT_WORKSPACE_CWD}/`)) {
      return normalized.slice(FLIGHT_WORKSPACE_CWD.length + 1);
    }
    throw new Error(`Path is outside ${FLIGHT_WORKSPACE_CWD}: ${path}`);
  }
}

function normalizeAbsolutePath(path: string): string {
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  const parts: string[] = [];
  for (const part of absolutePath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentRelativePath(relative: string): string {
  const index = relative.lastIndexOf("/");
  return index === -1 ? "" : relative.slice(0, index);
}

function notFound(path: string): Error {
  return new Error(`No such file or directory: ${path}`);
}

function notDirectory(path: string): Error {
  return new Error(`Not a directory: ${path}`);
}

function isDirectory(path: string): Error {
  return new Error(`Is a directory: ${path}`);
}
