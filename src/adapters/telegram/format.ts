/**
 * Convert markdown to Telegram HTML format.
 *
 * Telegram supports a subset of HTML:
 * - Bold: <b>text</b> or <strong>text</strong>
 * - Italic: <i>text</i> or <em>text</em>
 * - Strikethrough: <s>text</s> or <del>text</del>
 * - Code: <code>text</code>
 * - Pre: <pre>text</pre>
 * - Links: <a href="url">text</a>
 * - Underline: <u>text</u>
 * - Spoiler: <tg-spoiler>text</tg-spoiler>
 *
 * Telegram does NOT support markdown natively in HTML mode.
 */
export function markdownToTelegramHtml(text: string): string {
  let output = text;

  // Escape HTML entities first
  output = output.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

  // Code blocks: ```lang\n...```  -> <pre><code class="language-lang">...</code></pre>
  output = output.replace(/```(\w+)?\n([\s\S]*?)```/gu, (_match, lang, code) => {
    const langAttr = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${langAttr}>${code}</code></pre>`;
  });

  // Inline code: `text` -> <code>text</code>
  output = output.replace(/`([^`\n]+)`/gu, "<code>$1</code>");

  // Links: [text](url) -> <a href="url">text</a>
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, '<a href="$2">$1</a>');

  // Bold: **text** -> <b>text</b>
  output = output.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/gu, "<b>$1</b>");

  // Italic: *text* or _text_ -> <i>text</i>
  output = output.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/gu, "<i>$1</i>");
  output = output.replace(/(?<!_)_([^_\n]+?)_(?!_)/gu, "<i>$1</i>");

  // Strikethrough: ~~text~~ -> <s>text</s>
  output = output.replace(/~~([^~\n]+?)~~/gu, "<s>$1</s>");

  // Headers: # text -> <b>text</b> (Telegram doesn't support headers)
  output = output.replace(/^#{1,6}\s+(.+)$/gmu, "<b>$1</b>");

  return output;
}

/**
 * Split text into chunks of at most `maxLength` characters,
 * preferring to break at newlines or spaces.
 */
export function chunkTelegramMessage(text: string, maxLength = 4096): string[] {
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
