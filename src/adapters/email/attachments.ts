import type { EmailPayload } from "../email";
import type { Env } from "../../env";
import {
  safeFilename,
  uniqueWorkspacePath,
  workspacePathInDirectory,
  writeWorkspaceFile,
  type WorkspaceFileRecord,
} from "../../workspace/files";

export interface EmailAttachmentFile extends WorkspaceFileRecord {
  filename: string;
}

export async function persistEmailAttachments(input: {
  env: Env;
  agentId: string;
  payload: EmailPayload;
  receivedAt: Date;
}): Promise<EmailAttachmentFile[]> {
  const attachments = input.payload.attachments || [];
  if (attachments.length === 0) return [];

  const directory = emailAttachmentDirectory(input.payload, input.receivedAt);
  const used = new Set<string>();
  const files: EmailAttachmentFile[] = [];

  for (const attachment of attachments) {
    if (!attachment.content) continue;
    const filename = safeFilename(attachment.filename, "attachment");
    const path = uniqueWorkspacePath(workspacePathInDirectory(directory, filename), used);
    const bytes = decodeBase64(attachment.content);
    const record = await writeWorkspaceFile({
      env: input.env,
      ownerId: input.agentId,
      path,
      content: bytes,
      contentType: attachment.content_type,
    });
    files.push({ ...record, filename });
  }

  return files;
}

export function withWorkspaceAttachmentPaths(
  payload: EmailPayload,
  files: EmailAttachmentFile[],
): EmailPayload {
  if (files.length === 0) return payload;
  const byFilename = new Map<string, EmailAttachmentFile[]>();
  for (const file of files) {
    const bucket = byFilename.get(file.filename) || [];
    bucket.push(file);
    byFilename.set(file.filename, bucket);
  }

  return {
    ...payload,
    attachments: (payload.attachments || []).map((attachment) => {
      const filename = safeFilename(attachment.filename, "attachment");
      const match = byFilename.get(filename)?.shift();
      return match
        ? {
          ...attachment,
          workspace_path: match.path,
          size: match.size,
        }
        : attachment;
    }),
  };
}

function emailAttachmentDirectory(payload: EmailPayload, receivedAt: Date): string {
  const date = receivedAt.toISOString().slice(0, 10);
  const message = safeFilename(
    payload.messageId || payload.subject || crypto.randomUUID(),
    "message",
  ).replace(/[<>]/g, "");
  return `/workspace/attachments/email/${date}/${message}`;
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
