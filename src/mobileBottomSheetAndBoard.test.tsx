/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { I18nProvider } from './i18n';
import { BottomSheet, useMobileBackHandler, __resetMobileBackHandlerForTests } from './components/BottomSheet';
import { BaseBoardSortPopover } from './components/base/BaseBoardSortPopover';
import { BaseFilterPopover } from './components/base/BaseFilterPopover';
import { BaseColumnsModal } from './components/base/BaseColumnsModal';
import { BaseBoardConfigModal } from './components/base/BaseBoardConfigModal';
import { BaseBoardView } from './components/base/BaseBoardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { api } from './api';
import type { BaseQueryResult, BaseRecord } from './base/baseEngine';
import type { BaseViewConfig } from './base/baseConfig';

// Mock localStorage cleanly for Node/JSDOM
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

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

function makeRecord(path: string, name: string, props: Record<string, any>): BaseRecord {
  return {
    file: {
      path,
      name: `${name}.md`,
      folder: '',
      ext: 'md',
      ctime: 1000,
      mtime: 2000,
      inFolder: () => false,
      hasTag: () => false,
      hasLink: () => false,
    },
    properties: props,
    tags: [],
    links: [],
    formulas: {},
  };
}

describe('Phase 1: BottomSheet, Mobile Back Handler, Hook Safety, Board Move Sheet & ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    __resetMobileBackHandlerForTests();
    localStorage.clear();
    setViewportWidth(1280);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('BottomSheet renders via portal, closes on backdrop click, and supports swipe-down (> 60px) to dismiss', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <BottomSheet isOpen={true} onClose={onClose} title="Test Sheet">
          <div data-testid="sheet-content">Hello Sheet</div>
        </BottomSheet>
      );
    });

    expect(document.body.textContent).toContain('Test Sheet');
    expect(document.querySelector('[data-testid="sheet-content"]')).toBeTruthy();

    const dragZone = document.querySelector('.bottom-sheet-drag-zone') as HTMLElement;
    expect(dragZone).toBeTruthy();

    // Small swipe (<= 60px) should NOT close
    act(() => {
      dragZone.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, touches: [{ clientY: 100 } as Touch] })
      );
      dragZone.dispatchEvent(
        new TouchEvent('touchmove', { bubbles: true, touches: [{ clientY: 140 } as Touch] })
      );
      dragZone.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    // Large swipe (> 60px) SHOULD close
    act(() => {
      dragZone.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, touches: [{ clientY: 100 } as Touch] })
      );
      dragZone.dispatchEvent(
        new TouchEvent('touchmove', { bubbles: true, touches: [{ clientY: 180 } as Touch] })
      );
      dragZone.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Backdrop tap closes
    const backdrop = document.querySelector('.bottom-sheet-backdrop') as HTMLElement;
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('useMobileBackHandler closes the topmost open sheet/drawer first on popstate (LIFO)', () => {
    const closeDrawer = vi.fn();
    const closeSheet = vi.fn();

    const TestHarness: React.FC<{ drawerOpen: boolean; sheetOpen: boolean }> = ({
      drawerOpen,
      sheetOpen,
    }) => {
      useMobileBackHandler(drawerOpen, closeDrawer);
      useMobileBackHandler(sheetOpen, closeSheet);
      return null;
    };

    act(() => {
      root.render(<TestHarness drawerOpen={true} sheetOpen={true} />);
    });

    // First system back closes topmost layer (sheet)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();

    // Second system back closes drawer
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(closeDrawer).toHaveBeenCalledTimes(1);
  });

  it('BaseBoardSortPopover, BaseFilterPopover, and BaseColumnsModal withstand rapid isOpen toggling on mobile & desktop without hook errors', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onApplySort = vi.fn();
    const onClose = vi.fn();

    for (const width of [1280, 375]) {
      setViewportWidth(width);
      for (const open of [false, true, false, true, false]) {
        act(() => {
          root.render(
            <I18nProvider>
              <BaseBoardSortPopover
                isOpen={open}
                onClose={onClose}
                anchorEl={anchor}
                onApplySort={onApplySort}
                cardProperties={['status', 'priority']}
              />
              <BaseFilterPopover
                isOpen={open}
                onClose={onClose}
                rules={[]}
                onChangeRules={vi.fn()}
                availableProperties={[{ key: 'status', label: 'Status' }]}
                vaultFolders={[]}
                vaultTags={[]}
              />
              <BaseColumnsModal
                isOpen={open}
                onClose={onClose}
                order={['file.name', 'status']}
                availableProperties={[{ key: 'status', label: 'Status' }]}
                displayNames={{}}
                onReorder={vi.fn()}
                onToggleColumn={vi.fn()}
                onResetColumns={vi.fn()}
              />
            </I18nProvider>
          );
        });
      }
    }
    anchor.remove();
  });

  it('1D Board: tapping card Move button opens BottomSheet and moves card to selected column', async () => {
    setViewportWidth(375);
    const onCellChange = vi.fn().mockResolvedValue(undefined);
    const records: BaseRecord[] = [
      makeRecord('Tasks/TaskA.md', 'TaskA', { status: 'Open' }),
    ];
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Board',
      groupBy: { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
    };
    const queryResult: BaseQueryResult = {
      definition: { views: [view] },
      view,
      records,
      columns: ['file.name', 'status'],
      columnDisplayNames: {},
      groups: [],
      totalCount: records.length,
    };

    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardView
            queryResult={queryResult}
            view={view}
            onSelectNote={vi.fn()}
            onCellChange={onCellChange}
          />
        </I18nProvider>
      );
    });

    const moveBtn = container.querySelector('button[aria-label="Move TaskA"]') as HTMLButtonElement;
    expect(moveBtn).toBeTruthy();
    act(() => {
      moveBtn.click();
    });

    const buttons = Array.from(document.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    const finishBtn = buttons.find((b) => b.textContent?.includes('Finish'));
    expect(finishBtn).toBeTruthy();

    await act(async () => {
      finishBtn!.click();
    });

    expect(onCellChange).toHaveBeenCalledWith('Tasks/TaskA.md', 'status', 'Finish');
  });

  it('2D Swimlane Board: tapping card Move button opens BottomSheet with Column and Swimlane groups', async () => {
    setViewportWidth(375);
    const onCellChange = vi.fn().mockResolvedValue(undefined);
    const records: BaseRecord[] = [
      makeRecord('Tasks/TaskB.md', 'TaskB', { status: 'Open', priority: 'High' }),
    ];
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Board 2D',
      groupBy: { property: 'status', columns: ['Open', 'Finish'] },
      swimlanes: { property: 'priority', lanes: ['High', 'Low'] },
    };
    const queryResult: BaseQueryResult = {
      definition: { views: [view] },
      view,
      records,
      columns: ['file.name', 'status', 'priority'],
      columnDisplayNames: {},
      groups: [],
      totalCount: records.length,
    };

    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardView
            queryResult={queryResult}
            view={view}
            onSelectNote={vi.fn()}
            onCellChange={onCellChange}
          />
        </I18nProvider>
      );
    });

    const moveBtn = container.querySelector('button[aria-label="Move TaskB"]') as HTMLButtonElement;
    expect(moveBtn).toBeTruthy();
    act(() => {
      moveBtn.click();
    });

    const buttons = Array.from(document.querySelectorAll('.bottom-sheet-action-btn')) as HTMLButtonElement[];
    const lowLaneBtn = buttons.find((b) => b.textContent?.includes('Low'));
    expect(lowLaneBtn).toBeTruthy();

    await act(async () => {
      lowLaneBtn!.click();
    });

    expect(onCellChange).toHaveBeenCalledWith('Tasks/TaskB.md', 'priority', 'Low');
  });

  it('ErrorBoundary renders Reset Active View & Reload button that clears only active view localStorage keys', () => {
    localStorage.setItem('knowmesh_last_active_note', 'Broken.md');
    localStorage.setItem('zuber_last_active_note', 'Broken.md');
    localStorage.setItem('knowmesh_open_tabs', '["Broken.md"]');
    localStorage.setItem('zuber_open_tabs', '["Broken.md"]');
    localStorage.setItem('zuber_theme', 'dark-cold');

    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });

    const BrokenChild = () => {
      throw new Error('Simulated render crash #310');
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>
      );
    });
    consoleSpy.mockRestore();

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const resetBtn = buttons.find((b) => /Ansicht zurücksetzen|Reset Active View/i.test(b.textContent || ''));
    expect(resetBtn).toBeTruthy();

    act(() => {
      resetBtn!.click();
    });

    expect(localStorage.getItem('knowmesh_last_active_note')).toBeNull();
    expect(localStorage.getItem('zuber_last_active_note')).toBeNull();
    expect(localStorage.getItem('knowmesh_open_tabs')).toBeNull();
    expect(localStorage.getItem('zuber_open_tabs')).toBeNull();
    expect(localStorage.getItem('zuber_theme')).toBe('dark-cold');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('Mobile 1D Board (< 768px): renders single active column, switches via ‹/› and Column Selector BottomSheet, and switches cleanly between mobile and desktop without hook errors', async () => {
    const records: BaseRecord[] = [
      makeRecord('Tasks/T1.md', 'Task1', { status: 'Open' }),
      makeRecord('Tasks/T2.md', 'Task2', { status: 'Open' }),
      makeRecord('Tasks/T3.md', 'Task3', { status: 'inWork' }),
      makeRecord('Tasks/T4.md', 'Task4', { status: 'Finish' }),
    ];
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Mobile 1D Board',
      groupBy: { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
    };
    const queryResult: BaseQueryResult = {
      definition: { views: [view] },
      view,
      records,
      columns: ['file.name', 'status'],
      columnDisplayNames: {},
      groups: [],
      totalCount: records.length,
    };

    const onAddCard = vi.fn();

    // Start on mobile (< 768px)
    setViewportWidth(375);
    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardView
            queryResult={queryResult}
            view={view}
            onSelectNote={vi.fn()}
            onAddCard={onAddCard}
          />
        </I18nProvider>
      );
    });

    // Only 1 column ('Open') is rendered in the DOM on mobile
    expect(container.querySelector('.base-board-mobile-switcher')).toBeTruthy();
    expect(container.querySelectorAll('.base-board-column').length).toBe(1);
    expect(container.querySelector('.mobile-col-active-title')?.textContent).toBe('Open');
    expect(container.querySelectorAll('.base-board-card').length).toBe(2);

    // Step next (›) -> 'inWork'
    const nextBtn = container.querySelector('.mobile-col-next-btn') as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();
    act(() => {
      nextBtn.click();
    });
    expect(container.querySelector('.mobile-col-active-title')?.textContent).toBe('inWork');
    expect(container.querySelectorAll('.base-board-column').length).toBe(1);
    expect(container.querySelectorAll('.base-board-card').length).toBe(1);
    expect(container.querySelector('.base-card-title')?.textContent).toBe('Task3');

    // Open Column Selector BottomSheet via dropdown trigger (▾) and select 'Finish'
    const selectorTrigger = container.querySelector('.mobile-col-selector-trigger') as HTMLButtonElement;
    expect(selectorTrigger).toBeTruthy();
    act(() => {
      selectorTrigger.click();
    });

    const colOptions = Array.from(
      document.querySelectorAll('.mobile-col-option-btn')
    ) as HTMLButtonElement[];
    expect(colOptions.length).toBe(3);
    const finishOption = colOptions.find((b) => b.textContent?.includes('Finish'));
    expect(finishOption).toBeTruthy();

    act(() => {
      finishOption!.click();
    });

    expect(container.querySelector('.mobile-col-active-title')?.textContent).toBe('Finish');
    expect(container.querySelector('.base-card-title')?.textContent).toBe('Task4');

    // Clicking '+' in mobile switcher bar adds card to active column ('Finish')
    const addBtn = container.querySelector(
      '.base-board-mobile-switcher .base-board-add-card-btn'
    ) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    act(() => {
      addBtn.click();
    });
    expect(onAddCard).toHaveBeenCalledWith('Finish');

    // Switch viewport to Desktop (>= 768px) -> all 3 columns render without React Error #310
    setViewportWidth(1280);
    expect(container.querySelector('.base-board-mobile-switcher')).toBeNull();
    expect(container.querySelectorAll('.base-board-column').length).toBe(3);

    // Switch back to Mobile (< 768px) -> single column again
    setViewportWidth(375);
    expect(container.querySelector('.base-board-mobile-switcher')).toBeTruthy();
    expect(container.querySelectorAll('.base-board-column').length).toBe(1);
  });

  it('Mobile 2D Swimlane Board (< 768px): stacks swimlanes vertically for activeMobileColumn and pre-fills both column and swimlane on + click', async () => {
    setViewportWidth(375);
    const records: BaseRecord[] = [
      makeRecord('Tasks/S1.md', 'SwimCard1', { status: 'Open', prio: 'Prio 1' }),
      makeRecord('Tasks/S2.md', 'SwimCard2', { status: 'inWork', prio: 'Prio 2' }),
    ];
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Mobile 2D Board',
      groupBy: { property: 'status', columns: ['Open', 'inWork'] },
      swimlanes: { property: 'prio', lanes: ['Prio 1', 'Prio 2'] },
    };
    const queryResult: BaseQueryResult = {
      definition: { views: [view] },
      view,
      records,
      columns: ['file.name', 'status', 'prio'],
      columnDisplayNames: {},
      groups: [],
      totalCount: records.length,
    };

    const onAddCard = vi.fn();
    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardView
            queryResult={queryResult}
            view={view}
            onSelectNote={vi.fn()}
            onAddCard={onAddCard}
          />
        </I18nProvider>
      );
    });

    // Active column defaults to 'Open'; both swimlanes are rendered vertically, each with only 1 cell ('Open')
    const swimlaneBands = container.querySelectorAll('.base-board-swimlane-band');
    expect(swimlaneBands.length).toBe(2);
    expect(swimlaneBands[0].querySelectorAll('.base-board-swimlane-cell').length).toBe(1);
    expect(swimlaneBands[1].querySelectorAll('.base-board-swimlane-cell').length).toBe(1);

    // Switch active column to 'inWork' via next step button (›)
    const nextBtn = container.querySelector('.mobile-col-next-btn') as HTMLButtonElement;
    act(() => {
      nextBtn.click();
    });
    expect(container.querySelector('.mobile-col-active-title')?.textContent).toBe('inWork');

    // Click '+' on the second swimlane ('Prio 2') -> must pre-fill activeMobileColumn ('inWork') and swimlane ('Prio 2')
    const lane2AddBtn = swimlaneBands[1].querySelector('.mobile-swimlane-add-btn') as HTMLButtonElement;
    expect(lane2AddBtn).toBeTruthy();
    act(() => {
      lane2AddBtn.click();
    });
    expect(onAddCard).toHaveBeenCalledWith('inWork', 'Prio 2');
  });

  it('Card Action & Move BottomSheet persists frontmatter via api.saveNote and supports Open Note action', async () => {
    setViewportWidth(375);
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Tasks/CardM.md',
      body: '# Card M',
      properties: [
        { key: 'status', value: 'Open', type: 'text' },
        { key: 'prio', value: 'Prio 1', type: 'text' },
      ],
    } as any);
    const saveNoteSpy = vi.spyOn(api, 'saveNote').mockResolvedValue({} as any);
    const onSelectNote = vi.fn();

    const records: BaseRecord[] = [
      makeRecord('Tasks/CardM.md', 'CardM', { status: 'Open', prio: 'Prio 1' }),
    ];
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Board 2D',
      groupBy: { property: 'status', columns: ['Open', 'Finish'] },
      swimlanes: { property: 'prio', lanes: ['Prio 1', 'Prio 2'] },
    };
    const queryResult: BaseQueryResult = {
      definition: { views: [view] },
      view,
      records,
      columns: ['file.name', 'status', 'prio'],
      columnDisplayNames: {},
      groups: [],
      totalCount: records.length,
    };

    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardView
            queryResult={queryResult}
            view={view}
            onSelectNote={onSelectNote}
          />
        </I18nProvider>
      );
    });

    const moveBtn = container.querySelector('button[aria-label="Move CardM"]') as HTMLButtonElement;
    expect(moveBtn).toBeTruthy();
    act(() => {
      moveBtn.click();
    });

    // Move to column 'Finish' -> saves via api.saveNote
    let sheetButtons = Array.from(
      document.querySelectorAll('.bottom-sheet-action-btn')
    ) as HTMLButtonElement[];
    const finishColBtn = sheetButtons.find((b) => b.textContent?.includes('Finish'));
    expect(finishColBtn).toBeTruthy();

    await act(async () => {
      finishColBtn!.click();
    });

    expect(saveNoteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'Tasks/CardM.md',
        properties: expect.arrayContaining([{ key: 'status', value: 'Finish', type: 'text' }]),
        forceOverwrite: true,
      })
    );

    // Click 'Open Note' action row -> calls onSelectNote('Tasks/CardM.md')
    sheetButtons = Array.from(
      document.querySelectorAll('.bottom-sheet-action-btn')
    ) as HTMLButtonElement[];
    const openNoteBtn = sheetButtons.find((b) =>
      b.classList.contains('bottom-sheet-open-note-btn')
    );
    expect(openNoteBtn).toBeTruthy();
    act(() => {
      openNoteBtn!.click();
    });
    expect(onSelectNote).toHaveBeenCalledWith('Tasks/CardM.md');

    getNoteSpy.mockRestore();
    saveNoteSpy.mockRestore();
  });

  it('BaseBoardConfigModal renders inside BottomSheet with pinned Save/Cancel footer on < 768px', () => {
    setViewportWidth(375);
    const onSave = vi.fn();
    const onClose = vi.fn();
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Board',
      groupBy: { property: 'status', columns: ['Open', 'Finish'] },
    };

    act(() => {
      root.render(
        <I18nProvider>
          <BaseBoardConfigModal
            isOpen={true}
            onClose={onClose}
            view={view}
            availableProperties={[{ key: 'status', label: 'Status' }]}
            onSave={onSave}
          />
        </I18nProvider>
      );
    });

    expect(document.querySelector('.bottom-sheet-container')).toBeTruthy();
    const saveBtn = document.querySelector(
      '.bottom-sheet-footer .board-config-save-btn'
    ) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();

    act(() => {
      saveBtn.click();
    });
    expect(onSave).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
