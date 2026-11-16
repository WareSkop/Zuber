// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { preprocessPrintPageBreaks, renderReadingHtml } from './utils/readingMode';
import { computeBodyCursorAfterHeading } from './utils/editorCursorUtils';
import {
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';

describe('Print / PDF Export Reading Mode Rendering', () => {
  it('converts <!-- pagebreak -->, <div class="page-break"></div>, and <hr class="page-break"> outside code fences into .print-page-break', () => {
    const md = [
      '# Page 1',
      '',
      '<!-- pagebreak -->',
      '',
      '```markdown',
      '<!-- pagebreak -->',
      '```',
      '',
      '<div class="page-break"></div>',
      '',
      '<hr class="page-break" />',
      '',
      '# Page 2',
    ].join('\n');

    const preprocessed = preprocessPrintPageBreaks(md, 'Seitenumbruch');
    const matches = preprocessed.match(/class="print-page-break"/g) || [];
    expect(matches.length).toBe(3);
    expect(preprocessed).toContain('data-label="Seitenumbruch"');

    // Fenced code block preserves literal <!-- pagebreak -->
    const fenceBody = preprocessed.split('```markdown')[1].split('```')[0];
    expect(fenceBody).toContain('<!-- pagebreak -->');

    const html = renderReadingHtml(md, 'ExportTest.md', [], {
      attachmentLabel: 'Anhang',
      pageBreakLabel: 'Seitenumbruch',
    });
    expect(html).toContain('class="print-page-break"');
    expect(html).toContain('data-label="Seitenumbruch"');
  });

  it('renders a print attachment callout card for embedded PDFs in Reading Mode', () => {
    const md = 'See attached spec:\n\n![[docs/sample-manual.pdf]]\n';
    const html = renderReadingHtml(md, 'Notes/Spec.md', [], {
      attachmentLabel: 'Attachment',
      pageBreakLabel: 'Page Break',
    });

    expect(html).toContain('class="cm-lp-pdf-embed reading-pdf-embed"');
    expect(html).toContain('class="print-pdf-attachment-callout"');
    expect(html).toContain('<strong>Attachment:</strong> sample-manual.pdf');
  });
});

describe('New Note Frontmatter Serialization & Smart Mobile Cursor Placement', () => {
  it('serializes and parses new note body without a leading blank line before # Title', () => {
    const props = [
      { key: 'tags', type: 'list' as const, value: [] },
      { key: 'erstellt', type: 'date' as const, value: '2026-11-16' },
    ];
    const raw = serializeMarkdownWithFrontmatter(props, '# Neue Notiz\n\n');
    const parsed = parseMarkdownWithFrontmatter(raw);
    expect(parsed.body).toBe('# Neue Notiz\n\n');
    expect(parsed.body.startsWith('\n')).toBe(false);
  });

  it('places cursor below H1 heading when entering edit mode', () => {
    // 1. Standard new note: "# Title\n\n"
    const res1 = computeBodyCursorAfterHeading('# Title\n\n');
    expect(res1.insertText).toBeUndefined();
    expect(res1.pos).toBe('# Title\n\n'.length);

    // 2. Single line "# Title" without trailing newlines -> appends "\n\n"
    const res2 = computeBodyCursorAfterHeading('# Title');
    expect(res2.insertText).toBe('\n\n');
    expect(res2.insertFrom).toBe('# Title'.length);
    expect(res2.pos).toBe('# Title\n\n'.length);

    // 3. Heading with body content -> places cursor at start of first content line
    const res3 = computeBodyCursorAfterHeading('# Title\n\nHello world');
    expect(res3.insertText).toBeUndefined();
    expect(res3.pos).toBe('# Title\n\n'.length);

    // 4. Note without H1 heading -> position 0
    const res4 = computeBodyCursorAfterHeading('Plain paragraph');
    expect(res4.pos).toBe(0);
  });
});
