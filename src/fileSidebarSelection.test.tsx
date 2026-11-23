/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FileSidebar } from './components/FileSidebar';
import type { FileTreeNode } from '../shared/types';

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('FileSidebar Multi-Select & Selection Logic', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const mockTree: FileTreeNode[] = [
    {
      name: 'FolderA',
      path: 'FolderA',
      type: 'folder',
      children: [
        {
          name: 'Child1.md',
          path: 'FolderA/Child1.md',
          type: 'file',
          extension: 'md',
        },
        {
          name: 'Child2.md',
          path: 'FolderA/Child2.md',
          type: 'file',
          extension: 'md',
        },
      ],
    },
    {
      name: 'RootDoc.md',
      path: 'RootDoc.md',
      type: 'file',
      extension: 'md',
    },
    {
      name: 'OtherDoc.md',
      path: 'OtherDoc.md',
      type: 'file',
      extension: 'md',
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const renderSidebar = (props: {
    activePath?: string | null;
    onSelectNote?: (path: string) => void;
  } = {}) => {
    const onSelectNote = props.onSelectNote ?? vi.fn();
    act(() => {
      root.render(
        <FileSidebar
          tree={mockTree}
          activePath={props.activePath ?? null}
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
    return { onSelectNote };
  };

  it('1. clicking a folder toggles expansion and NEVER selects child files', () => {
    renderSidebar();

    // Find the FolderA tree item
    const folderLabel = Array.from(container.querySelectorAll('.tree-folder-item .tree-label')).find(
      (el) => el.textContent === 'FolderA'
    );
    expect(folderLabel).toBeDefined();
    const folderItem = folderLabel!.closest('.tree-folder-item') as HTMLElement;

    // Normal click to expand folder
    act(() => {
      folderItem.click();
    });

    // Folder itself has is-selected
    expect(folderItem.classList.contains('is-selected')).toBe(true);

    // Children are rendered now
    const child1Label = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'Child1'
    );
    expect(child1Label).toBeDefined();
    const child1Item = child1Label!.closest('.tree-file-item') as HTMLElement;

    const child2Label = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'Child2'
    );
    expect(child2Label).toBeDefined();
    const child2Item = child2Label!.closest('.tree-file-item') as HTMLElement;

    // Critical: Neither Child1 nor Child2 may have the is-selected class!
    expect(child1Item.classList.contains('is-selected')).toBe(false);
    expect(child2Item.classList.contains('is-selected')).toBe(false);
  });

  it('2. normal click on a file resets any previous multi-selection to exactly that single file', () => {
    const onSelectNote = vi.fn();
    renderSidebar({ onSelectNote });

    const rootDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'RootDoc'
    );
    const otherDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'OtherDoc'
    );
    const rootDocItem = rootDocLabel!.closest('.tree-file-item') as HTMLElement;
    const otherDocItem = otherDocLabel!.closest('.tree-file-item') as HTMLElement;

    // 1. Select RootDoc
    act(() => {
      rootDocItem.click();
    });
    expect(onSelectNote).toHaveBeenCalledWith('RootDoc.md');
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);
    expect(otherDocItem.classList.contains('is-selected')).toBe(false);

    // 2. Ctrl+click OtherDoc (multi-select)
    act(() => {
      otherDocItem.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
      );
    });
    // Both should be selected
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);
    expect(otherDocItem.classList.contains('is-selected')).toBe(true);

    // 3. Normal click on RootDoc (must clear OtherDoc and keep only RootDoc)
    act(() => {
      rootDocItem.click();
    });
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);
    expect(otherDocItem.classList.contains('is-selected')).toBe(false);
  });

  it('3. Ctrl / Cmd + click toggles selection without changing the active note', () => {
    const onSelectNote = vi.fn();
    renderSidebar({ onSelectNote });

    const rootDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'RootDoc'
    );
    const otherDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'OtherDoc'
    );
    const rootDocItem = rootDocLabel!.closest('.tree-file-item') as HTMLElement;
    const otherDocItem = otherDocLabel!.closest('.tree-file-item') as HTMLElement;

    // Ctrl+click RootDoc
    act(() => {
      rootDocItem.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
      );
    });
    expect(onSelectNote).not.toHaveBeenCalled();
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);

    // Ctrl+click OtherDoc
    act(() => {
      otherDocItem.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
      );
    });
    expect(onSelectNote).not.toHaveBeenCalled();
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);
    expect(otherDocItem.classList.contains('is-selected')).toBe(true);

    // Cmd+click RootDoc to deselect it
    act(() => {
      rootDocItem.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
      );
    });
    expect(onSelectNote).not.toHaveBeenCalled();
    expect(rootDocItem.classList.contains('is-selected')).toBe(false);
    expect(otherDocItem.classList.contains('is-selected')).toBe(true);
  });

  it('4. Shift + click performs range selection without changing the active note', () => {
    const onSelectNote = vi.fn();
    renderSidebar({ onSelectNote });

    const rootDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'RootDoc'
    );
    const otherDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'OtherDoc'
    );
    const rootDocItem = rootDocLabel!.closest('.tree-file-item') as HTMLElement;
    const otherDocItem = otherDocLabel!.closest('.tree-file-item') as HTMLElement;

    // Set anchor on RootDoc via normal click
    act(() => {
      rootDocItem.click();
    });
    expect(onSelectNote).toHaveBeenCalledTimes(1);

    // Shift+click OtherDoc
    act(() => {
      otherDocItem.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
      );
    });
    // onSelectNote should NOT have been called again
    expect(onSelectNote).toHaveBeenCalledTimes(1);
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);
    expect(otherDocItem.classList.contains('is-selected')).toBe(true);
  });

  it('5. Escape key and clicking empty scroller area clear selection', () => {
    renderSidebar();

    const rootDocLabel = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === 'RootDoc'
    );
    const rootDocItem = rootDocLabel!.closest('.tree-file-item') as HTMLElement;

    // Select RootDoc
    act(() => {
      rootDocItem.click();
    });
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);

    // Press Escape
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(rootDocItem.classList.contains('is-selected')).toBe(false);

    // Select RootDoc again
    act(() => {
      rootDocItem.click();
    });
    expect(rootDocItem.classList.contains('is-selected')).toBe(true);

    // Click on empty scroller area (not on a .tree-item)
    const scroller = container.querySelector('.file-tree-scroller') as HTMLElement;
    act(() => {
      scroller.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(rootDocItem.classList.contains('is-selected')).toBe(false);
  });

  const dispatchDragOver = (el: HTMLElement) => {
    const evt = new Event('dragover', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(evt, 'dataTransfer', {
      value: { dropEffect: 'none', types: ['application/x-knowmesh-paths'] },
      writable: true,
    });
    el.dispatchEvent(evt);
  };

  const getFolderItem = (name: string) => {
    const label = Array.from(container.querySelectorAll('.tree-folder-item .tree-label')).find(
      (el) => el.textContent === name
    );
    return label!.closest('.tree-folder-item') as HTMLElement;
  };

  const getFileItem = (name: string) => {
    const label = Array.from(container.querySelectorAll('.tree-file-item .tree-label')).find(
      (el) => el.textContent === name
    );
    return label!.closest('.tree-file-item') as HTMLElement;
  };

  it('6. dragover on a folder or its child file highlights ONLY the folder row, never sibling child files', () => {
    renderSidebar();

    // Expand FolderA
    act(() => {
      getFolderItem('FolderA').click();
    });

    const folderA = getFolderItem('FolderA');
    const child1 = getFileItem('Child1');
    const child2 = getFileItem('Child2');

    // Drag over Child1 inside FolderA
    act(() => {
      dispatchDragOver(child1);
    });

    expect(folderA.classList.contains('is-drop-target')).toBe(true);
    expect(child1.classList.contains('is-drop-target')).toBe(false);
    expect(child2.classList.contains('is-drop-target')).toBe(false);
  });

  it('7. sticky drop-target highlight clears on scroller dragleave, item dragend, window drop/blur/Escape, file click, and tab switch', () => {
    renderSidebar();

    // Expand FolderA and verify Child1 is rendered
    act(() => {
      getFolderItem('FolderA').click();
    });

    // 7a. Leaving .file-tree-scroller clears drop target
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);

    const scroller = container.querySelector('.file-tree-scroller') as HTMLElement;
    // Moving between child items inside the scroller must NOT prematurely clear dropTargetFolder
    act(() => {
      const innerLeaveEvt = new Event('dragleave', { bubbles: true }) as unknown as DragEvent;
      Object.defineProperty(innerLeaveEvt, 'relatedTarget', { value: getFolderItem('FolderA') });
      getFileItem('Child1').dispatchEvent(innerLeaveEvt);
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);

    // Leaving .file-tree-scroller completely (relatedTarget outside scroller / null) MUST clear dropTargetFolder
    act(() => {
      const leaveEvt = new Event('dragleave', { bubbles: true }) as unknown as DragEvent;
      Object.defineProperty(leaveEvt, 'relatedTarget', { value: null });
      scroller.dispatchEvent(leaveEvt);
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);

    // 7b. Item onDragEnd (e.g. dropped onto canvas/editor outside sidebar) clears drop target
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);
    act(() => {
      getFileItem('RootDoc').dispatchEvent(new Event('dragend', { bubbles: true }));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);

    // 7c. Window capture drop outside sidebar clears drop target
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);

    // 7d. Pressing Escape clears drop target
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);

    // 7e. Normal click on another file clears any residual drop target
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);
    act(() => {
      getFileItem('OtherDoc').click();
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);

    // 7f. Switching to Search tab and back to Files leaves zero drop-target highlights
    act(() => {
      dispatchDragOver(getFolderItem('FolderA'));
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(true);
    const tabBtns = container.querySelectorAll('.sidebar-tabs .sidebar-tab-btn');
    const filesTabBtn = tabBtns[0] as HTMLElement;
    const searchTabBtn = tabBtns[1] as HTMLElement;
    act(() => {
      searchTabBtn.click();
    });
    act(() => {
      filesTabBtn.click();
    });
    expect(getFolderItem('FolderA').classList.contains('is-drop-target')).toBe(false);
    expect(container.querySelectorAll('.is-drop-target').length).toBe(0);
  });
});
