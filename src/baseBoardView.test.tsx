/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { parseBaseYaml, stringifyBaseYaml, type BaseConfig } from './base/baseConfig';
import { executeBaseQuery, type BaseQueryResult, type BaseRecord } from './base/baseEngine';
import { BaseBoardView } from './components/base/BaseBoardView';
import { BaseToolbar } from './components/base/BaseToolbar';
import { BaseBoardConfigModal } from './components/base/BaseBoardConfigModal';
import { BaseColumnsModal } from './components/base/BaseColumnsModal';
import { BaseBoardColumn } from './components/base/BaseBoardColumn';
import { BaseEditor } from './components/BaseEditor';
import { api } from './api';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
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
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Base Kanban Board View (`type: board`)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('parses and stringifies YAML with board view, columnLimit, and groupBy.columns', () => {
    const yaml = `
views:
  - type: board
    name: "Sprint Board"
    groupBy:
      property: status
      columns:
        - Open
        - inWork
        - Waiting
        - Finish
    columnLimit: 10
    order:
      - file.name
      - priority
      - assignee
`.trim();

    const config = parseBaseYaml(yaml);
    expect(config.views.length).toBe(1);
    const boardView = config.views[0];
    expect(boardView.type).toBe('board');
    expect(boardView.name).toBe('Sprint Board');
    expect(boardView.groupBy?.property).toBe('status');
    expect(boardView.groupBy?.columns).toEqual(['Open', 'inWork', 'Waiting', 'Finish']);
    expect(boardView.columnLimit).toBe(10);
    expect(boardView.order).toEqual(['file.name', 'priority', 'assignee']);

    // Test round-trip serialization
    const serialized = stringifyBaseYaml(config);
    expect(serialized).toContain('type: board');
    expect(serialized).toContain('property: status');
    expect(serialized).toContain('columnLimit: 10');
    expect(serialized).toContain('Open');
    expect(serialized).toContain('Finish');

    const reParsed = parseBaseYaml(serialized);
    expect(reParsed.views[0].type).toBe('board');
    expect(reParsed.views[0].columnLimit).toBe(10);
  });

  it('groups notes into board columns and sorts by mtime descending by default', () => {
    const files = [
      {
        path: 'Tasks/Task 1.md',
        name: 'Task 1.md',
        folder: 'Tasks',
        mtime: 1000,
        frontmatter: { status: 'Open' },
        properties: [{ key: 'status', value: 'Open' }],
      },
      {
        path: 'Tasks/Task 2.md',
        name: 'Task 2.md',
        folder: 'Tasks',
        mtime: 3000,
        frontmatter: { status: 'open' }, // case-insensitive
        properties: [{ key: 'status', value: 'open' }],
      },
      {
        path: 'Tasks/Task 3.md',
        name: 'Task 3.md',
        folder: 'Tasks',
        mtime: 2000,
        frontmatter: { status: 'Finish' },
        properties: [{ key: 'status', value: 'Finish' }],
      },
      {
        path: 'Tasks/Task 4.md',
        name: 'Task 4.md',
        folder: 'Tasks',
        mtime: 500,
        frontmatter: {}, // no status
        properties: [],
      },
    ];

    const config: BaseConfig = {
      views: [
        {
          type: 'board',
          name: 'Board',
          groupBy: {
            property: 'status',
            columns: ['Open', 'inWork', 'Waiting', 'Finish'],
          },
        },
      ],
    };

    const queryResult = executeBaseQuery(config, files, 0);
    expect(queryResult.groups).toBeDefined();
    expect(queryResult.groups!.length).toBeGreaterThanOrEqual(4);

    const openGroup = queryResult.groups!.find((g) => g.key.toLowerCase() === 'open');
    expect(openGroup).toBeDefined();
    expect(openGroup!.records.length).toBe(2);
    // Task 2 has mtime 3000, Task 1 has mtime 1000 => Task 2 should be first
    expect(openGroup!.records[0].file.name).toBe('Task 2.md');
    expect(openGroup!.records[1].file.name).toBe('Task 1.md');

    const finishGroup = queryResult.groups!.find((g) => g.key.toLowerCase() === 'finish');
    expect(finishGroup).toBeDefined();
    expect(finishGroup!.records.length).toBe(1);

    const noStatusGroup = queryResult.groups!.find((g) => g.key === 'no_status');
    expect(noStatusGroup).toBeDefined();
    expect(noStatusGroup!.records.length).toBe(1);
    expect(noStatusGroup!.records[0].file.name).toBe('Task 4.md');
  });

  const createMockRecord = (
    path: string,
    name: string,
    folder: string,
    tags: string[],
    properties: Record<string, any>,
    mtime: number = Date.now()
  ): BaseRecord => ({
    file: {
      path,
      name,
      folder,
      ext: 'md',
      mtime,
      inFolder: (f: string) => folder.startsWith(f),
      hasTag: (t: string) => tags.includes(t),
      hasLink: () => false,
    },
    tags,
    links: [],
    properties,
    formulas: {},
  });

  it('renders Kanban columns, enforces columnLimit, and toggles Show More / Fewer', async () => {
    // Generate 14 records in "Open" column
    const records: BaseRecord[] = [];
    for (let i = 1; i <= 14; i++) {
      records.push(
        createMockRecord(
          `Tasks/Task ${i}.md`,
          `Task ${i}.md`,
          'Tasks',
          ['bug'],
          { status: 'Open', priority: 'High' },
          1000 + i
        )
      );
    }

    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork', 'Finish'],
      },
      columnLimit: 10,
      order: ['file.name', 'priority'],
    };

    const mockQueryResult: BaseQueryResult = {
      definition: { views: [viewConfig] },
      view: viewConfig,
      columns: ['file.name', 'priority'],
      columnDisplayNames: { priority: 'Priorität' },
      records,
      groups: [],
      totalCount: records.length,
    };

    const handleSelectNote = vi.fn();
    const handleCellChange = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={handleSelectNote}
          onCellChange={handleCellChange}
        />
      );
    });

    const columns = container.querySelectorAll('.base-board-column');
    expect(columns.length).toBe(3); // Open, inWork, Finish

    // Open column has 14 cards, but limit is 10
    const openColumn = columns[0];
    const cards = openColumn.querySelectorAll('.base-board-card');
    expect(cards.length).toBe(10);

    // "Show more" button should be visible showing remaining 4 cards
    const showMoreBtn = openColumn.querySelector('.base-board-show-more-btn') as HTMLButtonElement;
    expect(showMoreBtn).toBeTruthy();
    expect(showMoreBtn.textContent).toContain('4');

    // Click show more
    await act(async () => {
      showMoreBtn.click();
    });

    // Now all 14 cards are shown
    const expandedCards = openColumn.querySelectorAll('.base-board-card');
    expect(expandedCards.length).toBe(14);

    // Show fewer button is now visible
    const showFewerBtn = openColumn.querySelector('.base-board-show-more-btn') as HTMLButtonElement;
    expect(showFewerBtn).toBeTruthy();

    // Click show fewer
    await act(async () => {
      showFewerBtn.click();
    });

    // Sliced back to 10
    expect(openColumn.querySelectorAll('.base-board-card').length).toBe(10);
  });

  it('optimistically moves card on drag and drop and calls onCellChange', async () => {
    const records: BaseRecord[] = [
      createMockRecord(
        'Tasks/Story.md',
        'Story.md',
        'Sprint',
        ['feature'],
        { status: 'Open' },
        1000
      ),
    ];

    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork', 'Finish'],
      },
      columnLimit: 10,
    };

    const mockQueryResult: BaseQueryResult = {
      definition: { views: [viewConfig] },
      view: viewConfig,
      columns: ['file.name', 'status'],
      columnDisplayNames: {},
      records,
      groups: [],
      totalCount: records.length,
    };

    const handleCellChange = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={vi.fn()}
          onCellChange={handleCellChange}
        />
      );
    });

    const columns = container.querySelectorAll('.base-board-column');
    const openCol = columns[0];
    const inWorkCol = columns[1];

    expect(openCol.querySelectorAll('.base-board-card').length).toBe(1);
    expect(inWorkCol.querySelectorAll('.base-board-card').length).toBe(0);

    // Simulate drag start on the card
    const card = openCol.querySelector('.base-board-card') as HTMLDivElement;
    const mockDataTransfer = {
      data: {} as Record<string, string>,
      setData: function (k: string, v: string) {
        this.data[k] = v;
      },
      getData: function (k: string) {
        return this.data[k] || '';
      },
      dropEffect: 'none',
    };

    await act(async () => {
      card.dispatchEvent(
        new CustomEvent('dragstart', {
          bubbles: true,
          detail: mockDataTransfer,
        })
      );
    });

    // Simulate drop on inWork column
    await act(async () => {
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? 'Tasks/Story.md' : ''),
        },
      });
      inWorkCol.dispatchEvent(dropEvent);
    });

    // onCellChange must be called with notePath, property, and new column value
    expect(handleCellChange).toHaveBeenCalledWith('Tasks/Story.md', 'status', 'inWork');

    // UI should optimistically show card in inWork column immediately
    expect(inWorkCol.querySelectorAll('.base-board-card').length).toBe(1);
    expect(openCol.querySelectorAll('.base-board-card').length).toBe(0);
  });

  it('supports creating and switching to Board view in BaseToolbar', async () => {
    const mockConfig: BaseConfig = {
      views: [
        { type: 'table', name: 'Table' },
      ],
    };

    const handleAddView = vi.fn();
    const handleSwitchViewType = vi.fn();

    await act(async () => {
      root.render(
        <BaseToolbar
          config={mockConfig}
          activeViewIndex={0}
          onSelectView={vi.fn()}
          onAddView={handleAddView}
          onRenameView={vi.fn()}
          onDuplicateView={vi.fn()}
          onDeleteView={vi.fn()}
          onSwitchViewType={handleSwitchViewType}
          activeFilterCount={0}
          isFilterPopoverOpen={false}
          onToggleFilterPopover={vi.fn()}
          onOpenColumnsModal={vi.fn()}
          availableProperties={[]}
          onSortChange={vi.fn()}
          onGroupByChange={vi.fn()}
          editorMode="visual"
          onToggleEditorMode={vi.fn()}
        />
      );
    });

    // 1. Open "+ Ansicht" popover and select Board type
    const addBtn = container.querySelector('.base-add-tab-btn') as HTMLButtonElement;
    await act(async () => {
      addBtn.click();
    });

    const typeButtons = container.querySelectorAll('.add-view-types .type-btn');
    expect(typeButtons.length).toBe(3); // Table, Cards, Board

    // Click 3rd button (Board)
    await act(async () => {
      (typeButtons[2] as HTMLButtonElement).click();
    });

    // Submit form
    const form = container.querySelector('.add-view-dropdown') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(handleAddView).toHaveBeenCalledWith(expect.any(String), 'board');

    // 2. Open tab dropdown menu and switch to Board view
    const menuTrigger = container.querySelector('.base-tab-menu-trigger') as HTMLButtonElement;
    await act(async () => {
      menuTrigger.click();
    });

    const switchToBoardBtn = Array.from(container.querySelectorAll('.tab-dropdown .base-dropdown-item')).find((el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('board');
    }) as HTMLButtonElement;
    expect(switchToBoardBtn).toBeTruthy();

    await act(async () => {
      switchToBoardBtn.click();
    });

    expect(handleSwitchViewType).toHaveBeenCalledWith(0, 'board');
  });

  it('resets card opacity and is-dragging class on dragend', async () => {
    const record = createMockRecord('Tasks/Story.md', 'Story.md', 'Sprint', ['feature'], { status: 'Open' });
    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: { property: 'status', columns: ['Open', 'Finish'] },
      columnLimit: 10,
    };
    const mockQueryResult: BaseQueryResult = {
      definition: { views: [viewConfig] },
      view: viewConfig,
      columns: ['file.name', 'status'],
      columnDisplayNames: {},
      records: [record],
      groups: [],
      totalCount: 1,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={vi.fn()}
        />
      );
    });

    const card = container.querySelector('.base-board-card') as HTMLDivElement;
    expect(card).toBeTruthy();

    // Start drag
    await act(async () => {
      card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    expect(card.classList.contains('is-dragging')).toBe(true);
    expect(card.style.opacity).toBe('0.5');

    // End drag (dragend)
    await act(async () => {
      card.dispatchEvent(new Event('dragend', { bubbles: true }));
    });
    expect(card.classList.contains('is-dragging')).toBe(false);
    expect(card.style.opacity).toBe('1');
  });

  it('supports inline column renaming, adding new column, and deleting column', async () => {
    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
      columnLimit: 10,
    };
    const mockQueryResult: BaseQueryResult = {
      definition: { views: [viewConfig] },
      view: viewConfig,
      columns: ['file.name'],
      columnDisplayNames: {},
      records: [],
      groups: [],
      totalCount: 0,
    };

    const handleRenameColumn = vi.fn();
    const handleDeleteColumn = vi.fn();
    const handleAddColumn = vi.fn();

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={vi.fn()}
          onRenameColumn={handleRenameColumn}
          onDeleteColumn={handleDeleteColumn}
          onAddColumn={handleAddColumn}
        />
      );
    });

    // 1. Column title is static text - clicking does NOT start renaming
    const openTitle = container.querySelector('.base-board-column-title') as HTMLSpanElement;
    expect(openTitle).toBeTruthy();
    expect(openTitle.textContent).toBe('Open');
    expect(container.querySelector('.base-board-column-title.editable')).toBeNull();

    await act(async () => {
      openTitle.click();
    });
    // Still not in rename mode
    expect(container.querySelector('.base-board-col-rename-input')).toBeNull();

    // 2. Rename column via three-dot menu -> "Rename column"
    const menuTrigger = container.querySelector('.base-board-col-menu-trigger') as HTMLButtonElement;
    expect(menuTrigger).toBeTruthy();
    await act(async () => {
      menuTrigger.click();
    });

    const renameItem = container.querySelector('.col-dropdown .base-dropdown-item:not(.danger)') as HTMLButtonElement;
    expect(renameItem).toBeTruthy();
    await act(async () => {
      renameItem.click();
    });

    const renameInput = container.querySelector('.base-board-col-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    expect(renameInput.value).toBe('Open');

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(renameInput, 'Offen');
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const confirmBtn = container.querySelector('.base-board-col-confirm-btn') as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    expect(handleRenameColumn).toHaveBeenCalledWith('Open', 'Offen');

    // 3. Add new column via "+ Neue Spalte hinzufügen"
    const addColBtn = container.querySelector('.base-board-add-column-btn') as HTMLButtonElement;
    expect(addColBtn).toBeTruthy();
    await act(async () => {
      addColBtn.click();
    });

    const addColInput = container.querySelector('.add-column-input') as HTMLInputElement;
    expect(addColInput).toBeTruthy();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(addColInput, 'Prüfung');
      addColInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveColBtn = container.querySelector('.add-col-actions .primary-btn') as HTMLButtonElement;
    await act(async () => {
      saveColBtn.click();
    });
    expect(handleAddColumn).toHaveBeenCalledWith('Prüfung');

    // 4. Delete column via header menu
    const menuTrigger2 = container.querySelector('.base-board-col-menu-trigger') as HTMLButtonElement;
    expect(menuTrigger2).toBeTruthy();
    await act(async () => {
      menuTrigger2.click();
    });

    const deleteBtn = container.querySelector('.col-dropdown .base-dropdown-item.danger') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    await act(async () => {
      deleteBtn.click();
    });
    expect(handleDeleteColumn).toHaveBeenCalledWith('Open');
  });

  it('renders BaseBoardConfigModal with columns reordering and saves configuration', async () => {
    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
      columnLimit: 10,
    };
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    await act(async () => {
      root.render(
        <BaseBoardConfigModal
          isOpen={true}
          onClose={handleClose}
          view={viewConfig}
          availableProperties={[{ key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' }]}
          onSave={handleSave}
        />
      );
    });

    const rows = container.querySelectorAll('.base-board-column-config-row');
    expect(rows.length).toBe(3);

    // Save form
    const submitBtn = container.querySelector('.base-board-config-modal .primary-btn') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(handleSave).toHaveBeenCalledWith(
      { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
      10
    );
    expect(handleClose).toHaveBeenCalled();
  });

  it('renders BaseColumnsModal with dark theme classes and localized Fertig button', async () => {
    const handleClose = vi.fn();
    const handleReset = vi.fn();

    await act(async () => {
      root.render(
        <BaseColumnsModal
          isOpen={true}
          onClose={handleClose}
          order={['file.name', 'status']}
          availableProperties={[{ key: 'status', label: 'Status' }]}
          displayNames={{}}
          onReorder={vi.fn()}
          onToggleColumn={vi.fn()}
          onResetColumns={handleReset}
        />
      );
    });

    expect(container.querySelector('.base-modal-container')).toBeTruthy();
    expect(container.querySelector('.base-columns-modal')).toBeTruthy();
    expect(container.querySelector('.base-modal-close-btn')).toBeTruthy();

    const columnItems = container.querySelectorAll('.base-column-item');
    expect(columnItems.length).toBeGreaterThan(0);

    // Done button should not show literal 'common.done'
    const doneBtn = container.querySelector('.base-modal-footer .primary-btn') as HTMLButtonElement;
    expect(doneBtn).toBeTruthy();
    expect(doneBtn.textContent).not.toBe('common.done');
    expect(doneBtn.textContent).toMatch(/(Fertig|Done)/i);
  });

  it('keeps DOM node identity in BaseBoardConfigModal on keystrokes so focus is never lost', async () => {
    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: { property: 'status', columns: ['Open', 'inWork', 'Finish'] },
      columnLimit: 10,
    };
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    await act(async () => {
      root.render(
        <BaseBoardConfigModal
          isOpen={true}
          onClose={handleClose}
          view={viewConfig}
          availableProperties={[{ key: 'status', label: 'Status' }]}
          onSave={handleSave}
        />
      );
    });

    const initialInputs = container.querySelectorAll('.column-name-input');
    const firstInput = initialInputs[0] as HTMLInputElement;
    expect(firstInput).toBeTruthy();
    expect(firstInput.value).toBe('Open');

    // Focus first input
    firstInput.focus();
    expect(document.activeElement).toBe(firstInput);

    // Type character by character: 'O', 'p', 'e', 'n', ' ' -> 'Open 2'
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    for (const text of ['Open ', 'Open 2']) {
      await act(async () => {
        nativeSetter?.call(firstInput, text);
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    const currentInputs = container.querySelectorAll('.column-name-input');
    const inputAfterTyping = currentInputs[0] as HTMLInputElement;

    // Critical assertion: The DOM element must be identical (not unmounted/recreated)
    expect(inputAfterTyping).toBe(firstInput);
    expect(inputAfterTyping.value).toBe('Open 2');
  });

  it('verifies BaseBoardColumn: static title, rename only via menu, escape/blur behavior, and remove column', async () => {
    const handleRename = vi.fn();
    const handleDelete = vi.fn();
    const handleAddCard = vi.fn();

    const columnData = {
      key: 'inWork',
      label: 'In Arbeit',
      records: [],
      limit: 10,
    };

    await act(async () => {
      root.render(
        <BaseBoardColumn
          col={columnData}
          columns={['file.name']}
          displayNames={{}}
          groupByProp="status"
          onToggleExpand={vi.fn()}
          onDrop={vi.fn()}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onAddCard={handleAddCard}
          onRenameColumn={handleRename}
          onDeleteColumn={handleDelete}
          onSelectNote={vi.fn()}
          draggingPath={null}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
        />
      );
    });

    // 1. Column title is static text - clicking does NOT start renaming
    const title = container.querySelector('.base-board-column-title') as HTMLSpanElement;
    expect(title).toBeTruthy();
    expect(title.textContent).toBe('In Arbeit');
    expect(title.classList.contains('editable')).toBe(false);

    await act(async () => {
      title.click();
    });
    expect(container.querySelector('.base-board-col-rename-input')).toBeNull();

    // 2. Open rename via menu
    const menuBtn = container.querySelector('.base-board-col-menu-trigger') as HTMLButtonElement;
    expect(menuBtn).toBeTruthy();
    await act(async () => {
      menuBtn.click();
    });

    const renameMenuItem = container.querySelector('.col-dropdown .base-dropdown-item:not(.danger)') as HTMLButtonElement;
    expect(renameMenuItem).toBeTruthy();
    await act(async () => {
      renameMenuItem.click();
    });

    let renameInput = container.querySelector('.base-board-col-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    expect(renameInput.value).toBe('In Arbeit');

    // 3. Escape cancels renaming without saving
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(renameInput, 'Verworfen');
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(handleRename).not.toHaveBeenCalled();
    expect(container.querySelector('.base-board-col-rename-input')).toBeNull();

    // 4. Open rename again, blur or enter saves
    await act(async () => {
      menuBtn.click();
    });
    const renameMenuItem2 = container.querySelector('.col-dropdown .base-dropdown-item:not(.danger)') as HTMLButtonElement;
    await act(async () => {
      renameMenuItem2.click();
    });

    renameInput = container.querySelector('.base-board-col-rename-input') as HTMLInputElement;
    expect(renameInput).toBeTruthy();
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(renameInput, 'In Bearbeitung');
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(handleRename).toHaveBeenCalledWith('inWork', 'In Bearbeitung');

    // 5. Remove column via menu
    await act(async () => {
      menuBtn.click();
    });
    const removeMenuItem = container.querySelector('.col-dropdown .base-dropdown-item.danger') as HTMLButtonElement;
    expect(removeMenuItem).toBeTruthy();
    await act(async () => {
      removeMenuItem.click();
    });
    expect(handleDelete).toHaveBeenCalledWith('inWork');

    // 6. Add card button
    const addCardBtn = container.querySelector('.base-board-add-card-btn') as HTMLButtonElement;
    expect(addCardBtn).toBeTruthy();
    await act(async () => {
      addCardBtn.click();
    });
    expect(handleAddCard).toHaveBeenCalledWith('inWork');
  });

  it('renders No Status column without three-dot menu and passes empty string on add card', async () => {
    const handleAddCard = vi.fn();
    const columnData = {
      key: 'no_status',
      label: 'Kein Status',
      records: [],
      limit: 10,
    };

    await act(async () => {
      root.render(
        <BaseBoardColumn
          col={columnData}
          columns={['file.name']}
          displayNames={{}}
          groupByProp="status"
          onToggleExpand={vi.fn()}
          onDrop={vi.fn()}
          onDragOver={vi.fn()}
          onDragLeave={vi.fn()}
          onAddCard={handleAddCard}
          onSelectNote={vi.fn()}
          draggingPath={null}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
        />
      );
    });

    // Three-dot menu must NOT exist for No Status
    expect(container.querySelector('.base-board-col-menu-trigger')).toBeNull();

    // Add card button works and passes empty string
    const addCardBtn = container.querySelector('.base-board-add-card-btn') as HTMLButtonElement;
    expect(addCardBtn).toBeTruthy();
    await act(async () => {
      addCardBtn.click();
    });
    expect(handleAddCard).toHaveBeenCalledWith('');
  });

  it('creates new card in filtered folder with collision-free name and opens note', async () => {
    const saveNoteSpy = vi.spyOn(api, 'saveNote').mockResolvedValue({} as any);
    const onSelectNote = vi.fn();

    const yaml = `
filters:
  file.inFolder("Sprint 42")
views:
  - type: board
    name: "Board"
    groupBy:
      property: status
      columns:
        - Offen
        - Warte
`.trim();

    const existingFiles = [
      { path: 'Sprint 42/Neue Notiz.md', name: 'Neue Notiz.md', folder: 'Sprint 42' },
    ];

    await act(async () => {
      root.render(
        <BaseEditor
          filePath="Sprint 42/Board.base"
          rawContent={yaml}
          onChange={vi.fn()}
          onSelectNote={onSelectNote}
          allFiles={existingFiles}
        />
      );
    });

    // Click "+ Add Card" on column "Warte"
    const addCardButtons = container.querySelectorAll('.base-board-add-card-btn');
    expect(addCardButtons.length).toBeGreaterThan(0);
    const warteAddBtn = addCardButtons[1] as HTMLButtonElement; // second column is 'Warte'

    await act(async () => {
      warteAddBtn.click();
    });

    // Because 'Sprint 42/Neue Notiz.md' already exists, collision handler should choose 'Sprint 42/Neue Notiz 1.md'
    expect(saveNoteSpy).toHaveBeenCalledWith({
      path: 'Sprint 42/Neue Notiz 1.md',
      body: '# Neue Notiz 1\n',
      properties: [{ key: 'status', value: 'Warte', type: 'text' }],
      forceOverwrite: true,
    });
    expect(onSelectNote).toHaveBeenCalledWith('Sprint 42/Neue Notiz 1.md');

    saveNoteSpy.mockRestore();
  });
});
