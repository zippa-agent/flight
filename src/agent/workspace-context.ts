import type { Env } from "../env";
import { workspaceRootPrefix } from "../sandboxes/r2-workspace";

const WORKSPACE_CONTEXT_FILES = [
  ["AGENTS.md", "Agents"],
  ["IDENTITY.md", "Identity"],
  ["SOUL.md", "Soul"],
  ["USER.md", "User Profile"],
] as const;

const MAX_CONTEXT_FILE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 60_000;

export async function loadWorkspaceContext(input: {
  env: Pick<Env, "FLIGHT_WORKSPACE">;
  ownerId: string;
  now?: Date;
}): Promise<string> {
  const bucket = input.env.FLIGHT_WORKSPACE;
  if (!bucket) return "";

  const rootPrefix = workspaceRootPrefix(input.ownerId);
  const bootstrap = await readWorkspaceText(bucket, rootPrefix, "BOOTSTRAP.md");
  if (bootstrap) {
    return renderWorkspaceContext(`Bootstrap:\n${bootstrap}`);
  }

  const sections: string[] = [];
  const contextFiles = await Promise.all(
    WORKSPACE_CONTEXT_FILES.map(async ([file, label]) => ({
      label,
      content: await readWorkspaceText(bucket, rootPrefix, file),
    })),
  );

  for (const { label, content } of contextFiles) {
    if (content) sections.push(`${label}:\n${content}`);
  }

  const memory = await readWorkspaceText(bucket, rootPrefix, "MEMORY.md");
  sections.push(memory ? `Memory:\n${memory}` : "Memory:\n(no working memory yet)");

  const brief = await readWorkspaceText(bucket, rootPrefix, "BRIEF.md");
  if (brief) sections.push(`Current Brief (assigned by operator):\n${brief}`);

  const recent = await readRecentDailyMemory(bucket, rootPrefix, input.now ?? new Date());
  if (recent) sections.push(`Recent:\n${recent}`);

  return renderWorkspaceContext(sections.join("\n\n"));
}

async function readRecentDailyMemory(bucket: R2Bucket, rootPrefix: string, now: Date): Promise<string> {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dates = [formatDate(now), formatDate(yesterday)];
  const entries = await Promise.all(
    dates.map(async (date) => ({
      date,
      content: await readWorkspaceText(bucket, rootPrefix, `memory/${date}.md`),
    })),
  );

  return entries
    .filter((entry) => entry.content)
    .map((entry) => `### ${entry.date}\n${entry.content}`)
    .join("\n\n");
}

async function readWorkspaceText(bucket: R2Bucket, rootPrefix: string, path: string): Promise<string> {
  const object = await bucket.get(`${rootPrefix}${path}`);
  if (!object) return "";
  return clipText((await object.text()).trim(), MAX_CONTEXT_FILE_CHARS);
}

function renderWorkspaceContext(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return clipText([
    "Flight workspace context:",
    "These files are loaded from /workspace for the parent TinyFat agent before this turn.",
    "",
    trimmed,
  ].join("\n"), MAX_CONTEXT_CHARS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
