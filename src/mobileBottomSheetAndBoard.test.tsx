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
import { BaseBoardView } from './components/base/BaseBoardView';
import { ErrorBoundary } from './components/ErrorBoundary';
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
});
