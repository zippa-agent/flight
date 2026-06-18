export class FakeR2Bucket {
  private readonly objects = new Map<string, { bytes: Uint8Array; uploaded: Date }>();

  readonly r2 = {
    head: async (key: string): Promise<R2Object | null> => {
      const object = this.objects.get(key);
      return object ? this.makeObject(key, object) : null;
    },
    get: async (key: string): Promise<R2ObjectBody | null> => {
      const object = this.objects.get(key);
      return object ? this.makeObjectBody(key, object) : null;
    },
    put: async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    ): Promise<R2Object> => {
      const object = {
        bytes: await toBytes(value),
        uploaded: new Date("2026-06-18T12:00:00.000Z"),
      };
      this.objects.set(key, object);
      return this.makeObject(key, object);
    },
    delete: async (keys: string | string[]): Promise<void> => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        this.objects.delete(key);
      }
    },
    list: async (options?: R2ListOptions): Promise<R2Objects> => {
      const prefix = options?.prefix ?? "";
      const delimiter = options?.delimiter;
      const objectKeys = [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b));

      const objects: R2Object[] = [];
      const delimitedPrefixes = new Set<string>();

      for (const key of objectKeys) {
        const rest = key.slice(prefix.length);
        const delimiterIndex = delimiter ? rest.indexOf(delimiter) : -1;
        if (delimiter && delimiterIndex >= 0) {
          delimitedPrefixes.add(prefix + rest.slice(0, delimiterIndex + delimiter.length));
          continue;
        }
        const object = this.objects.get(key);
        if (object) objects.push(this.makeObject(key, object));
      }

      return {
        objects: options?.limit ? objects.slice(0, options.limit) : objects,
        delimitedPrefixes: [...delimitedPrefixes].sort((a, b) => a.localeCompare(b)),
        truncated: false,
      };
    },
  } as R2Bucket;

  keys(): string[] {
    return [...this.objects.keys()].sort((a, b) => a.localeCompare(b));
  }

  private makeObject(key: string, object: { bytes: Uint8Array; uploaded: Date }): R2Object {
    return {
      key,
      version: "fake",
      size: object.bytes.byteLength,
      etag: "fake",
      httpEtag: "fake",
      checksums: { toJSON: () => ({}) } as R2Checksums,
      uploaded: object.uploaded,
      storageClass: "Standard",
      writeHttpMetadata() {},
    } as R2Object;
  }

  private makeObjectBody(key: string, object: { bytes: Uint8Array; uploaded: Date }): R2ObjectBody {
    const base = this.makeObject(key, object);
    return {
      ...base,
      get body(): ReadableStream {
        throw new Error("Not implemented");
      },
      get bodyUsed(): boolean {
        return false;
      },
      arrayBuffer: async () => object.bytes.buffer.slice(
        object.bytes.byteOffset,
        object.bytes.byteOffset + object.bytes.byteLength,
      ) as ArrayBuffer,
      bytes: async () => new Uint8Array(object.bytes),
      text: async () => new TextDecoder().decode(object.bytes),
      json: async <T>() => JSON.parse(new TextDecoder().decode(object.bytes)) as T,
      blob: async () => new Blob([copyArrayBuffer(object.bytes)]),
    } as R2ObjectBody;
  }
}

async function toBytes(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("ReadableStream values are not supported in FakeR2Bucket");
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
