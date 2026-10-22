import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  isNoteSendTarget,
  inferPropertyType,
  normalizePropertyValue,
  parseMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import './components/LivePreviewEditor';

describe('Editor Improvements - Phase 2', () => {
  describe('Nested Task List Indentation & Bracket Pos', () => {
    const parseTaskMatch = (text: string, lineFrom: number) => {
      const taskMatch = text.match(/^(\s*)([-*+]\s+)(\[[ xX]\])(\s*)/);
      if (!taskMatch) return null;
      const leadingWhitespace = taskMatch[1];
      const listMarker = taskMatch[2];
      const checkMarker = taskMatch[3];
      let indentSpaces = 0;
      for (const ch of leadingWhitespace) {
        if (ch === '\t') indentSpaces += 4;
        else if (ch === ' ') indentSpaces += 1;
      }
      const bracketPos = lineFrom + leadingWhitespace.length + listMarker.length;
      const isChecked = checkMarker.toLowerCase() === '[x]';
      return {
        indentSpaces,
        bracketPos,
        isChecked,
        replaceFrom: lineFrom,
        replaceTo: bracketPos + 3,
      };
    };

    it('handles top-level task items with 0 indent', () => {
      const res = parseTaskMatch('- [ ] Top task', 100);
      expect(res).not.toBeNull();
      expect(res?.indentSpaces).toBe(0);
      expect(res?.bracketPos).toBe(102); // 100 + 0 + 2
      expect(res?.isChecked).toBe(false);
      expect(res?.replaceFrom).toBe(100);
      expect(res?.replaceTo).toBe(105);
    });

    it('handles 1st level nested task items (2 spaces)', () => {
      const res = parseTaskMatch('  - [x] Subtask 1', 100);
      expect(res).not.toBeNull();
      expect(res?.indentSpaces).toBe(2);
      expect(res?.bracketPos).toBe(104); // 100 + 2 + 2
      expect(res?.isChecked).toBe(true);
      expect(res?.replaceFrom).toBe(100);
      expect(res?.replaceTo).toBe(107);
    });

    it('handles 2nd level nested task items (4 spaces)', () => {
      const res = parseTaskMatch('    - [ ] Sub-subtask', 100);
      expect(res).not.toBeNull();
      expect(res?.indentSpaces).toBe(4);
      expect(res?.bracketPos).toBe(106); // 100 + 4 + 2
      expect(res?.isChecked).toBe(false);
      expect(res?.replaceFrom).toBe(100);
      expect(res?.replaceTo).toBe(109);
    });

    it('handles tab-indented task items', () => {
      const res = parseTaskMatch('\t- [ ] Tab task', 100);
      expect(res).not.toBeNull();
      expect(res?.indentSpaces).toBe(4);
      expect(res?.bracketPos).toBe(103); // 100 + 1 + 2
      expect(res?.isChecked).toBe(false);
    });
  });

  describe('Reading Mode Task Lists & Links', () => {
    it('adds task-list-item class to <li> with checkbox and preserves hierarchy', async () => {
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM('');
      const dompurifyModule = await import('dompurify');
      const DOMPurify = (dompurifyModule.default as any)(dom.window);

      const markdown = '- [ ] First\n  - [x] Nested\n    - [ ] Deep';
      let html = marked.parse(markdown, { async: false, gfm: true }) as string;
      html = html.replace(/<li(\s*[^>]*)>(?:\s*<p>)?\s*(<input\s+[^>]*type=["']checkbox["'][^>]*>)/gi, '<li$1 class="task-list-item">$2');
      const sanitized = DOMPurify.sanitize(html, {
        ADD_ATTR: ['href', 'target', 'rel', 'class'],
      });

      expect(sanitized).toContain('class="task-list-item"');
      expect(sanitized).not.toContain('•');
    });

    it('transforms external markdown links to target="_blank" and internal to wikilinks', () => {
      let body = '[Stahlshop](https://stahlshop.de/) und [Notiz](Projekte/Notiz.md)';
      body = body.replace(
        /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g,
        (_match, labelRaw, hrefRaw) => {
          const href = String(hrefRaw).trim();
          const label = String(labelRaw).trim();
          if (/^(https?:|mailto:)/i.test(href)) {
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="external-link">${label}</a>`;
          }
          return `<a href="#" class="reading-wikilink" data-wikilink="${href}">${label}</a>`;
        }
      );

      expect(body).toContain('<a href="https://stahlshop.de/" target="_blank" rel="noopener noreferrer" class="external-link">Stahlshop</a>');
      expect(body).toContain('<a href="#" class="reading-wikilink" data-wikilink="Projekte/Notiz.md">Notiz</a>');
    });
  });

  describe('Auto-Link Paste URL Detection and Guards', () => {
    const isUrl = (text: string) => /^(https?:\/\/[^\s<>()]+)$/i.test(text.trim());

    it('identifies single valid HTTP/HTTPS URLs', () => {
      expect(isUrl('https://stahlshop.de/')).toBe(true);
      expect(isUrl('http://example.com/page?query=1#hash')).toBe(true);
      expect(isUrl('not a url')).toBe(false);
      expect(isUrl('https://example.com with extra text')).toBe(false);
    });

    it('detects guard conditions (inline code and markdown link url)', () => {
      const checkGuards = (lineText: string, posInLine: number) => {
        const textBeforeCursor = lineText.slice(0, posInLine);
        const backticksBefore = (textBeforeCursor.match(/`/g) || []).length;
        const inInlineCode = backticksBefore % 2 !== 0;

        const lastOpenParen = textBeforeCursor.lastIndexOf('](');
        let inMarkdownLinkUrl = false;
        if (lastOpenParen !== -1) {
          const closingParen = lineText.indexOf(')', lastOpenParen);
          if (closingParen === -1 || closingParen >= posInLine) {
            inMarkdownLinkUrl = true;
          }
        }
        return { inInlineCode, inMarkdownLinkUrl };
      };

      // Cursor inside inline code: `code|`
      expect(checkGuards('`let x = 1`', 5).inInlineCode).toBe(true);
      // Cursor outside inline code: `code` |
      expect(checkGuards('`let x = 1` here', 13).inInlineCode).toBe(false);

      // Cursor inside markdown link URL: [text](https://|...)
      expect(checkGuards('[text](https://old.com/)', 15).inMarkdownLinkUrl).toBe(true);
      // Cursor outside: [text](https://old.com/) |
      expect(checkGuards('[text](https://old.com/) after', 26).inMarkdownLinkUrl).toBe(false);
    });
  });

  describe('Code Block Enhancements (Syntax Highlighting, Language Badge & Copy Button)', () => {
    it('renders codeblocks in marked with header, language badge, copy button and syntax highlighting', () => {
      const markdown = '```python\ndef greet():\n    return "hello"\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      expect(html).toContain('class="codeblock-container"');
      expect(html).toContain('class="codeblock-header"');
      expect(html).toContain('<span class="codeblock-lang">PYTHON</span>');
      expect(html).toContain('class="codeblock-copy-btn"');
      expect(html).toContain('Kopieren');
      expect(html).toContain('hljs');
      expect(html).toContain('hljs-keyword'); // def or return
      expect(html).toContain('hljs-string'); // "hello"
    });

    it('defaults language label to CODE when none is provided in code fence', () => {
      const markdown = '```\nplain text content\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      expect(html).toContain('<span class="codeblock-lang">CODE</span>');
      expect(html).toContain('class="codeblock-container"');
      expect(html).toContain('content');
    });

    it('preserves codeblock containers, buttons and svgs after DOMPurify sanitization', async () => {
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM('');
      const dompurifyModule = await import('dompurify');
      const DOMPurify = (dompurifyModule.default as any)(dom.window);

      const markdown = '```ts\nconst num: number = 42;\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ['rect', 'path', 'svg', 'button'],
        ADD_ATTR: [
          'href', 'target', 'rel', 'data-wiki-target', 'data-wikilink',
          'data-canvas-path', 'data-tag', 'loading', 'decoding', 'align',
          'viewBox', 'fill', 'stroke', 'stroke-width', 'width', 'height', 'rx', 'ry', 'd',
        ],
      });

      expect(sanitized).toContain('class="codeblock-container"');
      expect(sanitized).toContain('class="codeblock-header"');
      expect(sanitized).toContain('<button');
      expect(sanitized).toContain('<svg');
      expect(sanitized).toContain('<span class="codeblock-lang">TS</span>');
    });

    it('renders interactive mermaid code blocks with diagram/code toggle and preview container', () => {
      const markdown = '```mermaid\ngraph TD\n    A[Start] --> B[Done]\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      expect(html).toContain('class="codeblock-container reading-mermaid-container"');
      expect(html).toContain('class="codeblock-header"');
      expect(html).toContain('<span class="codeblock-lang">MERMAID</span>');
      expect(html).toContain('class="codeblock-view-toggle"');
      expect(html).toContain('data-action="diagram"');
      expect(html).toContain('data-action="code"');
      expect(html).toContain('class="reading-mermaid-preview"');
      expect(html).toContain('class="reading-mermaid-code"');
      expect(html).toContain('data-code="');
      expect(html).toContain('class="codeblock-copy-btn"');
    });

    it('renders interactive html code blocks with preview/code toggle and sandboxed iframe preview', () => {
      const markdown = '```html\n<div class="test-card"><h1>Hello</h1></div>\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      expect(html).toContain('class="codeblock-container reading-html-container"');
      expect(html).toContain('class="codeblock-header"');
      expect(html).toContain('<span class="codeblock-lang">HTML</span>');
      expect(html).toContain('class="codeblock-view-toggle"');
      expect(html).toContain('data-action="preview"');
      expect(html).toContain('data-action="code"');
      expect(html).toContain('class="reading-html-preview"');
      expect(html).toContain('<iframe srcdoc="');
      expect(html).toContain('sandbox="allow-scripts"');
      expect(html).toContain('class="reading-html-code"');
    });

    it('preserves html iframes, srcdoc, sandbox, and interactive toggle data attributes after DOMPurify sanitization', async () => {
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM('');
      const dompurifyModule = await import('dompurify');
      const DOMPurify = (dompurifyModule.default as any)(dom.window);

      const markdown = '```html\n<p>Interactive Widget</p>\n```';
      const html = marked.parse(markdown, { async: false, gfm: true }) as string;

      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ['rect', 'path', 'svg', 'button', 'iframe'],
        ADD_ATTR: [
          'href', 'target', 'rel', 'data-wiki-target', 'data-wikilink',
          'data-canvas-path', 'data-tag', 'data-code', 'data-action', 'data-rendered',
          'srcdoc', 'sandbox', 'style', 'loading', 'decoding', 'align',
          'viewBox', 'fill', 'stroke', 'stroke-width', 'width', 'height', 'rx', 'ry', 'd',
        ],
      });

      expect(sanitized).toContain('class="codeblock-container reading-html-container"');
      expect(sanitized).toContain('<iframe srcdoc="');
      expect(sanitized).toContain('sandbox="allow-scripts"');
      expect(sanitized).toContain('data-action="preview"');
      expect(sanitized).toContain('data-action="code"');
    });
  });

  describe('Inline PDF Viewer Syntax', () => {
    function processPdfEmbed(markdown: string): string {
      let processed = markdown;
      // Mirror reading view transform for PDF embeds
      processed = processed.replace(
        /!\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
        (_match, targetRaw, altRaw) => {
          const target = String(targetRaw).trim();
          const alt = altRaw ? String(altRaw).trim() : target;
          if (target.toLowerCase().endsWith('.pdf')) {
            const fileName = target.split('/').pop() || target;
            let height = '550px';
            if (/^\d+$/.test(alt)) {
              height = `${alt}px`;
            }
            return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">📄 ${fileName}</span><a href="/api/vault/attachment?target=${target}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="In neuem Tab öffnen">↗</a></div><iframe src="/api/vault/attachment?target=${target}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe></div>`;
          }
          return _match;
        }
      );
      return processed;
    }

    it('transforms ![[dokument.pdf]] to interactive PDF viewer container with default 550px height', () => {
      const markdown = 'Hier ist das Dokument:\n![[handbuch.pdf]]';
      const result = processPdfEmbed(markdown);

      expect(result).toContain('class="cm-lp-pdf-embed reading-pdf-embed"');
      expect(result).toContain('class="cm-lp-pdf-header"');
      expect(result).toContain('📄 handbuch.pdf');
      expect(result).toContain('class="cm-lp-pdf-open-btn"');
      expect(result).toContain('style="height: 550px;"');
      expect(result).toContain('src="/api/vault/attachment?target=handbuch.pdf#toolbar=1&view=FitH"');
    });

    it('transforms ![[dokument.pdf|750]] to PDF viewer with custom height of 750px', () => {
      const markdown = '![[attachments/specs.pdf|750]]';
      const result = processPdfEmbed(markdown);

      expect(result).toContain('📄 specs.pdf');
      expect(result).toContain('style="height: 750px;"');
      expect(result).toContain('#toolbar=1&view=FitH');
    });
  });

  describe('Send to Target Note Logic & Formatting', () => {
    it('infers sendtarget as checkbox type and normalizes correctly', () => {
      expect(inferPropertyType('sendtarget', true)).toBe('checkbox');
      expect(inferPropertyType('sendTarget', 'true')).toBe('checkbox');
      expect(normalizePropertyValue('sendtarget', 'true', 'checkbox')).toBe(true);
      expect(normalizePropertyValue('sendtarget', 'false', 'checkbox')).toBe(false);
      expect(normalizePropertyValue('sendtarget', true, 'checkbox')).toBe(true);
    });

    it('identifies sendtarget in various frontmatter representations', () => {
      expect(isNoteSendTarget({ sendtarget: true }, [])).toBe(true);
      expect(isNoteSendTarget({ sendtarget: 'true' }, [])).toBe(true);
      expect(isNoteSendTarget({ sendTarget: 'TRUE' }, [])).toBe(true);
      expect(isNoteSendTarget({ sendtarget: false }, [])).toBe(false);
      expect(isNoteSendTarget({}, [{ key: 'sendtarget', value: true, type: 'checkbox' }])).toBe(true);
      expect(isNoteSendTarget({}, [{ key: 'sendtarget', value: 'true', type: 'checkbox' }])).toBe(true);
      expect(isNoteSendTarget({}, [{ key: 'sendtarget', value: false, type: 'checkbox' }])).toBe(false);
    });

    it('formats source replacement text and target append block correctly', () => {
      const targetName = 'Projekt Alpha';
      const originName = 'Kundengespräch';
      const selectedBlock = 'Budgetfreigabe für Q4 erteilt.';
      const timestamp = '2026-10-22 15:45';

      // Source replacement
      const sourceReplacementDe = `→ Verschoben nach [[${targetName}]]`;
      const sourceReplacementEn = `→ Moved to [[${targetName}]]`;
      expect(sourceReplacementDe).toBe('→ Verschoben nach [[Projekt Alpha]]');
      expect(sourceReplacementEn).toBe('→ Moved to [[Projekt Alpha]]');

      // Target append
      const targetHeaderDe = `### ${timestamp} – Aus [[${originName}]]`;
      const targetAppendDe = `\n\n${targetHeaderDe}\n\n${selectedBlock}\n`;
      expect(targetAppendDe).toContain('### 2026-10-22 15:45 – Aus [[Kundengespräch]]');
      expect(targetAppendDe).toContain('Budgetfreigabe für Q4 erteilt.');

      const targetHeaderEn = `### ${timestamp} – From [[${originName}]]`;
      const targetAppendEn = `\n\n${targetHeaderEn}\n\n${selectedBlock}\n`;
      expect(targetAppendEn).toContain('### 2026-10-22 15:45 – From [[Kundengespräch]]');
    });
  });
});
