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
});
