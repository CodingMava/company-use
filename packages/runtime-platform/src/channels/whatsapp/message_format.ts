export const whatsapp_text_limit = 4_096;

const code_span_pattern = /(```[\s\S]*?```|`[^`\n]+`)/u;
const markdown_link_pattern = /!?\[([^\]\n]+)\]\(([^)\s]+)\)/gu;

const prose_rules: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(\s*)[*+]\s+/gmu, '$1- '],
  [/(?<![*\w])\*(?![\s*])([^*\n]*?[^\s*])\*(?![*\w])/gu, '_$1_'],
  [/\*\*(?=\S)([^*\n]*?\S)\*\*/gu, '*$1*'],
  [/__(?=\S)([^_\n]*?\S)__/gu, '*$1*'],
  [/^#{1,6}\s+\**(.+?)\**\s*#*\s*$/gmu, '*$1*'],
  [/~~(?=\S)([^~\n]*?\S)~~/gu, '~$1~'],
  [/\n{3,}/gu, '\n\n'],
];

export function format_whatsapp_text(markdown: string): string {
  return markdown
    .split(code_span_pattern)
    .map((part, index) => (index % 2 === 1 ? format_code_span(part) : format_prose(part)))
    .join('')
    .trim();
}

export function split_whatsapp_text(text: string, limit = whatsapp_text_limit): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = find_split_point(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function format_prose(text: string) {
  const formatted = prose_rules.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
  return formatted.replace(markdown_link_pattern, (_match, label: string, url: string) =>
    label === url ? url : `${label} (${url})`,
  );
}

function format_code_span(code: string) {
  return code.replace(/^```[\w+-]*\n/u, '```\n');
}

function find_split_point(text: string, limit: number) {
  const window = text.slice(0, limit);
  const half = Math.floor(limit / 2);
  for (const separator of ['\n\n', '\n', ' ']) {
    const index = window.lastIndexOf(separator);
    if (index > half) return index;
  }
  return limit;
}
