/**
 * Convert markdown to Discord-flavored markdown.
 *
 * Discord supports most standard markdown but with some differences:
 * - Bold: **text** (same as markdown)
 * - Italic: *text* or _text_ (same)
 * - Strikethrough: ~~text~~ (same)
 * - Code: `code` and ```blocks``` (same)
 * - Links: [text](url) (same, but Discord doesn't render them as clickable in all contexts)
 * - Headers: Not natively supported; convert to bold
 * - Mentions: <@userId> or <@&roleId> (pass through as-is)
 */
export function markdownToDiscordMarkdown(text: string): string {
  let output = text;

  // Convert markdown headers to bold (Discord doesn't support headers natively)
  output = output.replace(/^#{1,6}\s+(.+)$/gmu, "**$1**");

  // Discord supports **bold**, *italic*, ~~strikethrough~~, `code`, ```blocks```
  // These are already standard markdown, so no conversion needed.

  // Ensure links are in Discord-compatible format (Discord does support [text](url))
  // No conversion needed.

  return output;
}

/**
 * Split text into chunks of at most `maxLength` characters,
 * preferring to break at newlines or spaces.
 */
export function chunkDiscordMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let breakIndex = remaining.lastIndexOf("\n", maxLength);
    if (breakIndex <= 0) {
      breakIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakIndex <= 0) {
      breakIndex = maxLength;
    }
    chunks.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trim();
  }

  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
}
