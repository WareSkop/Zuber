/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchPane, type ResearchTarget, detectFileType } from './components/ResearchPane';
import { renderReadingHtml } from './utils/readingMode';

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Research Split-View (70/30 Resizable Split, Click-Routing & Multi-Format Viewer)', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  describe('detectFileType', () => {
    it('detects canvas files correctly', () => {
      expect(detectFileType('diagram.canvas')).toBe('canvas');
      expect(detectFileType('folder/SubDiagram.CANVAS')).toBe('canvas');
    });

    it('detects pdf files correctly', () => {
      expect(detectFileType('document.pdf')).toBe('pdf');
      expect(detectFileType('attachments/Doc.PDF')).toBe('pdf');
    });

    it('detects image files correctly across multiple extensions', () => {
      expect(detectFileType('photo.png')).toBe('image');
      expect(detectFileType('picture.jpg')).toBe('image');
      expect(detectFileType('graphic.jpeg')).toBe('image');
      expect(detectFileType('anim.gif')).toBe('image');
      expect(detectFileType('vector.svg')).toBe('image');
      expect(detectFileType('modern.webp')).toBe('image');
      expect(detectFileType('legacy.bmp')).toBe('image');
    });

    it('defaults markdown and unknown text to note', () => {
      expect(detectFileType('notes.md')).toBe('note');
      expect(detectFileType('readme.txt')).toBe('note');
      expect(detectFileType('My Note')).toBe('note');
    });
  });

  describe('Split Ratio Clamping & Persistence', () => {
    it('clamps ratio between 20% and 80%', () => {
      const clampRatio = (ratio: number) => Math.min(80, Math.max(20, Math.round(ratio)));
      expect(clampRatio(70)).toBe(70);
      expect(clampRatio(10)).toBe(20);
      expect(clampRatio(95)).toBe(80);
      expect(clampRatio(20)).toBe(20);
      expect(clampRatio(80)).toBe(80);
      expect(clampRatio(50.4)).toBe(50);
    });

    it('reads persisted ratio or defaults to 70', () => {
      const getRatio = () => {
        try {
          const saved = localStorage.getItem('zuber_split_ratio');
          if (saved) {
            const parsed = parseFloat(saved);
            if (!isNaN(parsed) && parsed >= 20 && parsed <= 80) return parsed;
          }
        } catch {}
        return 70;
      };

      expect(getRatio()).toBe(70);

      localStorage.setItem('zuber_split_ratio', '65');
      expect(getRatio()).toBe(65);

      localStorage.setItem('zuber_split_ratio', '999');
      expect(getRatio()).toBe(70);
    });
  });

  describe('renderReadingHtml', () => {
    it('renders reading markdown with callouts, wikilinks and highlights', () => {
      const md = `
# Title
> [!NOTE] Info
> Important note content

Check out [[OtherNote|Alias]] and ==highlighted text==.
`;
      const html = renderReadingHtml(md, 'Current.md', []);
      expect(html).toContain('reading-callout callout-note');
      expect(html).toContain('Important note content');
      expect(html).toContain('data-wikilink="OtherNote"');
      expect(html).toContain('Alias');
      expect(html).toContain('<mark>highlighted text</mark>');
    });

    it('renders task lists with task-list-item class', () => {
      const md = `- [ ] Open task\n- [x] Done task`;
      const html = renderReadingHtml(md, 'Task.md', []);
      expect(html).toContain('task-list-item');
      expect(html).toContain('type="checkbox"');
    });
  });

  describe('ResearchPane Component & Navigation Routing', () => {
    const mockGraphData = {
      nodes: [],
      edges: [],
      tags: [],
    };

    it('renders Graph view badge when target is graph', () => {
      act(() => {
        root.render(
          <ResearchPane
            target={{ path: '', type: 'graph' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            graphData={mockGraphData}
            allNotes={[]}
            activeNotePath={null}
          />
        );
      });

      const badge = container.querySelector('.research-type-badge');
      expect(badge?.textContent).toBe('GRAPH');
    });

    it('triggers onOpenInMain when header button is clicked', () => {
      const onOpenInMain = vi.fn();
      const target: ResearchTarget = { path: 'RefNote.md', type: 'note' };

      act(() => {
        root.render(
          <ResearchPane
            target={target}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={onOpenInMain}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            graphData={mockGraphData}
            allNotes={[]}
            activeNotePath={null}
          />
        );
      });

      const openInMainBtn = container.querySelector<HTMLButtonElement>(
        '.open-in-main-btn'
      );
      expect(openInMainBtn).not.toBeNull();
      act(() => {
        openInMainBtn!.click();
      });
      expect(onOpenInMain).toHaveBeenCalledWith('RefNote.md');
    });

    it('triggers onClose when close button is clicked', () => {
      const onClose = vi.fn();
      act(() => {
        root.render(
          <ResearchPane
            target={{ path: 'RefNote.md', type: 'note' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={onClose}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            graphData={mockGraphData}
            allNotes={[]}
            activeNotePath={null}
          />
        );
      });

      const closeBtn = container.querySelector<HTMLButtonElement>(
        '.close-btn'
      );
      expect(closeBtn).not.toBeNull();
      act(() => {
        closeBtn!.click();
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('routes Alt+Click to main editor and standard click to research view', () => {
      const onOpenInMain = vi.fn();
      const onOpenInResearch = vi.fn();
      const isResearchOpen = true;

      const handleNoteSelect = (
        path: string,
        event?: { altKey?: boolean; preventDefault?: () => void }
      ) => {
        if (event?.altKey) {
          event.preventDefault?.();
          onOpenInMain(path);
        } else if (isResearchOpen) {
          onOpenInResearch(path);
        } else {
          onOpenInMain(path);
        }
      };

      // 1. Normal click while research pane is open -> routes to Research
      handleNoteSelect('Target.md');
      expect(onOpenInResearch).toHaveBeenCalledWith('Target.md');
      expect(onOpenInMain).not.toHaveBeenCalled();

      // 2. Alt+Click while research pane is open -> routes to Main Editor
      const preventDefault = vi.fn();
      handleNoteSelect('Target.md', { altKey: true, preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(onOpenInMain).toHaveBeenCalledWith('Target.md');
    });

    it('renders image viewer with zoom controls for images', () => {
      act(() => {
        root.render(
          <ResearchPane
            target={{ path: 'attachments/diagram.png', type: 'image' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            graphData={mockGraphData}
            allNotes={[]}
            activeNotePath={null}
          />
        );
      });

      const badge = container.querySelector('.research-type-badge');
      expect(badge?.textContent).toBe('IMG');
      expect(container.querySelector('.image-zoom-indicator')?.textContent).toBe('100%');
      expect(container.querySelector('button[title="Zoom In (+)"]')).not.toBeNull();
      expect(container.querySelector('button[title="Zoom Out (-)"]')).not.toBeNull();
      expect(container.querySelector('button[title="Fit / 100%"]')).not.toBeNull();
    });

    it('renders pdf iframe viewer for pdf documents', () => {
      act(() => {
        root.render(
          <ResearchPane
            target={{ path: 'attachments/paper.pdf', type: 'pdf' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            graphData={mockGraphData}
            allNotes={[]}
            activeNotePath={null}
          />
        );
      });

      const badge = container.querySelector('.research-type-badge');
      expect(badge?.textContent).toBe('PDF');
      const iframe = container.querySelector('iframe.research-pdf-frame');
      expect(iframe).not.toBeNull();
    });
  });
});
