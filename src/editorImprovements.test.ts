import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
});
