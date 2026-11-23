/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'fs';
import path from 'path';
import {
  revealPathInExpandedFolders,
  scrollTreeElementToTop,
} from './utils/fileTreeUtils';
import {
  ZUBER_QUOTE_MIME,
  formatQuoteMarkdown,
  wrapQuoteForInsertion,
} from './utils/quoteUtils';
import { renderReadingHtml, renderWebArticleHtml } from './utils/readingMode';
import { FileSidebar } from './components/FileSidebar';
import { ResearchPane } from './components/ResearchPane';
import { LivePreviewEditor, type LivePreviewEditorRef } from './components/LivePreviewEditor';
import { I18nProvider } from './i18n';
import { api } from './api';
import { saveFavorites, recordRecentNote } from './utils/vaultNavigation';
import type { FileTreeNode } from '../shared/types';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })) as any;
}

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

describe('FileTree Auto-Reveal, Blockquotes, Web Reader & Quote Drag-and-Drop', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('1. revealPathInExpandedFolders expands ancestor folders additively without closing already open folders', () => {
    const initialExpanded: Record<string, boolean> = {
      OtherOpenFolder: true,
      'OtherOpenFolder/Sub': true,
      CollapsedFolder: false,
    };

    // File path -> expands every ancestor folder while keeping existing open folders intact
    const nextFile = revealPathInExpandedFolders(
      initialExpanded,
      'Ablage/Wohnung/IT/Router.md'
    );
    expect(nextFile).toEqual({
      OtherOpenFolder: true,
      'OtherOpenFolder/Sub': true,
      CollapsedFolder: false,
      Ablage: true,
      'Ablage/Wohnung': true,
      'Ablage/Wohnung/IT': true,
    });
    expect(nextFile['Ablage/Wohnung/IT/Router.md']).toBeUndefined();

    // Folder path -> expands ancestors AND the folder itself without collapsing prior folders
    const nextFolder = revealPathInExpandedFolders(nextFile, 'Projects/2026', {
      isFolder: true,
    });
    expect(nextFolder['OtherOpenFolder']).toBe(true);
    expect(nextFolder['OtherOpenFolder/Sub']).toBe(true);
    expect(nextFolder['Ablage/Wohnung/IT']).toBe(true);
    expect(nextFolder['Projects']).toBe(true);
    expect(nextFolder['Projects/2026']).toBe(true);

    // Companion canvas file -> also expands owning .canvas entry
    const nextCompanion = revealPathInExpandedFolders(
      initialExpanded,
      'Projects/Board.canvas.assets/Note.md',
      { isFolder: false, owningCanvasPath: 'Projects/Board.canvas' }
    );
    expect(nextCompanion['Projects']).toBe(true);
    expect(nextCompanion['Projects/Board.canvas']).toBe(true);
    expect(nextCompanion['OtherOpenFolder']).toBe(true);
  });

  it('2. FileSidebar reveals Favorites, Recent Notes & activePath changes additively and scrolls only the tree scroller to top', async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;

    try {
      localStorage.setItem('zuber_show_favorites_panel', 'true');
      localStorage.setItem('zuber_show_recent_panel', 'true');
      saveFavorites([
        { path: 'Deep/Nested/FavNote.md', type: 'file' },
        { path: 'Archive/OldFolder', type: 'folder' },
      ]);
      recordRecentNote('RecentDir/Sub/RecentDoc.md');

      const tree: FileTreeNode[] = [
        {
          name: 'AlreadyOpen',
          path: 'AlreadyOpen',
          type: 'folder',
          children: [
            {
              name: 'StayOpen.md',
              path: 'AlreadyOpen/StayOpen.md',
              type: 'file',
              extension: 'md',
            },
          ],
        },
        {
          name: 'Deep',
          path: 'Deep',
          type: 'folder',
          children: [
            {
              name: 'Nested',
              path: 'Deep/Nested',
              type: 'folder',
              children: [
                {
                  name: 'FavNote.md',
                  path: 'Deep/Nested/FavNote.md',
                  type: 'file',
                  extension: 'md',
                },
              ],
            },
          ],
        },
        {
          name: 'Archive',
          path: 'Archive',
          type: 'folder',
          children: [
            {
              name: 'OldFolder',
              path: 'Archive/OldFolder',
              type: 'folder',
              children: [
                {
                  name: 'Child.md',
                  path: 'Archive/OldFolder/Child.md',
                  type: 'file',
                  extension: 'md',
                },
              ],
            },
          ],
        },
        {
          name: 'RecentDir',
          path: 'RecentDir',
          type: 'folder',
          children: [
            {
              name: 'Sub',
              path: 'RecentDir/Sub',
              type: 'folder',
              children: [
                {
                  name: 'RecentDoc.md',
                  path: 'RecentDir/Sub/RecentDoc.md',
                  type: 'file',
                  extension: 'md',
                },
              ],
            },
          ],
        },
      ];

      const onSelectNote = vi.fn();

      const renderTree = (activePath: string | null) => {
        act(() => {
          root.render(
            <FileSidebar
              tree={tree}
              activePath={activePath}
              tags={[]}
              selectedTagFilter={null}
              onSelectTagFilter={vi.fn()}
              onClose={vi.fn()}
              onSelectNote={onSelectNote}
              onCreateNote={vi.fn()}
              onCreateCanvas={vi.fn()}
              onCreateFolder={vi.fn()}
              onRenameEntry={vi.fn()}
              onDeleteEntry={vi.fn()}
              onRefresh={vi.fn()}
              onOpenDailyNote={vi.fn()}
              onOpenTemplateSelect={vi.fn()}
            />
          );
        });
      };

      renderTree(null);

      // Expand 'AlreadyOpen' manually first — must remain open throughout!
      const alreadyOpenRow = container.querySelector(
        '[data-tree-path="AlreadyOpen"]'
      ) as HTMLElement;
      expect(alreadyOpenRow).not.toBeNull();
      act(() => {
        alreadyOpenRow.click();
      });
      expect(
        container.querySelector('[data-tree-path="AlreadyOpen/StayOpen.md"]')
      ).not.toBeNull();

      // Mock container geometry to verify scroll-to-top alignment (~4px top offset)
      const scroller = container.querySelector('.file-tree-scroller') as HTMLElement;
      scroller.scrollTop = 20;
      vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 0,
        right: 260,
        bottom: 600,
        width: 260,
        height: 500,
        x: 0,
        y: 100,
        toJSON: () => {},
      });

      const windowScrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      // A: Click Favorite file
      const favFileRow = container.querySelector('.favorite-item') as HTMLElement;
      expect(favFileRow).not.toBeNull();
      act(() => {
        favFileRow.click();
      });
      expect(onSelectNote).toHaveBeenCalledWith('Deep/Nested/FavNote.md');

      const revealedFav = container.querySelector(
        '[data-tree-path="Deep/Nested/FavNote.md"]'
      ) as HTMLElement | null;
      expect(revealedFav).not.toBeNull();
      // 'AlreadyOpen' remained expanded!
      expect(
        container.querySelector('[data-tree-path="AlreadyOpen/StayOpen.md"]')
      ).not.toBeNull();

      // Verify scroll helper aligns element 4px below container top
      scroller.scrollTop = 20;
      vi.spyOn(revealedFav!, 'getBoundingClientRect').mockReturnValue({
        top: 344,
        left: 0,
        right: 260,
        bottom: 372,
        width: 260,
        height: 28,
        x: 0,
        y: 344,
        toJSON: () => {},
      });
      scrollTreeElementToTop(scroller, revealedFav, 4);
      // 20 + (344 - 100) - 4 = 260
      expect(scroller.scrollTop).toBe(260);
      expect(windowScrollSpy).not.toHaveBeenCalled();

      // B: Click Favorite folder -> expands Archive & Archive/OldFolder additively
      const favItems = container.querySelectorAll('.favorite-item');
      act(() => {
        (favItems[1] as HTMLElement).click();
      });
      expect(
        container.querySelector('[data-tree-path="Archive/OldFolder/Child.md"]')
      ).not.toBeNull();
      expect(
        container.querySelector('[data-tree-path="AlreadyOpen/StayOpen.md"]')
      ).not.toBeNull();

      // C: Click Recent Note -> reveals RecentDir/Sub/RecentDoc.md without closing Archive or AlreadyOpen
      const recentRow = container.querySelector('.recent-item') as HTMLElement;
      expect(recentRow).not.toBeNull();
      act(() => {
        recentRow.click();
      });
      expect(onSelectNote).toHaveBeenCalledWith('RecentDir/Sub/RecentDoc.md');
      expect(
        container.querySelector('[data-tree-path="RecentDir/Sub/RecentDoc.md"]')
      ).not.toBeNull();
      expect(
        container.querySelector('[data-tree-path="Archive/OldFolder/Child.md"]')
      ).not.toBeNull();

      // D: activePath change via Wiki-Link / Search reveals target without closing others
      renderTree('Deep/Nested/FavNote.md');
      expect(
        container.querySelector('[data-tree-path="Deep/Nested/FavNote.md"]')?.classList.contains('active')
      ).toBe(true);
      expect(
        container.querySelector('[data-tree-path="RecentDir/Sub/RecentDoc.md"]')
      ).not.toBeNull();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it('3. preserves multiline blockquote line breaks in renderReadingHtml/renderWebArticleHtml, defines blockquote CSS, and sanitizes web HTML strictly', () => {
    const md = '> Zeile 1 des Zitats\n> Zeile 2 des Zitats';
    const readingHtml = renderReadingHtml(md, 'Quote.md', []);
    expect(readingHtml).toContain('<blockquote>');
    expect(readingHtml).toMatch(/Zeile 1 des Zitats<br\s*\/?>\s*Zeile 2 des Zitats/);

    const dirtyWebMd = [
      '> Web Line 1',
      '> Web Line 2',
      '',
      '<script>alert("xss")</script>',
      '<iframe src="https://evil.test"></iframe>',
      '<p data-track="1" style="color:red">Clean paragraph</p>',
    ].join('\n');

    const safeWebHtml = renderWebArticleHtml(dirtyWebMd);
    expect(safeWebHtml).toContain('<blockquote>');
    expect(safeWebHtml).toMatch(/Web Line 1<br\s*\/?>\s*Web Line 2/);
    expect(safeWebHtml).toContain('Clean paragraph');
    expect(safeWebHtml).not.toContain('<script');
    expect(safeWebHtml).not.toContain('<iframe');
    expect(safeWebHtml).not.toContain('data-track');
    expect(safeWebHtml).not.toContain('style=');

    const css = fs.readFileSync(path.resolve(__dirname, 'styles.css'), 'utf-8');
    expect(css).toContain('.reading-view-content blockquote');
    expect(css).toContain('border-left: 3px solid var(--border-color, #4a5568)');
    expect(css).toContain('.reading-view-content blockquote blockquote');
  });

  it('4. formats web and PDF blockquotes cleanly with attribution link, page number, and blank-line padding', () => {
    const webQuote = formatQuoteMarkdown(
      {
        text: 'Erste Zeile\nZweite Zeile',
        title: 'Beispiel-Artikel',
        url: 'https://example.com/artikel',
      },
      'S.'
    );
    expect(webQuote).toBe(
      '> Erste Zeile\n> Zweite Zeile\n> — [Beispiel-Artikel](https://example.com/artikel)'
    );

    const pdfQuote = formatQuoteMarkdown(
      {
        text: 'Wichtiger Befund im PDF.',
        title: 'Paper Draft.pdf',
        url: 'Docs/Paper Draft.pdf',
        page: 4,
        isInternal: true,
      },
      'S.'
    );
    expect(pdfQuote).toBe(
      '> Wichtiger Befund im PDF.\n> — [Paper Draft.pdf (S. 4)](Docs/Paper%20Draft.pdf)'
    );

    const doc = 'Intro line\nNext line';
    const insertPos = 'Intro line'.length;
    const wrappedMid = wrapQuoteForInsertion(doc, insertPos, webQuote);
    const resultMid = doc.slice(0, insertPos) + wrappedMid + doc.slice(insertPos);
    expect(resultMid).toBe(
      'Intro line\n\n> Erste Zeile\n> Zweite Zeile\n> — [Beispiel-Artikel](https://example.com/artikel)\n\nNext line'
    );
  });

  it('5. ResearchPane renders Markdown reader toggle, triggers Save as Note, sets x-zuber-quote on dragstart, and triggers Quick-Quote popover', async () => {
    vi.spyOn(api, 'extractWebUrl').mockResolvedValue({
      type: 'article',
      url: 'https://example.com/post',
      title: 'Web Reader Article',
      byline: 'Author One',
      siteName: 'Example News',
      markdown: 'Paragraph one.\n\nParagraph two.',
    });
    vi.spyOn(api, 'checkLinkEmbed').mockResolvedValue({ embeddable: true });

    const onSaveWebNote = vi.fn().mockResolvedValue(undefined);
    const onInsertQuote = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <ResearchPane
            target={{ path: 'https://example.com/post', type: 'web' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            onOpenWebUrl={vi.fn()}
            onSaveWebNote={onSaveWebNote}
            onInsertQuote={onInsertQuote}
            graphData={{ nodes: [], edges: [], tags: [] }}
            allNotes={[]}
            activeNotePath="Current.md"
          />
        </I18nProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const reader = container.querySelector('[data-testid="research-web-reader"]') as HTMLElement;
    expect(reader).toBeTruthy();
    expect(reader.textContent).toContain('Web Reader Article');
    expect(reader.textContent).toContain('Paragraph one.');

    // Save as Note button
    const saveBtn = container.querySelector('[data-testid="research-web-save-note-btn"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    await act(async () => {
      saveBtn.click();
    });
    expect(onSaveWebNote).toHaveBeenCalledWith({
      title: 'Web Reader Article',
      url: 'https://example.com/post',
      byline: 'Author One',
      siteName: 'Example News',
      markdown: 'Paragraph one.\n\nParagraph two.',
    });

    // Simulate selecting text inside the rendered article body
    const paragraph = reader.querySelector('.research-web-article-body p') as HTMLElement;
    const textNode = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.textContent!.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Quick-Quote popover appears on mouseup and calls onInsertQuote when clicked
    act(() => {
      reader.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const popoverBtn = container.querySelector('[data-testid="research-quote-popover"]') as HTMLButtonElement | null;
    expect(popoverBtn).not.toBeNull();
    act(() => {
      popoverBtn?.click();
    });
    expect(onInsertQuote).toHaveBeenCalledWith({
      text: 'Paragraph one.',
      url: 'https://example.com/post',
      title: 'Web Reader Article',
      isInternal: false,
    });

    // Dragstart sets application/x-zuber-quote payload
    const setDataMock = vi.fn();
    const dragEvt = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEvt, 'dataTransfer', {
      value: { setData: setDataMock, effectAllowed: '' },
    });
    act(() => {
      paragraph.dispatchEvent(dragEvt);
    });
    const quoteCall = setDataMock.mock.calls.find((c) => c[0] === ZUBER_QUOTE_MIME);
    expect(quoteCall).toBeDefined();
    expect(JSON.parse(quoteCall![1])).toEqual({
      text: 'Paragraph one.',
      url: 'https://example.com/post',
      title: 'Web Reader Article',
      isInternal: false,
    });

    // Switch to HTML mode and back to Markdown
    const htmlToggle = container.querySelector('[data-testid="research-web-mode-html"]') as HTMLButtonElement;
    act(() => {
      htmlToggle.click();
    });
    expect(container.querySelector('[data-testid="research-web-iframe"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="research-web-reader"]')).toBeNull();
  });

  it('6. LivePreviewEditor drops application/x-zuber-quote as formatted Markdown blockquote and supports insertMarkdownBlock', () => {
    const onChangeBody = vi.fn();
    const editorRef = React.createRef<LivePreviewEditorRef>();

    act(() => {
      root.render(
        <I18nProvider>
          <LivePreviewEditor
            ref={editorRef}
            notePath="Target.md"
            body="Header"
            rawContent="Header"
            mode="live"
            allNotes={[]}
            allTags={[]}
            onChangeBody={onChangeBody}
            onChangeRaw={vi.fn()}
            onNavigateWikiLink={vi.fn()}
            onSelectTag={vi.fn()}
          />
        </I18nProvider>
      );
    });

    const cmContent = container.querySelector('.cm-content') as HTMLElement;
    expect(cmContent).not.toBeNull();

    const quotePayload = JSON.stringify({
      text: 'Quote line one\nQuote line two',
      title: 'Research Paper.pdf',
      url: 'Docs/Research Paper.pdf',
      page: 4,
      isInternal: true,
    });

    const dropEvt = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvt, 'clientX', { value: 10 });
    Object.defineProperty(dropEvt, 'clientY', { value: 10 });
    Object.defineProperty(dropEvt, 'dataTransfer', {
      value: {
        types: [ZUBER_QUOTE_MIME, 'text/plain'],
        files: [],
        getData: (mime: string) => (mime === ZUBER_QUOTE_MIME ? quotePayload : ''),
      },
    });

    act(() => {
      cmContent.dispatchEvent(dropEvt);
    });

    expect(onChangeBody).toHaveBeenCalled();
    const lastBody = onChangeBody.mock.calls[onChangeBody.mock.calls.length - 1][0] as string;
    expect(lastBody).toContain('> Quote line one\n> Quote line two');
    expect(lastBody).toContain('> — [Research Paper.pdf (p. 4)](Docs/Research%20Paper.pdf)');

    // Also test programmatic insertMarkdownBlock (used by Quick-Quote popover)
    onChangeBody.mockClear();
    act(() => {
      editorRef.current?.insertMarkdownBlock('> Direct quote\n> — [Web](https://example.com)');
    });
    expect(onChangeBody).toHaveBeenCalled();
    const afterInsert = onChangeBody.mock.calls[onChangeBody.mock.calls.length - 1][0] as string;
    expect(afterInsert).toContain('> Direct quote\n> — [Web](https://example.com)');
  });
});
