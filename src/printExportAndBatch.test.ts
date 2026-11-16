// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { preprocessPrintPageBreaks, renderReadingHtml } from './utils/readingMode';

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
