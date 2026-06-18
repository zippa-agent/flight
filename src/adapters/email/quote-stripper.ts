function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function stripQuotedEmailText(body: string): string {
  const text = normalizeNewlines(body).replace(/\u00a0/g, " ").trim();
  if (!text) return "";

  const lines = text.split("\n");
  const cutIndex = findQuotedSectionStart(lines);
  const kept = cutIndex === -1 ? lines : lines.slice(0, cutIndex);
  return kept.join("\n").trim();
}

function findQuotedSectionStart(lines: string[]): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() || "";
    if (!line) continue;
    if (isQuoteHeader(line)) return index;
    if (isOriginalMessageBoundary(line)) return index;
    if (looksLikeOriginalHeaderBlock(lines, index)) return index;
    if (line.startsWith(">") && hasPriorUserContent(lines, index) && restIsQuoted(lines, index)) return index;
  }
  return -1;
}

function isQuoteHeader(line: string): boolean {
  return /^on .+wrote:$/iu.test(line) ||
    /^on .+ at .+, .+wrote:$/iu.test(line) ||
    /^le .+ a écrit\s*:$/iu.test(line);
}

function isOriginalMessageBoundary(line: string): boolean {
  return /^-{2,}\s*original message\s*-{2,}$/iu.test(line) ||
    /^_{5,}\s*$/u.test(line);
}

function looksLikeOriginalHeaderBlock(lines: string[], index: number): boolean {
  const first = lines[index]?.trim() || "";
  if (!/^from:\s+/iu.test(first)) return false;
  const next = lines.slice(index + 1, index + 8).map((line) => line.trim().toLowerCase());
  return next.some((line) => /^(sent|date):\s+/u.test(line)) &&
    next.some((line) => /^to:\s+/u.test(line)) &&
    next.some((line) => /^subject:\s+/u.test(line));
}

function hasPriorUserContent(lines: string[], index: number): boolean {
  return lines.slice(0, index).some((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith(">");
  });
}

function restIsQuoted(lines: string[], index: number): boolean {
  return lines.slice(index).every((line) => {
    const trimmed = line.trim();
    return !trimmed || trimmed.startsWith(">");
  });
}
