/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { parseBaseYaml, stringifyBaseYaml, type BaseConfig, type BaseViewConfig } from './base/baseConfig';
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
    mtime: number = Date.now(),
    ctime: number = mtime
  ): BaseRecord => ({
    file: {
      path,
      name,
      folder,
      ext: 'md',
      mtime,
      ctime,
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

  it('supports inline column renaming and deleting column, and verifies no standalone add column button', async () => {
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

    // 3. Verify no standalone "+ Neue Spalte hinzufügen" button or trailing card exists in 1D board
    expect(container.querySelector('.base-board-add-column-btn')).toBeNull();
    expect(container.querySelector('.base-board-add-column-card')).toBeNull();
    expect(container.querySelector('.board-add-column-card')).toBeNull();

    // Verify column property badge in 1D column header
    const propBadge = container.querySelector('.base-board-column-prop-badge');
    expect(propBadge).toBeTruthy();
    expect(propBadge?.textContent).toBe('STATUS:');

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
      10,
      undefined
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

    // Should open the New Note Dialog
    const modal = container.querySelector('.modal-box');
    expect(modal).toBeTruthy();
    const input = container.querySelector('.modal-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('Neue Notiz 1');

    // Confirm dialog
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Because 'Sprint 42/Neue Notiz.md' already exists, collision handler chose 'Sprint 42/Neue Notiz 1.md'
    expect(saveNoteSpy).toHaveBeenCalledWith({
      path: 'Sprint 42/Neue Notiz 1.md',
      body: '# Neue Notiz 1\n\n',
      properties: [{ key: 'status', value: 'Warte', type: 'text' }],
      forceOverwrite: true,
    });
    expect(onSelectNote).toHaveBeenCalledWith('Sprint 42/Neue Notiz 1.md');

    saveNoteSpy.mockRestore();
  });

  it('triggers onOpenCreateNoteDialog with target folder and column property on + click', async () => {
    const handleOpenDialog = vi.fn();

    const yaml = `
filters:
  file.inFolder("Projekte/Mobile")
views:
  - type: board
    name: "Board"
    groupBy:
      property: status
      columns:
        - "Offen"
        - "In Bearbeitung"
`.trim();

    const sampleFiles = [
      { path: 'Projekte/Mobile/NoteA.md', name: 'NoteA.md', folder: 'Projekte/Mobile' },
    ];

    await act(async () => {
      root.render(
        <BaseEditor
          filePath="Dashboard.base"
          rawContent={yaml}
          onChange={vi.fn()}
          onSelectNote={vi.fn()}
          allFiles={sampleFiles}
          onOpenCreateNoteDialog={handleOpenDialog}
        />
      );
    });

    const addBtns = container.querySelectorAll('.base-board-add-card-btn');
    expect(addBtns.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      (addBtns[0] as HTMLButtonElement).click();
    });

    expect(handleOpenDialog).toHaveBeenCalledWith('Projekte/Mobile', [
      { key: 'status', value: 'Offen', type: 'text' },
    ]);
  });

  it('renders 2D Swimlane Board with repeated column headers per swimlane row, property-value badges, and collapsible rows', async () => {
    const records: BaseRecord[] = [
      createMockRecord('Tasks/T1.md', 'T1.md', 'Tasks', [], { status: 'Open', prio: 'Prio 1' }, 1000),
      createMockRecord('Tasks/T2.md', 'T2.md', 'Tasks', [], { status: 'inWork', prio: 'Prio 2' }, 2000),
      createMockRecord('Tasks/T3.md', 'T3.md', 'Tasks', [], { status: 'Finish', prio: '' }, 3000),
    ];

    const viewConfig = {
      type: 'board' as const,
      name: '2D Board',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork', 'Finish'],
      },
      swimlanes: {
        property: 'prio',
        lanes: [
          { name: 'Prio 1', collapsed: false },
          { name: 'Prio 2', collapsed: false },
        ],
      },
      columnLimit: 10,
    };

    const mockQueryResult: BaseQueryResult = {
      definition: {
        views: [viewConfig],
        properties: {
          prio: { displayName: 'Priorität' },
        },
      },
      view: viewConfig,
      columns: ['file.name', 'status', 'prio'],
      columnDisplayNames: { prio: 'Priorität' },
      records,
      groups: [],
      totalCount: records.length,
    };

    const handleToggleCollapse = vi.fn();
    const handleAddCard = vi.fn();

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={vi.fn()}
          onToggleSwimlaneCollapse={handleToggleCollapse}
          onAddCard={handleAddCard}
        />
      );
    });

    // 1. Verify 2D container, verify detached single sticky header row is ELIMINATED, and no top + Add Column button exists
    expect(container.querySelector('.base-board-2d-container')).toBeTruthy();
    expect(container.querySelector('.base-board-2d-header-row')).toBeNull();
    expect(container.querySelector('.base-board-2d-top-actions')).toBeNull();
    expect(container.querySelector('.base-board-add-column-btn')).toBeNull();

    // 2. Verify swimlane rows: Prio 1, Prio 2, and automatic catch-all "Keine Zuordnung"
    const bands = container.querySelectorAll('.base-board-swimlane-band');
    expect(bands.length).toBe(3);

    // Explicit property name (or displayName) + value in swimlane header
    expect(bands[0].querySelector('.base-board-swimlane-title')?.textContent).toBe('Priorität: Prio 1');
    expect(bands[1].querySelector('.base-board-swimlane-title')?.textContent).toBe('Priorität: Prio 2');
    expect(bands[2].querySelector('.base-board-swimlane-title')?.textContent).toMatch(
      /Keine Zuordnung|No Swimlane/i
    );

    // 3. Verify integrated column blocks inside expanded swimlane row matching 1D container styling
    const cellColumns = bands[0].querySelectorAll('.base-board-swimlane-cells-row .base-board-column');
    expect(cellColumns.length).toBe(3); // Open, inWork, Finish

    // Verify each integrated column cell contains a header with property badge, title, count, and individual + button
    const titles = Array.from(cellColumns).map(
      (item) => item.querySelector('.base-board-column-title')?.textContent
    );
    expect(titles).toEqual(['Open', 'inWork', 'Finish']);

    const propBadges = Array.from(cellColumns).map(
      (item) => item.querySelector('.base-board-column-prop-badge')?.textContent
    );
    expect(propBadges).toEqual(['STATUS:', 'STATUS:', 'STATUS:']);

    const addButtons = bands[0].querySelectorAll('.base-board-add-card-btn');
    expect(addButtons.length).toBe(3);

    // 4. Click "+" button on the second column header ("inWork") in the first swimlane ("Prio 1")
    await act(async () => {
      (addButtons[1] as HTMLButtonElement).click();
    });
    expect(handleAddCard).toHaveBeenCalledWith('inWork', 'Prio 1');

    // 5. Collapsing Prio 1 hides its cells row
    expect(bands[0].querySelector('.base-board-swimlane-cells-row')).toBeTruthy();
    const collapseBtn = bands[0].querySelector('.base-board-swimlane-collapse-btn') as HTMLButtonElement;
    expect(collapseBtn).toBeTruthy();

    await act(async () => {
      collapseBtn.click();
    });

    expect(handleToggleCollapse).toHaveBeenCalledWith('Prio 1', true, false);
    expect(bands[0].querySelector('.base-board-swimlane-cells-row')).toBeNull();
  });

  it('updates both column and swimlane frontmatter properties on 2D cell drag-and-drop', async () => {
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Tasks/CardA.md',
      body: '# Card A',
      properties: [
        { key: 'status', value: 'Open', type: 'text' },
        { key: 'prio', value: 'Prio 1', type: 'text' },
      ],
    } as any);
    const saveNoteSpy = vi.spyOn(api, 'saveNote').mockResolvedValue({} as any);
    const handleCellChange = vi.fn().mockResolvedValue(undefined);

    const records: BaseRecord[] = [
      createMockRecord('Tasks/CardA.md', 'CardA.md', 'Tasks', [], { status: 'Open', prio: 'Prio 1' }, 1000),
    ];

    const viewConfig = {
      type: 'board' as const,
      name: '2D Board',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork', 'Finish'],
      },
      swimlanes: {
        property: 'prio',
        lanes: ['Prio 1', 'Prio 2'],
      },
      columnLimit: 10,
    };

    const mockQueryResult: BaseQueryResult = {
      definition: { views: [viewConfig] },
      view: viewConfig,
      columns: ['file.name', 'status', 'prio'],
      columnDisplayNames: {},
      records,
      groups: [],
      totalCount: 1,
    };

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

    // Find target cell: column "inWork" inside swimlane "Prio 2"
    const targetCell = container.querySelector(
      '.base-board-swimlane-cell[data-column-key="inWork"][data-swimlane-key="Prio 2"]'
    ) as HTMLDivElement;
    expect(targetCell).toBeTruthy();
    expect(targetCell.querySelectorAll('.base-board-card').length).toBe(0);

    // Drop CardA into (inWork, Prio 2)
    await act(async () => {
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          getData: (type: string) => (type === 'text/plain' ? 'Tasks/CardA.md' : ''),
        },
      });
      targetCell.dispatchEvent(dropEvent);
    });

    // Both properties must be updated in a single atomic saveNote call
    expect(saveNoteSpy).toHaveBeenCalledWith({
      path: 'Tasks/CardA.md',
      body: '# Card A',
      properties: [
        { key: 'status', value: 'inWork', type: 'text' },
        { key: 'prio', value: 'Prio 2', type: 'text' },
      ],
      forceOverwrite: true,
    });

    // Optimistic UI immediately shows the card inside (inWork, Prio 2)
    expect(targetCell.querySelectorAll('.base-board-card').length).toBe(1);

    getNoteSpy.mockRestore();
    saveNoteSpy.mockRestore();
  });

  it('pre-fills both column and swimlane properties when clicking + in a swimlane header', async () => {
    const handleOpenDialog = vi.fn();

    const yaml = `
filters:
  file.inFolder("Projekte")
views:
  - type: board
    name: "2D Aufgaben"
    groupBy:
      property: status
      columns:
        - Open
        - inWork
    swimlanes:
      property: prio
      lanes:
        - Prio 1
        - Prio 2
`.trim();

    const sampleFiles = [
      {
        path: 'Projekte/Task1.md',
        name: 'Task1.md',
        folder: 'Projekte',
        properties: [
          { key: 'status', value: 'Open' },
          { key: 'prio', value: 'Prio 1' },
        ],
      },
    ];

    await act(async () => {
      root.render(
        <BaseEditor
          filePath="Projekte/Board.base"
          rawContent={yaml}
          onChange={vi.fn()}
          onSelectNote={vi.fn()}
          allFiles={sampleFiles}
          onOpenCreateNoteDialog={handleOpenDialog}
        />
      );
    });

    // Click "+" button in the second swimlane header ("Prio 2")
    const swimlaneBands = container.querySelectorAll('.base-board-swimlane-band');
    expect(swimlaneBands.length).toBe(2);
    const prio2AddBtn = swimlaneBands[1].querySelector('.base-board-add-card-btn') as HTMLButtonElement;
    expect(prio2AddBtn).toBeTruthy();

    await act(async () => {
      prio2AddBtn.click();
    });

    // Should pass both first column (status: Open) and swimlane (prio: Prio 2)
    expect(handleOpenDialog).toHaveBeenCalledWith('Projekte', [
      { key: 'status', value: 'Open', type: 'text' },
      { key: 'prio', value: 'Prio 2', type: 'text' },
    ]);
  });

  it('renders two-column layout in BaseBoardConfigModal and configures swimlanes without losing focus', async () => {
    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: { property: 'status', columns: ['Open', 'inWork'] },
      columnLimit: 10,
    };
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    const sampleNotes = [
      { path: 'N1.md', properties: [{ key: 'prio', value: 'Hoch' }] },
      { path: 'N2.md', properties: [{ key: 'prio', value: 'Mittel' }] },
    ];

    await act(async () => {
      root.render(
        <BaseBoardConfigModal
          isOpen={true}
          onClose={handleClose}
          view={viewConfig}
          availableProperties={[
            { key: 'status', label: 'Status' },
            { key: 'prio', label: 'Priorität' },
          ]}
          allNotes={sampleNotes}
          onSave={handleSave}
        />
      );
    });

    // Verify 2-column grid layout
    const grid = container.querySelector('.base-board-config-grid');
    expect(grid).toBeTruthy();
    const cols = grid!.querySelectorAll('.base-board-config-col');
    expect(cols.length).toBe(2);

    // Initially swimlanes are disabled -> hint box is shown
    expect(container.querySelector('.base-board-swimlane-hint')).toBeTruthy();

    // Select 'prio' in Swimlanes by dropdown
    const swimlaneSelect = container.querySelector('#board-swimlane-by-select') as HTMLSelectElement;
    expect(swimlaneSelect).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(swimlaneSelect, 'prio');
      swimlaneSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Hint box should disappear and auto-suggested values ('Hoch', 'Mittel') should be populated
    expect(container.querySelector('.base-board-swimlane-hint')).toBeNull();
    const swimlaneInputs = container.querySelectorAll('.swimlane-name-input');
    expect(swimlaneInputs.length).toBe(2);
    expect((swimlaneInputs[0] as HTMLInputElement).value).toBe('Hoch');
    expect((swimlaneInputs[1] as HTMLInputElement).value).toBe('Mittel');

    // Verify typing into swimlane input preserves DOM node identity (no focus loss)
    const firstLaneInput = swimlaneInputs[0] as HTMLInputElement;
    firstLaneInput.focus();
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      nativeInputSetter?.call(firstLaneInput, 'Sehr Hoch');
      firstLaneInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const afterLaneInput = container.querySelectorAll('.swimlane-name-input')[0] as HTMLInputElement;
    expect(afterLaneInput).toBe(firstLaneInput);
    expect(afterLaneInput.value).toBe('Sehr Hoch');

    // Submit modal
    const submitBtn = container.querySelector('.base-board-config-modal .primary-btn') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(handleSave).toHaveBeenCalledWith(
      { property: 'status', columns: ['Open', 'inWork'] },
      10,
      {
        property: 'prio',
        lanes: [
          { name: 'Sehr Hoch', collapsed: false },
          { name: 'Mittel', collapsed: false },
        ],
      }
    );
  });

  it('allows selecting and reordering card content properties (view.order) in BaseBoardConfigModal and renders them on BaseBoardCard', async () => {
    const viewConfig = {
      type: 'board' as const,
      name: 'Aufgaben-Board',
      groupBy: { property: 'status', columns: ['Offen', 'In Arbeit', 'Erledigt'] },
      columnLimit: 10,
      order: ['file.name', 'priority'],
    };
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    const matchingNotes = [
      {
        path: 'Tasks/A.md',
        name: 'A.md',
        tags: ['urgent'],
        properties: [
          { key: 'status', value: 'Offen' },
          { key: 'priority', value: 'Hoch' },
          { key: 'deadline', value: '2026-11-01' },
        ],
      },
    ];

    // First render with isOpen=false, then transition to isOpen=true (verifies consistent hook order across renders)
    await act(async () => {
      root.render(
        <BaseBoardConfigModal
          isOpen={false}
          onClose={handleClose}
          view={viewConfig}
          availableProperties={[
            { key: 'status', label: 'Status' },
            { key: 'priority', label: 'Priority' },
          ]}
          allNotes={matchingNotes}
          onSave={handleSave}
        />
      );
    });

    await act(async () => {
      root.render(
        <BaseBoardConfigModal
          isOpen={true}
          onClose={handleClose}
          view={viewConfig}
          availableProperties={[
            { key: 'status', label: 'Status' },
            { key: 'priority', label: 'Priority' },
          ]}
          allNotes={matchingNotes}
          onSave={handleSave}
        />
      );
    });

    // Verify Card Properties section is rendered
    const cardPropsSection = container.querySelector('.base-board-card-properties-section');
    expect(cardPropsSection).toBeTruthy();

    // Detected properties from matchingNotes should include 'deadline' and 'tags'
    const deadlineCheckbox = container.querySelector(
      '.card-prop-checkbox[data-prop-key="deadline"]'
    ) as HTMLButtonElement;
    const tagsCheckbox = container.querySelector(
      '.card-prop-checkbox[data-prop-key="tags"]'
    ) as HTMLButtonElement;
    expect(deadlineCheckbox).toBeTruthy();
    expect(tagsCheckbox).toBeTruthy();

    // Toggle 'tags' and 'deadline' on
    await act(async () => {
      tagsCheckbox.click();
    });
    await act(async () => {
      deadlineCheckbox.click();
    });

    // Currently selected order is ['priority', 'tags', 'deadline']. Move 'tags' up before 'priority'
    const tagsRow = container.querySelector('.base-card-prop-config-item[data-prop-key="tags"]') as HTMLElement;
    expect(tagsRow).toBeTruthy();
    const moveUpBtn = tagsRow.querySelector('.card-prop-move-up') as HTMLButtonElement;
    expect(moveUpBtn).toBeTruthy();
    await act(async () => {
      moveUpBtn.click();
    });

    // Save modal
    const submitBtn = container.querySelector('.base-board-config-modal .primary-btn') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(handleSave).toHaveBeenCalledWith(
      { property: 'status', columns: ['Offen', 'In Arbeit', 'Erledigt'] },
      10,
      undefined,
      ['file.name', 'tags', 'priority', 'deadline']
    );

    // Verify BaseBoardView renders the properties listed in view.order on BaseBoardCard
    const updatedViewConfig = {
      ...viewConfig,
      order: ['file.name', 'tags', 'priority', 'deadline'],
    };
    const record = createMockRecord(
      'Tasks/A.md',
      'A.md',
      'Tasks',
      ['urgent'],
      { status: 'Offen', priority: 'Hoch', deadline: '2026-11-01' },
      1000
    );
    const mockQueryResult: BaseQueryResult = {
      definition: { views: [updatedViewConfig] },
      view: updatedViewConfig,
      columns: ['file.name', 'tags', 'priority', 'deadline'],
      columnDisplayNames: { priority: 'Priorität', deadline: 'Frist' },
      records: [record],
      groups: [],
      totalCount: 1,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={updatedViewConfig}
          onSelectNote={vi.fn()}
        />
      );
    });

    const card = container.querySelector('.base-board-card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('#urgent');
    expect(card.textContent).toContain('Priorität:');
    expect(card.textContent).toContain('Hoch');
    expect(card.textContent).toContain('Frist:');
    expect(card.textContent).toContain('2026-11-01');
  });

  it('renders sort icon button directly to the left of the + button in both 1D and 2D Kanban views', async () => {
    const records = [
      createMockRecord('Tasks/A.md', 'Task A', 'Tasks', [], { status: 'Open', prio: 'Prio 1' }, 1000),
      createMockRecord('Tasks/B.md', 'Task B', 'Tasks', [], { status: 'inWork', prio: 'Prio 1' }, 2000),
    ];

    // 1. 1D Board View
    const view1D = {
      type: 'board' as const,
      name: '1D Board',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork'],
      },
      columnLimit: 10,
    };
    const mockQueryResult1D: BaseQueryResult = {
      definition: { views: [view1D] },
      view: view1D,
      columns: ['file.name'],
      columnDisplayNames: {},
      records,
      groups: [],
      totalCount: 2,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult1D}
          view={view1D}
          onSelectNote={vi.fn()}
        />
      );
    });

    const col1D = container.querySelector('.base-board-column') as HTMLElement;
    expect(col1D).toBeTruthy();

    const sortBtn1D = col1D.querySelector('.base-board-col-sort-btn') as HTMLButtonElement;
    const addBtn1D = col1D.querySelector('.base-board-add-card-btn') as HTMLButtonElement;
    expect(sortBtn1D).toBeTruthy();
    expect(addBtn1D).toBeTruthy();
    // Verify sort button is immediately to the left of the add card button
    expect(sortBtn1D.nextElementSibling).toBe(addBtn1D);

    // 2. 2D Board View
    const view2D = {
      type: 'board' as const,
      name: '2D Board',
      groupBy: {
        property: 'status',
        columns: ['Open', 'inWork'],
      },
      swimlanes: {
        property: 'prio',
        lanes: ['Prio 1'],
      },
      columnLimit: 10,
    };
    const mockQueryResult2D: BaseQueryResult = {
      definition: { views: [view2D] },
      view: view2D,
      columns: ['file.name'],
      columnDisplayNames: {},
      records,
      groups: [],
      totalCount: 2,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult2D}
          view={view2D}
          onSelectNote={vi.fn()}
        />
      );
    });

    const cell2D = container.querySelector('.base-board-swimlane-cell') as HTMLElement;
    expect(cell2D).toBeTruthy();
    const sortBtn2D = cell2D.querySelector('.base-board-col-sort-btn') as HTMLButtonElement;
    const addBtn2D = cell2D.querySelector('.base-board-add-card-btn') as HTMLButtonElement;
    expect(sortBtn2D).toBeTruthy();
    expect(addBtn2D).toBeTruthy();
    expect(sortBtn2D.nextElementSibling).toBe(addBtn2D);
  });

  it('opens sort popover, sorts column cards dynamically by name, ctime and custom property, and persists configuration', async () => {
    const handleUpdateConfig = vi.fn();
    const records = [
      createMockRecord('Tasks/Beta.md', 'Beta', 'Tasks', [], { status: 'Open', priority: 1 }, 1000, 200),
      createMockRecord('Tasks/Alpha.md', 'Alpha', 'Tasks', [], { status: 'Open', priority: 5 }, 2000, 100),
      createMockRecord('Tasks/Gamma.md', 'Gamma', 'Tasks', [], { status: 'Open', priority: 3 }, 3000, 300),
    ];

    const viewConfig = {
      type: 'board' as const,
      name: 'Kanban',
      groupBy: {
        property: 'status',
        columns: ['Open'],
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
      totalCount: 3,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={viewConfig}
          onSelectNote={vi.fn()}
          onUpdateConfig={handleUpdateConfig}
        />
      );
    });

    // Initial order without sort rule (Beta, Alpha, Gamma)
    let cardTitles = Array.from(container.querySelectorAll('.base-card-title')).map((el) => el.textContent);
    expect(cardTitles).toEqual(['Beta', 'Alpha', 'Gamma']);

    // 1. Click Sort button
    const sortBtn = container.querySelector('.base-board-col-sort-btn') as HTMLButtonElement;
    expect(sortBtn).toBeTruthy();

    await act(async () => {
      sortBtn.click();
    });

    // Popover is rendered in document.body
    const popover = document.body.querySelector('.base-board-sort-popover') as HTMLDivElement;
    expect(popover).toBeTruthy();

    // Verify properties dropdown contains Name, Erstelldatum, and card property priority
    const select = popover.querySelector('.base-board-sort-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('file.name');
    expect(optionValues).toContain('file.ctime');
    expect(optionValues).toContain('priority');

    // 2. Select file.name ascending
    await act(async () => {
      select.value = 'file.name';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Verify cards are sorted Alpha, Beta, Gamma
    cardTitles = Array.from(container.querySelectorAll('.base-card-title')).map((el) => el.textContent);
    expect(cardTitles).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Verify onUpdateConfig called with sort rule in groupBy.columns
    expect(handleUpdateConfig).toHaveBeenCalled();
    const lastConfigCall = handleUpdateConfig.mock.calls[handleUpdateConfig.mock.calls.length - 1][0];
    expect(lastConfigCall.groupBy.columns[0]).toEqual({
      name: 'Open',
      sort: { property: 'file.name', direction: 'asc' },
    });

    // 3. Switch direction to descending
    const descBtn = popover.querySelector('.board-sort-dir-desc') as HTMLButtonElement;
    expect(descBtn).toBeTruthy();
    await act(async () => {
      descBtn.click();
    });

    // Verify cards are sorted Gamma, Beta, Alpha
    cardTitles = Array.from(container.querySelectorAll('.base-card-title')).map((el) => el.textContent);
    expect(cardTitles).toEqual(['Gamma', 'Beta', 'Alpha']);

    // 4. Sort by custom property 'priority' (5: Alpha, 3: Gamma, 1: Beta)
    await act(async () => {
      select.value = 'priority';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Priority descending: Alpha (5), Gamma (3), Beta (1)
    cardTitles = Array.from(container.querySelectorAll('.base-card-title')).map((el) => el.textContent);
    expect(cardTitles).toEqual(['Alpha', 'Gamma', 'Beta']);

    // 5. Reset to default sorting
    const resetBtn = popover.querySelector('.base-board-sort-reset-btn') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    await act(async () => {
      resetBtn.click();
    });

    // Popover closed
    expect(document.body.querySelector('.base-board-sort-popover')).toBeNull();

    // Default sorting restored (initial order: Beta, Alpha, Gamma)
    cardTitles = Array.from(container.querySelectorAll('.base-card-title')).map((el) => el.textContent);
    expect(cardTitles).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('formats created and file.ctime timestamps into YYYY-MM-DD HH:mm on BaseBoardCard', async () => {
    const fixedTime = new Date(2026, 9, 28, 14, 35).getTime(); // 2026-10-28 14:35
    const view: BaseViewConfig = {
      type: 'board',
      name: 'Kanban',
      order: ['file.name', 'created', 'file.ctime'],
      groupBy: {
        property: 'status',
        columns: ['Open'],
      },
    };

    const mockQueryResult: BaseQueryResult = {
      definition: { views: [view] } as any,
      view: view as any,
      columns: ['file.name', 'created', 'file.ctime'],
      columnDisplayNames: {
        'file.name': 'Name',
        created: 'Erstelldatum',
        'file.ctime': 'Erstellzeit',
      },
      records: [
        {
          file: {
            path: 'Notes/TestNote.md',
            name: 'TestNote',
            folder: 'Notes',
            ext: 'md',
            ctime: fixedTime,
            mtime: fixedTime,
            inFolder: () => false,
            hasTag: () => false,
            hasLink: () => false,
          },
          properties: {
            status: 'Open',
            created: fixedTime,
          },
          formulas: {},
          tags: [],
          links: [],
        },
      ],
      groups: [],
      totalCount: 1,
    };

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={view}
          onSelectNote={() => {}}
        />
      );
    });

    // Verify properties on card are formatted into YYYY-MM-DD HH:mm
    const propRows = container.querySelectorAll('.base-card-prop-row');
    expect(propRows.length).toBeGreaterThanOrEqual(1);

    const propVals = Array.from(propRows).map((el) => el.querySelector('.base-prop-val')?.textContent);
    expect(propVals).toContain('2026-10-28 14:35');
  });

  it('renders compact sort direction buttons with (A-Z) and (Z-A) and withstands rapid toggling without error #310', async () => {
    let curView: BaseViewConfig = {
      type: 'board',
      name: 'Board',
      order: ['file.name'],
      groupBy: { property: 'status', columns: ['Open'] },
    };

    const mockQueryResult: BaseQueryResult = {
      definition: { views: [curView] } as any,
      view: curView as any,
      columns: ['file.name', 'status'],
      columnDisplayNames: { 'file.name': 'Name', status: 'Status' },
      records: [
        {
          file: {
            path: 'A.md',
            name: 'Alpha',
            folder: '',
            ext: 'md',
            mtime: 100,
            ctime: 100,
            inFolder: () => false,
            hasTag: () => false,
            hasLink: () => false,
          },
          properties: { status: 'Open' },
          formulas: {},
          tags: [],
          links: [],
        },
        {
          file: {
            path: 'B.md',
            name: 'Beta',
            folder: '',
            ext: 'md',
            mtime: 200,
            ctime: 200,
            inFolder: () => false,
            hasTag: () => false,
            hasLink: () => false,
          },
          properties: { status: 'Open' },
          formulas: {},
          tags: [],
          links: [],
        },
      ],
      groups: [],
      totalCount: 2,
    };

    const handleUpdate = vi.fn((newView) => {
      curView = newView;
    });

    await act(async () => {
      root.render(
        <BaseBoardView
          queryResult={mockQueryResult}
          view={curView}
          onSelectNote={() => {}}
          onUpdateConfig={handleUpdate}
        />
      );
    });

    const sortBtn = container.querySelector('.base-board-col-sort-btn') as HTMLButtonElement;
    expect(sortBtn).toBeTruthy();

    await act(async () => {
      sortBtn.click();
    });

    const popover = document.body.querySelector('.base-board-sort-popover') as HTMLElement;
    expect(popover).toBeTruthy();

    const ascBtn = popover.querySelector('.board-sort-dir-asc') as HTMLButtonElement;
    const descBtn = popover.querySelector('.board-sort-dir-desc') as HTMLButtonElement;
    expect(ascBtn).toBeTruthy();
    expect(descBtn).toBeTruthy();

    // Verify compact labels: no words "Ascending" or "Descending", contains "(A-Z)" and "(Z-A)"
    expect(ascBtn.textContent).toContain('(A-Z)');
    expect(ascBtn.textContent).not.toContain('Ascending');
    expect(ascBtn.textContent).not.toContain('Aufsteigend');

    expect(descBtn.textContent).toContain('(Z-A)');
    expect(descBtn.textContent).not.toContain('Descending');
    expect(descBtn.textContent).not.toContain('Absteigend');

    // Rapidly toggle back and forth 10 times to verify no React Error #310 occurs
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        descBtn.click();
      });
      await act(async () => {
        root.render(
          <BaseBoardView
            queryResult={mockQueryResult}
            view={curView}
            onSelectNote={() => {}}
            onUpdateConfig={handleUpdate}
          />
        );
      });

      await act(async () => {
        ascBtn.click();
      });
      await act(async () => {
        root.render(
          <BaseBoardView
            queryResult={mockQueryResult}
            view={curView}
            onSelectNote={() => {}}
            onUpdateConfig={handleUpdate}
          />
        );
      });
    }

    expect(popover.isConnected).toBe(true);
  });
});
