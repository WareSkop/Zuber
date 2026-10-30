import { describe, it, expect } from 'vitest';
import {
  parseBaseYaml,
  stringifyBaseYaml,
  ruleToExpression,
  expressionToRule,
  extractFilterRules,
  rulesToFiltersObject,
  extractVaultProperties,
  extractVaultFolders,
  extractVaultTags,
  type BaseConfig,
  type BaseFilterRule,
} from './base/baseConfig';

describe('Base Config & YAML Synchronization (src/base/baseConfig.ts)', () => {
  const sampleYaml = `
filters:
  and:
    - "file.inFolder('Projekte/IT')"
    - "status == 'aktiv'"
    - "priority >= 5"
formulas:
  daysLeft: "round((date(deadline) - today()) / '1 day')"
properties:
  file.name:
    displayName: "Projektname"
  status:
    displayName: "Status"
views:
  - type: table
    name: "Alle Projekte"
    order:
      - file.name
      - status
      - priority
    columnSize:
      file.name: 240
      status: 120
    sort:
      - property: priority
        direction: desc
    groupBy:
      property: status
      direction: asc
`;

  it('parses valid YAML base config into typed object', () => {
    const config = parseBaseYaml(sampleYaml);

    expect(config.views).toHaveLength(1);
    expect(config.views[0].name).toBe('Alle Projekte');
    expect(config.views[0].type).toBe('table');
    expect(config.views[0].order).toEqual(['file.name', 'status', 'priority']);
    expect(config.views[0].columnSize).toEqual({ 'file.name': 240, status: 120 });
    expect(config.views[0].sort).toEqual([{ property: 'priority', direction: 'desc' }]);
    expect(config.views[0].groupBy).toEqual({ property: 'status', direction: 'asc' });

    // Properties
    expect(config.properties?.['file.name']?.displayName).toBe('Projektname');

    // Custom formulas preserved
    expect(config.formulas?.daysLeft).toBe("round((date(deadline) - today()) / '1 day')");
  });

  it('converts rules to Obsidian expressions and vice-versa', () => {
    // 1. file.inFolder
    const folderRule: BaseFilterRule = {
      id: '1',
      field: 'file.inFolder',
      operator: '==',
      value: 'Ablage/Wohnung/IT',
    };
    expect(ruleToExpression(folderRule)).toBe('file.inFolder("Ablage/Wohnung/IT")');
    expect(expressionToRule('file.inFolder("Ablage/Wohnung/IT")')).toMatchObject({
      field: 'file.inFolder',
      operator: '==',
      value: 'Ablage/Wohnung/IT',
    });

    // 2. file.hasTag
    const tagRule: BaseFilterRule = {
      id: '2',
      field: 'file.hasTag',
      operator: '==',
      value: 'server',
    };
    expect(ruleToExpression(tagRule)).toBe('file.hasTag("server")');
    expect(expressionToRule('file.hasTag("server")')).toMatchObject({
      field: 'file.hasTag',
      operator: '==',
      value: 'server',
    });

    // 2b. file.hasLink
    const linkRule: BaseFilterRule = {
      id: '2b',
      field: 'file.hasLink',
      operator: '==',
      value: 'Zielnotiz',
    };
    expect(ruleToExpression(linkRule)).toBe('file.hasLink("Zielnotiz")');
    expect(expressionToRule('file.hasLink("Zielnotiz")')).toMatchObject({
      field: 'file.hasLink',
      operator: '==',
      value: 'Zielnotiz',
    });
    expect(ruleToExpression({ ...linkRule, operator: '!=' })).toBe('!file.hasLink("Zielnotiz")');
    expect(expressionToRule('!file.hasLink("Zielnotiz")')).toMatchObject({
      field: 'file.hasLink',
      operator: '!=',
      value: 'Zielnotiz',
    });

    // 3. isEmpty & !isEmpty
    const emptyRule: BaseFilterRule = {
      id: '3',
      field: 'IP',
      operator: 'isEmpty',
      value: '',
    };
    expect(ruleToExpression(emptyRule)).toBe('IP == null || IP == ""');
    expect(expressionToRule('IP == null || IP == ""')).toMatchObject({
      field: 'IP',
      operator: 'isEmpty',
    });

    const notEmptyRule: BaseFilterRule = {
      id: '4',
      field: 'IP',
      operator: '!isEmpty',
      value: '',
    };
    expect(ruleToExpression(notEmptyRule)).toBe('IP != null && IP != ""');
    expect(expressionToRule('IP != null && IP != ""')).toMatchObject({
      field: 'IP',
      operator: '!isEmpty',
    });

    // 4. contains & startsWith
    const containsRule: BaseFilterRule = {
      id: '5',
      field: 'title',
      operator: 'contains',
      value: 'Backup',
    };
    expect(ruleToExpression(containsRule)).toBe('title.contains("Backup")');
    expect(expressionToRule('title.contains("Backup")')).toMatchObject({
      field: 'title',
      operator: 'contains',
      value: 'Backup',
    });

    // 5. numeric & comparison
    const numRule: BaseFilterRule = {
      id: '6',
      field: 'priority',
      operator: '>=',
      value: 5,
    };
    expect(ruleToExpression(numRule)).toBe('priority >= 5');
    expect(expressionToRule('priority >= 5')).toMatchObject({
      field: 'priority',
      operator: '>=',
      value: 5,
    });
  });

  it('extracts filter rules from config filters and serializes them back', () => {
    const config = parseBaseYaml(sampleYaml);
    const rules = extractFilterRules(config.filters);

    expect(rules).toHaveLength(3);
    expect(rules[0].field).toBe('file.inFolder');
    expect(rules[0].value).toBe('Projekte/IT');
    expect(rules[1].field).toBe('status');
    expect(rules[1].value).toBe('aktiv');
    expect(rules[2].field).toBe('priority');
    expect(rules[2].operator).toBe('>=');
    expect(rules[2].value).toBe(5);

    // Modify: Add a new rule
    rules.push({
      id: 'rule-new',
      field: 'file.hasTag',
      operator: '==',
      value: 'wichtig',
    });

    const newFilters = rulesToFiltersObject(rules);
    expect(newFilters?.and).toHaveLength(4);
    expect(newFilters?.and).toContain('file.hasTag("wichtig")');

    // Update config and stringify
    config.filters = newFilters;
    const reStringified = stringifyBaseYaml(config);
    expect(reStringified).toContain('file.hasTag("wichtig")');

    // Re-parse to verify round-trip integrity
    const reParsed = parseBaseYaml(reStringified);
    expect(reParsed.filters?.and).toHaveLength(4);
  });

  it('updates column widths and reorders columns cleanly', () => {
    const config = parseBaseYaml(sampleYaml);
    const view = config.views[0];

    // Resize a column
    view.columnSize = {
      ...view.columnSize,
      'file.name': 350,
      ip: 160,
    };

    // Reorder columns
    view.order = ['file.name', 'priority', 'status', 'ip'];

    const yaml = stringifyBaseYaml(config);
    expect(yaml).toContain('file.name: 350');
    expect(yaml).toContain('ip: 160');

    const reParsed = parseBaseYaml(yaml);
    expect(reParsed.views[0].columnSize?.['file.name']).toBe(350);
    expect(reParsed.views[0].columnSize?.ip).toBe(160);
    expect(reParsed.views[0].order).toEqual(['file.name', 'priority', 'status', 'ip']);
  });

  it('preserves unknown custom YAML properties', () => {
    const customYaml = `
customKey: "SecretValue"
formulas:
  calc: "2 + 2"
views:
  - type: table
    name: "Custom View"
    customViewFlag: true
`;
    const config = parseBaseYaml(customYaml);
    expect(config.customKey).toBe('SecretValue');
    expect(config.views[0].customViewFlag).toBe(true);

    const reYaml = stringifyBaseYaml(config);
    expect(reYaml).toContain('customKey: SecretValue');
    expect(reYaml).toContain('customViewFlag: true');
  });

  it('extracts vault properties, folders, and tags accurately', () => {
    const notes = [
      {
        path: 'IT/Servers/Web01.md',
        tags: ['linux', 'production'],
        properties: [
          { key: 'IP', value: '192.168.1.10' },
          { key: 'status', value: 'online' },
        ],
      },
      {
        path: 'IT/Servers/DB01.md',
        tags: ['linux', 'database'],
        frontmatter: {
          IP: '192.168.1.20',
          role: 'postgres',
        },
      },
      {
        path: 'Personal/Todo.md',
        tags: ['personal'],
        properties: [],
      },
    ];

    const properties = extractVaultProperties(notes);
    expect(properties.map((p) => p.key)).toContain('IP');
    expect(properties.map((p) => p.key)).toContain('status');
    expect(properties.map((p) => p.key)).toContain('role');

    const folders = extractVaultFolders(notes);
    expect(folders).toContain('IT/Servers');
    expect(folders).toContain('Personal');

    const tags = extractVaultTags(notes);
    expect(tags).toContain('linux');
    expect(tags).toContain('production');
    expect(tags).toContain('database');
    expect(tags).toContain('personal');
  });

  it('parses and serializes board swimlanes config including collapsed state and removal when disabled', () => {
    const boardSwimlanesYaml = `
views:
  - type: board
    name: Aufgaben
    groupBy:
      property: status
      columns:
        - Open
        - inWork
        - Waiting
        - Finish
    swimlanes:
      property: prio
      lanes:
        - name: Prio 1
          collapsed: false
        - name: Prio 2
          collapsed: true
      unassignedCollapsed: true
`;

    const config = parseBaseYaml(boardSwimlanesYaml);
    expect(config.views).toHaveLength(1);
    const view = config.views[0];
    expect(view.type).toBe('board');
    expect(view.swimlanes).toBeDefined();
    expect(view.swimlanes?.property).toBe('prio');
    expect(view.swimlanes?.unassignedCollapsed).toBe(true);
    expect(view.swimlanes?.lanes).toEqual([
      { name: 'Prio 1', collapsed: false },
      { name: 'Prio 2', collapsed: true },
    ]);

    const serialized = stringifyBaseYaml(config);
    expect(serialized).toContain('swimlanes:');
    expect(serialized).toContain('property: prio');
    expect(serialized).toContain('name: Prio 1');
    expect(serialized).toContain('collapsed: false');
    expect(serialized).toContain('name: Prio 2');
    expect(serialized).toContain('collapsed: true');
    expect(serialized).toContain('unassignedCollapsed: true');

    // Also supports plain string lanes when parsing
    const plainLanesYaml = `
views:
  - type: board
    name: Sprint
    swimlanes:
      property: prio
      lanes:
        - Prio 1
        - name: Prio 2
          collapsed: true
`;
    const parsedPlain = parseBaseYaml(plainLanesYaml);
    expect(parsedPlain.views[0].swimlanes?.lanes).toEqual([
      'Prio 1',
      { name: 'Prio 2', collapsed: true },
    ]);

    // When swimlanes are disabled (undefined or empty property), swimlanes block is cleanly omitted
    delete parsedPlain.views[0].swimlanes;
    const serializedWithoutSwimlanes = stringifyBaseYaml(parsedPlain);
    expect(serializedWithoutSwimlanes).not.toContain('swimlanes:');
  });

  it('parses and serializes view-level boardSort and per-column sort configurations in YAML', () => {
    const yaml = `
views:
  - type: board
    name: Kanban
    boardSort:
      property: file.name
      direction: asc
    groupBy:
      property: status
      columns:
        - name: Open
          sort:
            property: priority
            direction: desc
        - name: In Progress
          limit: 15
          color: "#3b82f6"
          sort:
            property: file.ctime
            direction: asc
        - Done
`;

    const config = parseBaseYaml(yaml);
    const view = config.views[0];
    expect(view.boardSort).toEqual({ property: 'file.name', direction: 'asc' });
    expect(view.groupBy?.columns).toHaveLength(3);

    const openCol = view.groupBy?.columns?.[0] as any;
    expect(openCol.name).toBe('Open');
    expect(openCol.sort).toEqual({ property: 'priority', direction: 'desc' });

    const inProgressCol = view.groupBy?.columns?.[1] as any;
    expect(inProgressCol.name).toBe('In Progress');
    expect(inProgressCol.limit).toBe(15);
    expect(inProgressCol.color).toBe('#3b82f6');
    expect(inProgressCol.sort).toEqual({ property: 'file.ctime', direction: 'asc' });

    const doneCol = view.groupBy?.columns?.[2];
    expect(doneCol).toBe('Done');

    // Round-trip serialization
    const serialized = stringifyBaseYaml(config);
    expect(serialized).toContain('boardSort:');
    expect(serialized).toContain('property: file.name');
    expect(serialized).toContain('name: Open');
    expect(serialized).toContain('property: priority');
    expect(serialized).toContain('direction: desc');

    const reparsed = parseBaseYaml(serialized);
    expect(reparsed.views[0].boardSort).toEqual({ property: 'file.name', direction: 'asc' });
    expect((reparsed.views[0].groupBy?.columns?.[0] as any).sort).toEqual({
      property: 'priority',
      direction: 'desc',
    });
  });

  it('correctly sorts column notes by name, ctime, and custom frontmatter properties via sortColumnNotes', async () => {
    const { sortColumnNotes } = await import('./base/baseConfig');

    const sampleNotes = [
      {
        path: 'Tasks/Task B.md',
        name: 'Task B',
        folder: 'Tasks',
        frontmatter: { priority: 2, assignee: 'Bob' },
        properties: { priority: 2, assignee: 'Bob' },
        file: { name: 'Task B', path: 'Tasks/Task B.md', folder: 'Tasks', ext: 'md', mtime: 200, ctime: 100 },
        ctime: 100,
        mtime: 200,
      },
      {
        path: 'Tasks/Task A.md',
        name: 'Task A',
        folder: 'Tasks',
        frontmatter: { priority: 5, assignee: 'Alice' },
        properties: { priority: 5, assignee: 'Alice' },
        file: { name: 'Task A', path: 'Tasks/Task A.md', folder: 'Tasks', ext: 'md', mtime: 300, ctime: 300 },
        ctime: 300,
        mtime: 300,
      },
      {
        path: 'Tasks/Task C.md',
        name: 'Task C',
        folder: 'Tasks',
        frontmatter: { priority: 1, assignee: 'Charlie' },
        properties: { priority: 1, assignee: 'Charlie' },
        file: { name: 'Task C', path: 'Tasks/Task C.md', folder: 'Tasks', ext: 'md', mtime: 100, ctime: 200 },
        ctime: 200,
        mtime: 100,
      },
    ];

    // 1. Sort by name ascending
    const sortedByNameAsc = sortColumnNotes(sampleNotes, { property: 'file.name', direction: 'asc' });
    expect(sortedByNameAsc.map((n) => n.name)).toEqual(['Task A', 'Task B', 'Task C']);

    // 2. Sort by name descending
    const sortedByNameDesc = sortColumnNotes(sampleNotes, { property: 'file.name', direction: 'desc' });
    expect(sortedByNameDesc.map((n) => n.name)).toEqual(['Task C', 'Task B', 'Task A']);

    // 3. Sort by creation time (ctime) ascending (oldest first: 100, 200, 300)
    const sortedByCtimeAsc = sortColumnNotes(sampleNotes, { property: 'file.ctime', direction: 'asc' });
    expect(sortedByCtimeAsc.map((n) => n.name)).toEqual(['Task B', 'Task C', 'Task A']);

    // 4. Sort by creation time (ctime) descending (newest first: 300, 200, 100)
    const sortedByCtimeDesc = sortColumnNotes(sampleNotes, { property: 'file.ctime', direction: 'desc' });
    expect(sortedByCtimeDesc.map((n) => n.name)).toEqual(['Task A', 'Task C', 'Task B']);

    // 5. Sort by custom numeric property (priority) descending (5, 2, 1)
    const sortedByPrioDesc = sortColumnNotes(sampleNotes, { property: 'priority', direction: 'desc' });
    expect(sortedByPrioDesc.map((n) => n.name)).toEqual(['Task A', 'Task B', 'Task C']);

    // 6. Sort by custom string property (assignee) ascending ('Alice', 'Bob', 'Charlie')
    const sortedByAssigneeAsc = sortColumnNotes(sampleNotes, { property: 'assignee', direction: 'asc' });
    expect(sortedByAssigneeAsc.map((n) => n.name)).toEqual(['Task A', 'Task B', 'Task C']);
  });

  it('formats dates and epoch timestamps into YYYY-MM-DD HH:mm via formatDateTime', async () => {
    const { formatDateTime } = await import('./base/baseConfig');
    // Test with epoch ms timestamp (e.g. 1793227980423)
    const fixedDate = new Date(2026, 9, 28, 14, 35); // 2026-10-28 14:35
    expect(formatDateTime(fixedDate.getTime())).toBe('2026-10-28 14:35');

    // Test with Date object
    expect(formatDateTime(fixedDate)).toBe('2026-10-28 14:35');

    // Test with empty/null/invalid
    expect(formatDateTime(0)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('invalid-date')).toBe('invalid-date');
  });
});
