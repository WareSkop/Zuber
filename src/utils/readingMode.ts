import { marked, Marked } from 'marked';

const webArticleMarked = new Marked({ gfm: true, breaks: true });
import DOMPurify from 'dompurify';
import { api } from '../api';
import { stripZencExt } from '../crypto/folderCrypto';

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const INLINE_FILE_SVG =
  '<svg class="embed-inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let mermaidModulePromise: Promise<typeof import('mermaid').default> | null = null;
export async function loadAndInitMermaid(isDark: boolean) {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidModulePromise;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    fontFamily: 'inherit',
    suppressErrorRendering: true,
  });
  return mermaid;
}

export interface ReadingRenderOptions {
  attachmentLabel?: string;
  pageBreakLabel?: string;
  openInNewTabLabel?: string;
  embeddedNoteLabel?: string;
}

export function preprocessPrintPageBreaks(markdown: string, pageBreakLabel = 'Page Break'): string {
  const lines = (markdown || '').split('\n');
  let inFence = false;
  let fenceChar = '';
  const breakHtml = `<div class="print-page-break" data-label="${escapeHtml(pageBreakLabel)}" aria-hidden="true"></div>`;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = marker;
        } else if (marker === fenceChar) {
          inFence = false;
          fenceChar = '';
        }
        return line;
      }
      if (inFence) return line;
      return line
        .replace(/<!--\s*pagebreak\s*-->/gi, breakHtml)
        .replace(/<div\s+class=["']page-break["']\s*>\s*<\/div>/gi, breakHtml)
        .replace(/<hr\s+class=["']page-break["']\s*\/?>/gi, breakHtml);
    })
    .join('\n');
}

export function renderReadingHtml(
  body: string,
  notePath: string,
  allNotes: { path: string; name: string; basename: string }[] = [],
  options?: ReadingRenderOptions
): string {
  const attachmentLabel = options?.attachmentLabel || 'Attachment';
  const pageBreakLabel = options?.pageBreakLabel || 'Page Break';
  const openInNewTabLabel = escapeHtml(options?.openInNewTabLabel || 'Open in new tab');
  const embeddedNoteLabel = escapeHtml(options?.embeddedNoteLabel || 'Embedded Note');
  let processed = preprocessPrintPageBreaks(body || '', pageBreakLabel);

  // 1. Transform Callouts: > [!type] Title \n > content
  processed = processed.replace(
    /(?:^>\s*\[!([a-zA-Z]+)\]\s*(.*)\n)((?:^>.*\n?)*)/gm,
    (_match, typeStr, titleStr, contentBlock) => {
      const type = String(typeStr).toLowerCase();
      const title = titleStr?.trim() || type.toUpperCase();
      const innerLines = String(contentBlock)
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .join('\n');
      const innerHtml = marked.parse(innerLines, { async: false, gfm: true, breaks: true }) as string;
      return `<div class="reading-callout callout-${type}"><div class="reading-callout-title">${title}</div><div class="reading-callout-body">${innerHtml}</div></div>\n`;
    }
  );

  // 2. Transform Wiki-Embeds ![[Embeds]]
  processed = processed.replace(
    /!\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g,
    (_match, targetRaw, viewOrHeadingRaw, altOrHeightRaw) => {
      const target = String(targetRaw).trim();
      const alt = altOrHeightRaw ? String(altOrHeightRaw).trim() : target;
      const logicalTarget = stripZencExt(target);
      let isCanvas = logicalTarget.toLowerCase().endsWith('.canvas');
      let canvasPath = target;
      if (!isCanvas && allNotes) {
        const lower = logicalTarget.toLowerCase();
        const lowerWithExt = lower.endsWith('.canvas') ? lower : `${lower}.canvas`;
        const lowerWithoutExt = lower.replace(/\.canvas$/i, '');
        const canvasMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.canvas$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p === lowerWithExt ||
              p.endsWith(`/${lowerWithExt}`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === lowerWithExt ||
              base === lowerWithoutExt) &&
            p.endsWith('.canvas')
          );
        });
        const mdMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.md$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p.endsWith(`/${lower}.md`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === `${lower}.md` ||
              base === lower) &&
            p.endsWith('.md')
          );
        });
        if (canvasMatch && !mdMatch) {
          isCanvas = true;
          canvasPath = canvasMatch.path;
        }
      }
      if (isCanvas) {
        const safeCanvasPath = escapeHtml(canvasPath);
        const heightVal = altOrHeightRaw && /^\d+(?:px)?$/i.test(altOrHeightRaw.trim()) ? altOrHeightRaw.trim() : '';
        const safeHeight = heightVal ? escapeHtml(heightVal) : '';
        return `<div class="embedded-canvas-container canvas-embed-widget cm-lp-canvas-embed reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-height="${safeHeight}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-mount"></div></div>`;
      }
      let isBase = logicalTarget.toLowerCase().endsWith('.base');
      let basePath = target;
      if (!isBase && allNotes) {
        const lower = logicalTarget.toLowerCase();
        const lowerWithExt = lower.endsWith('.base') ? lower : `${lower}.base`;
        const lowerWithoutExt = lower.replace(/\.base$/i, '');
        const baseMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.base$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p === lowerWithExt ||
              p.endsWith(`/${lowerWithExt}`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === lowerWithExt ||
              base === lowerWithoutExt) &&
            p.endsWith('.base')
          );
        });
        const mdMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.md$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p.endsWith(`/${lower}.md`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === `${lower}.md` ||
              base === lower) &&
            p.endsWith('.md')
          );
        });
        if (baseMatch && !mdMatch) {
          isBase = true;
          basePath = baseMatch.path;
        }
      }
      if (isBase) {
        const safeBasePath = escapeHtml(basePath);
        const viewVal = viewOrHeadingRaw ? String(viewOrHeadingRaw).trim() : '';
        const heightVal = alt && /^\d+(?:px)?$/i.test(alt.trim()) ? alt.trim() : '';
        const safeView = viewVal ? escapeHtml(viewVal) : '';
        const safeHeight = heightVal ? escapeHtml(heightVal) : '';
        return `<div class="embedded-base-container base-embed-widget cm-lp-base-embed reading-base-embed" data-base-path="${safeBasePath}" data-view="${safeView}" data-height="${safeHeight}" data-wikilink="${safeBasePath}"><div class="reading-base-mount"></div></div>`;
      }
      if (logicalTarget.toLowerCase().endsWith('.pdf')) {
        const url = escapeHtml(api.getAttachmentUrl(target, notePath));
        const fileName = logicalTarget.split('/').pop() || logicalTarget;
        let height = '550px';
        if (/^\d+$/.test(alt)) {
          height = `${alt}px`;
        }
        return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">${INLINE_FILE_SVG}${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="${openInNewTabLabel}">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe><div class="print-pdf-attachment-callout"><span>${INLINE_FILE_SVG}</span><span><strong>${escapeHtml(attachmentLabel)}:</strong> ${escapeHtml(fileName)}</span></div></div>`;
      }
      if (IMAGE_EXT_REGEX.test(logicalTarget)) {
        const url = escapeHtml(api.getAttachmentUrl(target, notePath));
        const styleAttr = /^\d+$/.test(alt) ? ` style="max-width:${alt}px"` : '';
        return `<span class="reading-image-embed"><img src="${url}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${styleAttr} /></span>`;
      }
      return `<div class="reading-note-embed" data-wikilink="${escapeHtml(target)}"><span class="embedded-note-header">${INLINE_FILE_SVG}<span>${embeddedNoteLabel}: <strong>${escapeHtml(alt)}</strong></span></span></div>`;
    }
  );

  // 3. Transform Standard Markdown Images ![alt](url) to use vault attachment resolver
  processed = processed.replace(
    /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (_match, altRaw, hrefRaw) => {
      const target = String(hrefRaw).trim();
      const logicalTarget = stripZencExt(target);
      const alt = String(altRaw || target).trim();
      let isCanvas = logicalTarget.toLowerCase().endsWith('.canvas');
      let canvasPath = target;
      if (!isCanvas && allNotes) {
        const lower = logicalTarget.toLowerCase();
        const lowerWithExt = lower.endsWith('.canvas') ? lower : `${lower}.canvas`;
        const lowerWithoutExt = lower.replace(/\.canvas$/i, '');
        const canvasMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.canvas$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p === lowerWithExt ||
              p.endsWith(`/${lowerWithExt}`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === lowerWithExt ||
              base === lowerWithoutExt) &&
            p.endsWith('.canvas')
          );
        });
        const mdMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.md$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p.endsWith(`/${lower}.md`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === `${lower}.md` ||
              base === lower) &&
            p.endsWith('.md')
          );
        });
        if (canvasMatch && !mdMatch) {
          isCanvas = true;
          canvasPath = canvasMatch.path;
        }
      }
      if (isCanvas) {
        const safeCanvasPath = escapeHtml(canvasPath);
        const heightVal = altRaw && /^\d+(?:px)?$/i.test(altRaw.trim()) ? altRaw.trim() : '';
        const safeHeight = heightVal ? escapeHtml(heightVal) : '';
        return `<div class="embedded-canvas-container canvas-embed-widget cm-lp-canvas-embed reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-height="${safeHeight}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-mount"></div></div>`;
      }
      let isBase = logicalTarget.toLowerCase().endsWith('.base');
      let basePath = target;
      if (!isBase && allNotes) {
        const lower = logicalTarget.toLowerCase();
        const lowerWithExt = lower.endsWith('.base') ? lower : `${lower}.base`;
        const lowerWithoutExt = lower.replace(/\.base$/i, '');
        const baseMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.base$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p === lowerWithExt ||
              p.endsWith(`/${lowerWithExt}`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === lowerWithExt ||
              base === lowerWithoutExt) &&
            p.endsWith('.base')
          );
        });
        const mdMatch = allNotes.find((n) => {
          const p = stripZencExt(n.path || '').toLowerCase();
          const name = stripZencExt(n.name || '').toLowerCase();
          const base = (n.basename || name.replace(/\.md$/i, '')).toLowerCase();
          return (
            (p === lower ||
              p.endsWith(`/${lower}.md`) ||
              p.endsWith(`/${lower}`) ||
              name === lower ||
              name === `${lower}.md` ||
              base === lower) &&
            p.endsWith('.md')
          );
        });
        if (baseMatch && !mdMatch) {
          isBase = true;
          basePath = baseMatch.path;
        }
      }
      if (isBase) {
        const safeBasePath = escapeHtml(basePath);
        return `<div class="cm-lp-base-embed embedded-base-container base-embed-widget reading-base-embed" data-base-path="${safeBasePath}" data-wikilink="${safeBasePath}"><div class="reading-base-mount"></div></div>`;
      }
      if (logicalTarget.toLowerCase().endsWith('.pdf')) {
        const rawUrl = /^(https?:|data:)/i.test(target) ? target : api.getAttachmentUrl(target, notePath);
        const url = escapeHtml(rawUrl);
        const fileName = logicalTarget.split('/').pop() || logicalTarget;
        let height = '550px';
        if (/^\d+$/.test(alt)) {
          height = `${alt}px`;
        }
        return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">${INLINE_FILE_SVG}${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="${openInNewTabLabel}">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe><div class="print-pdf-attachment-callout"><span>${INLINE_FILE_SVG}</span><span><strong>${escapeHtml(attachmentLabel)}:</strong> ${escapeHtml(fileName)}</span></div></div>`;
      }
      const rawUrl = /^(https?:|data:)/i.test(target)
        ? target
        : api.getAttachmentUrl(target, notePath);
      return `<span class="reading-image-embed"><img src="${escapeHtml(rawUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" /></span>`;
    }
  );

  // 3.5. Transform HTML <img> tags to resolve relative vault paths
  processed = processed.replace(
    /<img\b([^>]*?src=["']([^"']+)["'][^>]*?)\/?>/gi,
    (fullTag, _attrs, src) => {
      const cleanSrc = String(src).trim();
      if (/^(https?:|data:)/i.test(cleanSrc)) return fullTag;
      const resolvedUrl = api.getAttachmentUrl(cleanSrc, notePath);
      return fullTag.replace(src, resolvedUrl);
    }
  );

  // 4. Transform Standard Markdown Links [label](url)
  processed = processed.replace(
    /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g,
    (_match, labelRaw, hrefRaw) => {
      const href = String(hrefRaw).trim();
      const label = String(labelRaw).trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="external-link">${escapeHtml(label)}</a>`;
      }
      return `<a href="#" class="reading-wikilink" data-wikilink="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }
  );

  // 5. Transform [[Wiki-Links]]
  processed = processed.replace(
    /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g,
    (_match, targetRaw, _heading, aliasRaw) => {
      const target = String(targetRaw).trim();
      const display = aliasRaw ? String(aliasRaw).trim() : target;
      return `<a href="#" class="reading-wikilink" data-wikilink="${escapeHtml(target)}">${escapeHtml(display)}</a>`;
    }
  );

  // 6. Transform ==highlights==
  processed = processed.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // 7. Transform inline #tags
  processed = processed.replace(
    /(^|\s)#([a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)])/gm,
    '$1<span class="reading-tag" data-tag="$2">#$2</span>'
  );

  let rawHtml = marked.parse(processed, { async: false, gfm: true, breaks: true }) as string;
  // Add task-list-item class to <li> containing input checkbox for reliable styling
  rawHtml = rawHtml.replace(
    /<li(\s*[^>]*)>(?:\s*<p>)?\s*(<input\s+[^>]*type=["']checkbox["'][^>]*>)/gi,
    '<li$1 class="task-list-item">$2'
  );

  return DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['rect', 'path', 'svg', 'button', 'iframe'],
    ADD_ATTR: [
      'href',
      'target',
      'rel',
      'data-wiki-target',
      'data-wikilink',
      'data-canvas-path',
      'data-base-path',
      'data-view',
      'data-height',
      'data-tag',
      'data-code',
      'data-action',
      'data-rendered',
      'data-label',
      'aria-hidden',
      'srcdoc',
      'sandbox',
      'style',
      'loading',
      'decoding',
      'align',
      'viewBox',
      'fill',
      'stroke',
      'stroke-width',
      'width',
      'height',
      'rx',
      'ry',
      'd',
    ],
  });
}

/**
 * Renders extracted external web article Markdown to strictly sanitized HTML.
 * Uses explicit element/attribute allowlists and blocks unsafe tags, inline styles, data/aria attributes, and non-HTTP(S) URIs.
 */
export function renderWebArticleHtml(markdown: string): string {
  let rawHtml = webArticleMarked.parse(markdown || '', {
    async: false,
  }) as string;

  rawHtml = rawHtml.replace(
    /<li(\s*[^>]*)>(?:\s*<p>)?\s*(<input\s+[^>]*type=["']checkbox["'][^>]*>)/gi,
    '<li$1 class="task-list-item">$2'
  );

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'blockquote',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'pre', 'code',
      'a', 'img', 'hr',
      'strong', 'b', 'em', 'i', 'del', 's', 'sub', 'sup', 'mark',
      'figure', 'figcaption',
      'input', 'span', 'div',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel',
      'src', 'alt', 'title',
      'type', 'checked', 'disabled',
      'class', 'colspan', 'rowspan',
    ],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['iframe', 'script', 'style', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcdoc'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}
