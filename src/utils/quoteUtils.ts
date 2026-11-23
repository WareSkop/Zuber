export const ZUBER_QUOTE_MIME = 'application/x-zuber-quote';

export interface ZuberQuotePayload {
  text: string;
  url?: string;
  title: string;
  page?: number;
  isInternal?: boolean;
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').replace(/\[/g, '\\[').replace(/\]/g, '\\]').trim();
}

function sanitizeMarkdownLinkTarget(url: string, isInternal?: boolean): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (isInternal) {
    return trimmed.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }
  return trimmed.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Formats highlighted text from the Web Reader or PDF viewer into a multi-line
 * Markdown blockquote with an attribution line:
 *
 * ```md
 * > Line 1
 * > Line 2
 * > — [Title (S. 4)](https://example.com/article)
 * ```
 */
export function formatQuoteMarkdown(payload: ZuberQuotePayload, pageAbbr = 'p.'): string {
  const cleaned = (payload.text || '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return '';

  const quoteLines = cleaned.split('\n').map((line) => (line.trim().length > 0 ? `> ${line}` : '>'));

  const baseTitle = escapeMarkdownLinkLabel(payload.title || '') || (payload.url || '').trim();
  const hasValidPage =
    typeof payload.page === 'number' && Number.isFinite(payload.page) && payload.page > 0;
  const fullLabel = hasValidPage ? `${baseTitle} (${pageAbbr} ${Math.floor(payload.page!)})` : baseTitle;
  const linkTarget = payload.url ? sanitizeMarkdownLinkTarget(payload.url, payload.isInternal) : '';

  if (linkTarget && fullLabel) {
    quoteLines.push(`> — [${fullLabel}](${linkTarget})`);
  } else if (fullLabel) {
    quoteLines.push(`> — ${fullLabel}`);
  }

  return quoteLines.join('\n');
}

/**
 * Ensures clean blank-line padding before and after a blockquote inserted at `insertPos`.
 */
export function wrapQuoteForInsertion(
  docText: string,
  insertPos: number,
  quoteBlock: string
): string {
  if (!quoteBlock) return '';
  const pos = Math.max(0, Math.min(insertPos, docText.length));
  const before = docText.slice(0, pos);
  const after = docText.slice(pos);

  let prefix = '';
  if (before.length > 0) {
    if (before.endsWith('\n\n')) prefix = '';
    else if (before.endsWith('\n')) prefix = '\n';
    else prefix = '\n\n';
  }

  let suffix = '\n';
  if (after.length > 0) {
    if (after.startsWith('\n\n')) suffix = '';
    else if (after.startsWith('\n')) suffix = '\n';
    else suffix = '\n\n';
  }

  return `${prefix}${quoteBlock}${suffix}`;
}
