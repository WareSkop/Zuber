/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { I18nProvider } from './i18n';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileEditBar } from './components/MobileEditBar';
import { __resetMobileBackHandlerForTests } from './components/BottomSheet';
import { getMobileReadingDefault, setMobileReadingDefault } from './startupConfig';
import type { LivePreviewEditorRef } from './components/LivePreviewEditor';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
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

function createMockEditorRef(): React.RefObject<LivePreviewEditorRef | null> {
  return {
    current: {
      applyFormat: vi.fn(),
      insertTable: vi.fn(),
      insertCodeBlock: vi.fn(),
      insertTask: vi.fn(),
      insertWikiLink: vi.fn(),
      insertTag: vi.fn(),
      insertHeading: vi.fn(),
      insertList: vi.fn(),
      indent: vi.fn(),
      outdent: vi.fn(),
      insertQuote: vi.fn(),
      insertCallout: vi.fn(),
      insertHorizontalRule: vi.fn(),
      isCursorInTable: vi.fn(() => false),
      insertTableRow: vi.fn(),
      insertTableColumn: vi.fn(),
      insertImageEmbed: vi.fn(),
      insertExternalLink: vi.fn(),
      insertDateTime: vi.fn(),
      getSelectedText: vi.fn(() => ''),
      hasSelection: vi.fn(() => false),
      replaceSelection: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
    },
  };
}

describe('Phase 2 Mobile One-Thumb Ergonomics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorageMock.clear();
    __resetMobileBackHandlerForTests();
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    __resetMobileBackHandlerForTests();
    vi.restoreAllMocks();
  });

  it('persists getMobileReadingDefault with true as default', () => {
    expect(getMobileReadingDefault()).toBe(true);
    setMobileReadingDefault(false);
    expect(getMobileReadingDefault()).toBe(false);
    setMobileReadingDefault(true);
    expect(getMobileReadingDefault()).toBe(true);
  });

  it('renders 5 buttons in MobileBottomNav and opens More BottomSheet with actions', () => {
    const onOpenFiles = vi.fn();
    const onOpenSearch = vi.fn();
    const onStartEdit = vi.fn();
    const onQuickNote = vi.fn();
    const onSwitchMode = vi.fn();
    const onToggleResearch = vi.fn();
    const onOpenRightSidebar = vi.fn();
    const onToggleZen = vi.fn();
    const onRenameActive = vi.fn();
    const onDeleteActive = vi.fn();
    const onOpenSettings = vi.fn();

    act(() => {
      root.render(
        <I18nProvider>
          <MobileBottomNav
            editorMode="reading"
            canEditNote={true}
            hasActiveNote={true}
            activeNoteName="Test.md"
            onOpenFiles={onOpenFiles}
            onOpenSearch={onOpenSearch}
            onStartEdit={onStartEdit}
            onQuickNote={onQuickNote}
            onSwitchMode={onSwitchMode}
            onToggleResearch={onToggleResearch}
            onOpenRightSidebar={onOpenRightSidebar}
            onToggleZen={onToggleZen}
            onRenameActive={onRenameActive}
            onDeleteActive={onDeleteActive}
            onOpenSettings={onOpenSettings}
          />
        </I18nProvider>
      );
    });

    const buttons = container.querySelectorAll('.mobile-bottom-nav-btn');
    expect(buttons.length).toBe(5);

    act(() => {
      (buttons[0] as HTMLButtonElement).click();
      (buttons[1] as HTMLButtonElement).click();
      (buttons[2] as HTMLButtonElement).click();
      (buttons[3] as HTMLButtonElement).click();
    });
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onQuickNote).toHaveBeenCalledTimes(1);

    // Open More (⋮) BottomSheet
    act(() => {
      (buttons[4] as HTMLButtonElement).click();
    });

    const sheet = document.body.querySelector('.bottom-sheet-container');
    expect(sheet).not.toBeNull();
    const rows = Array.from(sheet!.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    expect(rows.length).toBeGreaterThanOrEqual(6);

    // Click Settings (last row)
    act(() => {
      rows[rows.length - 1].click();
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.bottom-sheet-container')).toBeNull();
  });

  it('hides Edit button in MobileBottomNav when canEditNote is false', () => {
    act(() => {
      root.render(
        <I18nProvider>
          <MobileBottomNav
            editorMode="reading"
            canEditNote={false}
            hasActiveNote={true}
            onOpenFiles={vi.fn()}
            onOpenSearch={vi.fn()}
            onStartEdit={vi.fn()}
            onQuickNote={vi.fn()}
            onSwitchMode={vi.fn()}
            onToggleResearch={vi.fn()}
            onOpenRightSidebar={vi.fn()}
            onToggleZen={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </I18nProvider>
      );
    });

    expect(container.querySelectorAll('.mobile-bottom-nav-btn').length).toBe(4);
    expect(container.querySelector('.mobile-bottom-nav-edit-btn')).toBeNull();
  });

  it('renders 7 buttons in MobileEditBar, supports Heading/Image/Hybrid BottomSheets, and Done blurs & exits', () => {
    const editorRef = createMockEditorRef();
    const onDone = vi.fn();

    act(() => {
      root.render(
        <I18nProvider>
          <MobileEditBar
            editorRef={editorRef}
            onUploadImage={vi.fn(async () => 'img.png')}
            onSendToTarget={vi.fn()}
            onDone={onDone}
          />
        </I18nProvider>
      );
    });

    const barButtons = container.querySelectorAll('.mobile-edit-bar-btn');
    expect(barButtons.length).toBe(7);

    // 1. Todo, 2. Indent, 4. WikiLink
    act(() => {
      (barButtons[0] as HTMLButtonElement).click();
      (barButtons[1] as HTMLButtonElement).click();
      (barButtons[3] as HTMLButtonElement).click();
    });
    expect(editorRef.current!.insertTask).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.indent).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.insertWikiLink).toHaveBeenCalledWith(true);

    // 3. Heading BottomSheet -> H2
    act(() => {
      (barButtons[2] as HTMLButtonElement).click();
    });
    const headingRows = Array.from(document.body.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    expect(headingRows.length).toBeGreaterThanOrEqual(4);
    const h2Row = headingRows.find((r) => r.textContent?.includes('H2'));
    expect(h2Row).toBeDefined();
    act(() => {
      h2Row!.click();
    });
    expect(editorRef.current!.insertHeading).toHaveBeenCalledWith(2);

    // 5. Image/Camera BottomSheet
    act(() => {
      (barButtons[4] as HTMLButtonElement).click();
    });
    const imageRows = Array.from(document.body.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    expect(imageRows.length).toBe(2);
    // Close via backdrop
    act(() => {
      (document.body.querySelector('.bottom-sheet-backdrop') as HTMLElement).click();
    });

    // 6. Hybrid + More BottomSheet (2x3 format grid + Table submenu)
    act(() => {
      (barButtons[5] as HTMLButtonElement).click();
    });
    const tiles = Array.from(document.body.querySelectorAll('.hybrid-format-tile')) as HTMLButtonElement[];
    expect(tiles.length).toBe(6);
    act(() => {
      tiles[0].click(); // Bold
    });
    expect(editorRef.current!.applyFormat).toHaveBeenCalledWith('bold');

    // Re-open + More and test Table 3x3
    act(() => {
      (barButtons[5] as HTMLButtonElement).click();
    });
    const moreRows = Array.from(document.body.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    const tableRow = moreRows.find((r) => r.textContent?.includes('Table') || r.textContent?.includes('Tabelle'));
    expect(tableRow).toBeDefined();
    act(() => {
      tableRow!.click();
    });
    const tableSizeRows = Array.from(document.body.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    const row3x3 = tableSizeRows.find((r) => r.textContent?.includes('3 × 3'));
    expect(row3x3).toBeDefined();
    act(() => {
      row3x3!.click();
    });
    expect(editorRef.current!.insertTable).toHaveBeenCalledWith(3, 3);

    // 7. Done ✓
    act(() => {
      (barButtons[6] as HTMLButtonElement).click();
    });
    expect(editorRef.current!.blur).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
