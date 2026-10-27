import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api';

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

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

export function renderReadingHtml(
  body: string,
  notePath: string,
  allNotes: { path: string; name: string; basename: string }[] = []
): string {
  let processed = body || '';

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
      const innerHtml = marked.parse(innerLines, { async: false, gfm: true }) as string;
      return `<div class="reading-callout callout-${type}"><div class="reading-callout-title">${title}</div><div class="reading-callout-body">${innerHtml}</div></div>\n`;
    }
  );

  // 2. Transform Wiki-Embeds ![[Embeds]]
  processed = processed.replace(
    /!\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
    (_match, targetRaw, altRaw) => {
      const target = String(targetRaw).trim();
      const alt = altRaw ? String(altRaw).trim() : target;
      let isCanvas = target.toLowerCase().endsWith('.canvas');
      let canvasPath = target;
      if (!isCanvas) {
        const lower = target.toLowerCase();
        const canvasMatch = allNotes.find(
          (n) =>
            (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
            n.path.toLowerCase().endsWith('.canvas')
        );
        const mdMatch = allNotes.find(
          (n) =>
            (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
            n.path.toLowerCase().endsWith('.md')
        );
        if (canvasMatch && !mdMatch) {
          isCanvas = true;
          canvasPath = canvasMatch.path;
        }
      }
      if (isCanvas) {
        const safeCanvasPath = escapeHtml(canvasPath);
        const safeAlt = escapeHtml(alt);
        return `<div class="reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${safeAlt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
      }
      if (target.toLowerCase().endsWith('.pdf')) {
        const url = escapeHtml(api.getAttachmentUrl(target, notePath));
        const fileName = target.split('/').pop() || target;
        let height = '550px';
        if (/^\d+$/.test(alt)) {
          height = `${alt}px`;
        }
        return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">📄 ${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="In neuem Tab öffnen">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe></div>`;
      }
      if (IMAGE_EXT_REGEX.test(target)) {
        const url = escapeHtml(api.getAttachmentUrl(target, notePath));
        const styleAttr = /^\d+$/.test(alt) ? ` style="max-width:${alt}px"` : '';
        return `<span class="reading-image-embed"><img src="${url}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${styleAttr} /></span>`;
      }
      return `<div class="reading-note-embed" data-wikilink="${escapeHtml(target)}">📄 Eingebettete Notiz: <strong>${escapeHtml(alt)}</strong></div>`;
    }
  );

  // 3. Transform Standard Markdown Images ![alt](url) to use vault attachment resolver
  processed = processed.replace(
    /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (_match, altRaw, hrefRaw) => {
      const target = String(hrefRaw).trim();
      const alt = String(altRaw || target).trim();
      let isCanvas = target.toLowerCase().endsWith('.canvas');
      let canvasPath = target;
      if (!isCanvas) {
        const lower = target.toLowerCase();
        const canvasMatch = allNotes.find(
          (n) =>
            (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
            n.path.toLowerCase().endsWith('.canvas')
        );
        const mdMatch = allNotes.find(
          (n) =>
            (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
            n.path.toLowerCase().endsWith('.md')
        );
        if (canvasMatch && !mdMatch) {
          isCanvas = true;
          canvasPath = canvasMatch.path;
        }
      }
      if (isCanvas) {
        const safeCanvasPath = escapeHtml(canvasPath);
        const safeAlt = escapeHtml(alt);
        return `<div class="reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${safeAlt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
      }
      if (target.toLowerCase().endsWith('.pdf')) {
        const rawUrl = /^(https?:|data:)/i.test(target) ? target : api.getAttachmentUrl(target, notePath);
        const url = escapeHtml(rawUrl);
        const fileName = target.split('/').pop() || target;
        let height = '550px';
        if (/^\d+$/.test(alt)) {
          height = `${alt}px`;
        }
        return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">📄 ${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="In neuem Tab öffnen">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe></div>`;
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

  let rawHtml = marked.parse(processed, { async: false, gfm: true }) as string;
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
      'data-tag',
      'data-code',
      'data-action',
      'data-rendered',
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
