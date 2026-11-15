// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseMarkdownTable,
  serializeMarkdownTable,
  insertTableRowAt,
  deleteTableRowAt,
  insertTableColumnAt,
  deleteTableColumnAt,
  setTableColumnAlignment,
  sortMarkdownTable,
  getTableHeaderSignature,
  setTableWidthsInProperties,
  renameTableWidthSignature,
  pruneOrphanedTableWidths,
  getTableWidthsFromProperties,
} from '../shared/markdownTableUtils';
import {
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import { PropertiesEditor } from './components/PropertiesEditor';
import { LivePreviewEditor } from './components/LivePreviewEditor';
import { I18nProvider } from './i18n';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Markdown Table Parsing, Manipulation & Serialization', () => {
  it('parses and serializes GFM tables with clean padding and alignments', () => {
    const raw = [
      '| Name | Count | Status |',
      '| :--- | :---: | ---: |',
      '| Alpha | 10 | OK |',
      '| Beta | 2 | Pending |',
    ];
    const parsed = parseMarkdownTable(raw);
    expect(parsed.headers).toEqual(['Name', 'Count', 'Status']);
    expect(parsed.alignments).toEqual(['left', 'center', 'right']);
    expect(parsed.rows).toEqual([
      ['Alpha', '10', 'OK'],
      ['Beta', '2', 'Pending'],
    ]);

    const serialized = serializeMarkdownTable(parsed);
    expect(serialized).toBe(
      [
        '| Name  | Count | Status  |',
        '| :---- | :---: | ------: |',
        '| Alpha | 10    | OK      |',
        '| Beta  | 2     | Pending |',
      ].join('\n')
    );
  });

  it('inserts/deletes rows and columns and updates column alignment', () => {
    let table = parseMarkdownTable([
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ]);

    table = insertTableRowAt(table, 1);
    expect(table.rows).toEqual([
      ['1', '2'],
      ['', ''],
    ]);

    table = insertTableColumnAt(table, 1, 'Mid');
    expect(table.headers).toEqual(['A', 'Mid', 'B']);
    expect(table.rows[0]).toEqual(['1', '', '2']);

    table = setTableColumnAlignment(table, 1, 'center');
    expect(table.alignments).toEqual(['left', 'center', 'left']);

    table = deleteTableRowAt(table, 0);
    expect(table.rows).toEqual([['', '', '']]);

    table = deleteTableColumnAt(table, 1);
    expect(table.headers).toEqual(['A', 'B']);
  });
});

describe('Smart Natural, Numeric & Date Column Sorting', () => {
  it('sorts numbers, currencies, ISO dates, and keeps empty cells at the bottom', () => {
    const numTable = parseMarkdownTable([
      '| Item | Price |',
      '| :--- | ---: |',
      '| Item 10 | $1,200.00 |',
      '| Item 2 | € 42,50 |',
      '| Empty | |',
      '| Item 1 | -15.5 |',
    ]);

    const ascNum = sortMarkdownTable(numTable, 1, 'asc');
    expect(ascNum.rows.map((r) => r[0])).toEqual(['Item 1', 'Item 2', 'Item 10', 'Empty']);

    const descNum = sortMarkdownTable(numTable, 1, 'desc');
    expect(descNum.rows.map((r) => r[0])).toEqual(['Item 10', 'Item 2', 'Item 1', 'Empty']);

    const naturalAsc = sortMarkdownTable(numTable, 0, 'asc');
    expect(naturalAsc.rows.map((r) => r[0])).toEqual(['Empty', 'Item 1', 'Item 2', 'Item 10']);

    const dateTable = parseMarkdownTable([
      '| Event | Date |',
      '| :--- | :--- |',
      '| B | 2025-12-01 |',
      '| None | |',
      '| A | 2024-06-15 |',
      '| C | 2025-01-05 |',
    ]);
    const dateAsc = sortMarkdownTable(dateTable, 1, 'asc');
    expect(dateAsc.rows.map((r) => r[0])).toEqual(['A', 'C', 'B', 'None']);
  });
});

describe('_tableWidths YAML Persistence, Migration, Orphan Cleanup & PropertiesEditor', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('roundtrips _tableWidths through YAML frontmatter, migrates renamed headers, and prunes orphans', () => {
    const body = [
      '| Device | IP | Status |',
      '| :--- | :--- | :--- |',
      '| NAS | 10.0.0.2 | Up |',
    ].join('\n');

    const sig = getTableHeaderSignature(['Device', 'IP', 'Status']);
    expect(sig).toBe('Device | IP | Status');

    let props = setTableWidthsInProperties([], sig, [180, 140, 120], body);
    const md = serializeMarkdownWithFrontmatter(props, body);
    expect(md).toContain('_tableWidths:');
    expect(md).toContain('Device | IP | Status');

    const reparsed = parseMarkdownWithFrontmatter(md);
    expect(getTableWidthsFromProperties(reparsed.properties)).toEqual({
      'Device | IP | Status': [180, 140, 120],
    });

    // Header rename migration
    const renamedBody = body.replace('| Device | IP | Status |', '| Host | IP | Status |');
    props = renameTableWidthSignature(
      reparsed.properties,
      'Device | IP | Status',
      'Host | IP | Status',
      renamedBody
    );
    expect(getTableWidthsFromProperties(props)).toEqual({
      'Host | IP | Status': [180, 140, 120],
    });

    // Orphan cleanup when table is removed
    const pruned = pruneOrphanedTableWidths(props, '# Just a heading\nNo tables here.');
    expect(getTableWidthsFromProperties(pruned)).toEqual({});
    expect(pruned.find((p) => p.key === '_tableWidths')).toBeUndefined();
  });

  it('hides _* keys in PropertiesEditor while preserving them on property updates', async () => {
    const onChange = vi.fn();
    const initialProps = [
      { key: 'title', type: 'text' as const, value: 'Network Inventory' },
      {
        key: '_tableWidths',
        type: 'object' as const,
        value: { 'Device | IP': [200, 150] },
      },
    ];

    await act(async () => {
      root.render(
        <I18nProvider>
          <PropertiesEditor
            properties={initialProps}
            allTags={[]}
            notePath="net.md"
            onChange={onChange}
          />
        </I18nProvider>
      );
    });

    // Badge count should be 1 (not 2)
    const badge = container.querySelector('.properties-count-badge');
    expect(badge?.textContent).toBe('1');

    // Expand properties panel
    const toggleBtn = container.querySelector('.properties-toggle-btn') as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
    });

    expect(container.textContent).not.toContain('_tableWidths');
    const keyInputs = Array.from(container.querySelectorAll('.property-key-input')) as HTMLInputElement[];
    expect(keyInputs.map((i) => i.value)).toEqual(['title']);

    // Adding a new property must preserve _tableWidths
    const addBtn = container.querySelector('.properties-add-inline-btn') as HTMLButtonElement;
    await act(async () => {
      addBtn.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedProps = onChange.mock.calls[0][0];
    expect(updatedProps.some((p: any) => p.key === '_tableWidths')).toBe(true);
  });
});

describe('LivePreviewEditor Visual In-Place Table Editing & Sorting', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps TableWidget rendered on click, appends row on Enter/Tab, and sorts physically', async () => {
    const initialBody = [
      '| Name | Score |',
      '| :--- | ---: |',
      '| Zebra | 2 |',
      '| Alpha | 10 |',
    ].join('\n');

    const onChangeBody = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider>
          <LivePreviewEditor
            notePath="table.md"
            body={initialBody}
            rawContent={initialBody}
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

    // TableWidget should be rendered
    const tableWidget = container.querySelector('.cm-lp-table-widget');
    expect(tableWidget).toBeTruthy();

    // Click last body row cell (row 1, col 0 -> "Alpha")
    const alphaTd = container.querySelector('td[data-row="1"][data-col="0"]') as HTMLElement;
    const alphaCell = alphaTd.querySelector('.cm-table-cell-content') as HTMLElement;
    expect(alphaCell).toBeTruthy();

    await act(async () => {
      alphaTd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });

    // TableWidget stays rendered (no fallback to raw pipes) and cell becomes contentEditable
    expect(container.querySelector('.cm-lp-table-widget')).toBeTruthy();
    expect(alphaCell.contentEditable).toBe('true');

    // Edit text and press Enter in last row -> should commit & append a new empty row
    alphaCell.textContent = 'Beta';
    await act(async () => {
      alphaCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(onChangeBody).toHaveBeenCalled();
    const afterEnterBody = onChangeBody.mock.calls[onChangeBody.mock.calls.length - 1][0] as string;
    expect(afterEnterBody).toContain('Beta');
    // 2 header/sep lines + 3 body rows = 5 lines
    expect(afterEnterBody.trim().split('\n').length).toBe(5);

    // Click sort button on Name column (col 0) -> should sort Beta, Zebra, empty
    const sortBtn = container.querySelector('th[data-col="0"] .cm-table-sort-btn') as HTMLButtonElement;
    expect(sortBtn).toBeTruthy();
    await act(async () => {
      sortBtn.click();
    });

    const afterSortBody = onChangeBody.mock.calls[onChangeBody.mock.calls.length - 1][0] as string;
    const lines = afterSortBody.trim().split('\n');
    expect(lines[2]).toContain('Beta');
    expect(lines[3]).toContain('Zebra');
  });
});
