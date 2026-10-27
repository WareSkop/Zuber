/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseCardsView } from './components/base/BaseCardsView';
import { BaseToolbar } from './components/base/BaseToolbar';
import type { BaseConfig } from './base/baseConfig';
import type { BaseQueryResult } from './base/baseEngine';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Base Cards View & View Management', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const createMockRecord = (
    path: string,
    name: string,
    folder: string,
    tags: string[],
    properties: Record<string, any>
  ) => ({
    file: {
      path,
      name,
      folder,
      ext: 'md',
      mtime: Date.now(),
      inFolder: (f: string) => folder.startsWith(f),
      hasTag: (t: string) => tags.includes(t),
      hasLink: () => false,
    },
    tags,
    links: [],
    properties,
    formulas: {},
  });

  const recordAlpha = createMockRecord('Projects/Alpha.md', 'Alpha.md', 'Projects', ['important', 'work'], {
    status: 'In Progress',
    priority: 'High',
  });
  const recordBeta = createMockRecord('Personal/Beta.md', 'Beta.md', 'Personal', ['idea'], {
    status: 'Done',
    priority: 'Low',
  });

  const mockView = {
    type: 'cards' as const,
    name: 'Cards View',
    order: ['file.name', 'tags', 'status', 'priority'],
  };

  const mockQueryResult: BaseQueryResult = {
    definition: { views: [mockView] },
    view: mockView,
    totalCount: 2,
    records: [recordAlpha, recordBeta],
    columns: ['file.name', 'tags', 'status', 'priority'],
    columnDisplayNames: {
      'file.name': 'Dateiname',
      status: 'Status',
      priority: 'Priorität',
    },
    groups: [
      {
        key: 'all',
        label: 'Alle Notizen',
        records: [recordAlpha, recordBeta],
      },
    ],
  };

  it('renders cards with title, folder, tags, and properties', async () => {
    const handleSelectNote = vi.fn();
    await act(async () => {
      root.render(
        <BaseCardsView
          queryResult={mockQueryResult}
          view={mockView}
          onSelectNote={handleSelectNote}
        />
      );
    });

    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('#important');
    expect(container.textContent).toContain('#work');
    expect(container.textContent).toContain('Status:');
    expect(container.textContent).toContain('In Progress');

    expect(container.textContent).toContain('Beta');
    expect(container.textContent).toContain('Personal');
    expect(container.textContent).toContain('#idea');
    expect(container.textContent).toContain('Done');

    // Clicking card opens note
    const alphaTitle = container.querySelector('.base-card-title-link') as HTMLElement;
    expect(alphaTitle).toBeTruthy();
    await act(async () => {
      alphaTitle.click();
    });
    expect(handleSelectNote).toHaveBeenCalledWith('Projects/Alpha.md');
  });

  it('handles "+ Ansicht" popover and creates new cards view', async () => {
    const mockConfig: BaseConfig = {
      views: [{ type: 'table', name: 'Tabelle 1' }],
    };

    const handleAddView = vi.fn();

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
          onSwitchViewType={vi.fn()}
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

    // Click "+ Ansicht" button
    const addBtn = container.querySelector('.base-add-tab-btn') as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn.click();
    });

    // Popover is open
    const input = container.querySelector('.add-view-dropdown input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toMatch(/(Ansicht|View)\s*2/);

    // Select Cards type
    const typeButtons = container.querySelectorAll('.add-view-types .type-btn');
    expect(typeButtons.length).toBe(2);
    await act(async () => {
      (typeButtons[1] as HTMLButtonElement).click();
    });

    // Type custom view name
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(input, 'Projekt-Karten');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Submit form
    const form = container.querySelector('.add-view-dropdown') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(handleAddView).toHaveBeenCalledWith('Projekt-Karten', 'cards');
  });

  it('opens three-dots menu on view tab and switches view type', async () => {
    const mockConfig: BaseConfig = {
      views: [
        { type: 'table', name: 'Table View' },
        { type: 'cards', name: 'Cards View' },
      ],
    };

    const handleSwitchViewType = vi.fn();

    await act(async () => {
      root.render(
        <BaseToolbar
          config={mockConfig}
          activeViewIndex={0}
          onSelectView={vi.fn()}
          onAddView={vi.fn()}
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

    const menuTriggers = container.querySelectorAll('.base-tab-menu-trigger');
    expect(menuTriggers.length).toBe(2);

    // Click menu trigger on first tab (Table View)
    await act(async () => {
      (menuTriggers[0] as HTMLButtonElement).click();
    });

    // Option to switch to cards should be visible
    const dropdownItems = container.querySelectorAll('.tab-dropdown .base-dropdown-item');
    expect(dropdownItems.length).toBeGreaterThan(0);
    const switchToCardsBtn = Array.from(dropdownItems).find((el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('karten') || text.includes('cards');
    }) as HTMLButtonElement;
    expect(switchToCardsBtn).toBeTruthy();

    await act(async () => {
      switchToCardsBtn.click();
    });
    expect(handleSwitchViewType).toHaveBeenCalledWith(0, 'cards');

    // Click menu trigger on second tab (Cards View)
    await act(async () => {
      (menuTriggers[1] as HTMLButtonElement).click();
    });
    const switchToTableBtn = Array.from(container.querySelectorAll('.tab-dropdown .base-dropdown-item')).find((el) => {
      const text = el.textContent?.toLowerCase() || '';
      return text.includes('tabelle') || text.includes('table');
    }) as HTMLButtonElement;
    expect(switchToTableBtn).toBeTruthy();

    await act(async () => {
      switchToTableBtn.click();
    });
    expect(handleSwitchViewType).toHaveBeenCalledWith(1, 'table');
  });

  it('closes dropdown when Escape key is pressed', async () => {
    const mockConfig: BaseConfig = {
      views: [{ type: 'table', name: 'Table' }],
    };

    await act(async () => {
      root.render(
        <BaseToolbar
          config={mockConfig}
          activeViewIndex={0}
          onSelectView={vi.fn()}
          onAddView={vi.fn()}
          onRenameView={vi.fn()}
          onDuplicateView={vi.fn()}
          onDeleteView={vi.fn()}
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

    const menuTrigger = container.querySelector('.base-tab-menu-trigger') as HTMLButtonElement;
    await act(async () => {
      menuTrigger.click();
    });
    expect(container.querySelector('.tab-dropdown')).toBeTruthy();

    // Press Escape
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.tab-dropdown')).toBeNull();
  });
});
