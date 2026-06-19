export function markdownToSlackMrkdwn(text: string): string {
  let output = text;

  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, "<$2|$1>");
  output = output.replace(/^#{1,6}\s+(.+)$/gmu, "*$1*");
  output = output.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/gu, "*$1*");
  output = output.replace(/__([^_\n][\s\S]*?[^_\n])__/gu, "*$1*");

  return output;
}
