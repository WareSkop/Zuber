import { describe, it, expect } from 'vitest';
import {
  parseBaseYaml,
  createRecordFromNote,
  evaluateFormula,
  evaluateCondition,
  executeBaseQuery,
  getPropertyValue,
  groupBoard2D,
} from './base/baseEngine';
import { refactorBaseContent } from '../shared/markdownUtils';
import type { BaseDefinition } from '../shared/types';

describe('Obsidian Bases Engine (src/base/baseEngine.ts)', () => {
  describe('parseBaseYaml', () => {
    it('parses valid YAML base definitions', () => {
      const yaml = `
filters:
  and:
    - "file.inFolder('Projekte')"
    - "status == 'aktiv'"
formulas:
  daysLeft: "round((date(deadline) - today()) / '1 day')"
properties:
  file.name:
    displayName: "Projektname"
views:
  - type: table
    name: "Alle Projekte"
    order:
      - file.name
      - status
      - daysLeft
    sort:
      - property: daysLeft
        direction: ASC
`;
      const def = parseBaseYaml(yaml);
      expect(def).toBeDefined();
      expect(def.filters).toBeDefined();
      expect(def.formulas?.daysLeft).toBe("round((date(deadline) - today()) / '1 day')");
      expect(def.properties?.['file.name']?.displayName).toBe('Projektname');
      expect(def.views).toHaveLength(1);
      expect(def.views![0].type).toBe('table');
      expect(def.views![0].name).toBe('Alle Projekte');
      expect(def.views![0].order).toEqual(['file.name', 'status', 'daysLeft']);
    });

    it('provides fallback view when yaml is empty', () => {
      const def = parseBaseYaml('');
      expect(def.views).toHaveLength(1);
      expect(def.views![0].type).toBe('table');
    });

    it('throws descriptive error on malformed YAML', () => {
      expect(() => parseBaseYaml('invalid: [broken: yaml')).toThrow(/YAML Parsing Error/);
    });
  });

  describe('createRecordFromNote', () => {
    it('creates a unified BaseRecord from note data', () => {
      const note = {
        path: 'Projekte/Webseite/Relaunch.md',
        name: 'Relaunch.md',
        properties: [
          { key: 'status', value: 'in_progress', type: 'text' as const },
          { key: 'priority', value: 1, type: 'number' as const },
          { key: 'tags', value: ['frontend', 'react'], type: 'list' as const },
        ],
        links: ['Architecture.md'],
        updatedAt: 1700000000,
      };

      const record = createRecordFromNote(note);
      expect(record.file.name).toBe('Relaunch.md');
      expect(record.file.path).toBe('Projekte/Webseite/Relaunch.md');
      expect(record.file.folder).toBe('Projekte/Webseite');
      expect(record.file.ext).toBe('md');
      expect(record.properties.status).toBe('in_progress');
      expect(record.properties.priority).toBe(1);
      expect(record.tags).toEqual(['frontend', 'react']);
      expect(record.links).toContain('Architecture.md');
    });

    it('extracts properties and tags from frontmatter object', () => {
      const note = {
        path: 'Notes/Ideas.md',
        frontmatter: {
          category: 'brainstorming',
          tags: ['idea', 'concept'],
          rating: 5,
        },
      };

      const record = createRecordFromNote(note);
      expect(record.properties.category).toBe('brainstorming');
      expect(record.properties.rating).toBe(5);
      expect(record.tags).toEqual(['idea', 'concept']);
    });
  });

  describe('evaluateCondition', () => {
    const record = createRecordFromNote({
      path: 'Projekte/Task1.md',
      name: 'Task1.md',
      properties: [
        { key: 'status', value: 'done', type: 'text' as const },
        { key: 'score', value: 85, type: 'number' as const },
        { key: 'tags', value: ['urgent', 'bug'], type: 'list' as const },
      ],
      links: ['Roadmap.md'],
    });

    it('evaluates file.inFolder() correctly', () => {
      expect(evaluateCondition('file.inFolder("Projekte")', record)).toBe(true);
      expect(evaluateCondition('file.inFolder("Archiv")', record)).toBe(false);
    });

    it('evaluates file.hasTag() correctly', () => {
      expect(evaluateCondition('file.hasTag("urgent")', record)).toBe(true);
      expect(evaluateCondition('file.hasTag("feature")', record)).toBe(false);
    });

    it('evaluates file.hasLink() correctly', () => {
      expect(evaluateCondition('file.hasLink("Roadmap.md")', record)).toBe(true);
      expect(evaluateCondition('file.hasLink("Backlog.md")', record)).toBe(false);
    });

    it('evaluates string property equality', () => {
      expect(evaluateCondition('status == "done"', record)).toBe(true);
      expect(evaluateCondition('status != "done"', record)).toBe(false);
    });

    it('evaluates numeric comparisons', () => {
      expect(evaluateCondition('score > 80', record)).toBe(true);
      expect(evaluateCondition('score < 50', record)).toBe(false);
      expect(evaluateCondition('score >= 85', record)).toBe(true);
    });

    it('evaluates structured object conditions (and / or / not)', () => {
      expect(
        evaluateCondition(
          {
            and: [
              'status == "done"',
              'score >= 80',
            ],
          },
          record
        )
      ).toBe(true);

      expect(
        evaluateCondition(
          {
            or: [
              'status == "todo"',
              'score >= 80',
            ],
          },
          record
        )
      ).toBe(true);

      expect(
        evaluateCondition(
          {
            not: 'status == "todo"',
          },
          record
        )
      ).toBe(true);
    });
  });

  describe('evaluateFormula', () => {
    const record = createRecordFromNote({
      path: 'Tasks/T1.md',
      properties: [
        { key: 'cost', value: 100, type: 'number' as const },
        { key: 'taxRate', value: 0.19, type: 'number' as const },
        { key: 'deadline', value: '2026-12-31', type: 'date' as const },
      ],
    });

    it('evaluates basic mathematical expressions', () => {
      const res = evaluateFormula('cost * (1 + taxRate)', record);
      expect(res).toBeCloseTo(119, 2);
    });

    it('evaluates round() function', () => {
      const res = evaluateFormula('round(cost * 1.1923)', record);
      expect(res).toBe(119);
    });

    it('blocks access to global scope, constructor, and prototype in formulas and conditions (SEC-02)', () => {
      expect(evaluateFormula('window', record)).toBe('');
      expect(evaluateFormula('globalThis', record)).toBe('');
      expect(evaluateFormula('cost.constructor', record)).toBe('');
      expect(evaluateCondition('window != null', record)).toBe(false);
      expect(evaluateCondition('status.constructor != null', record)).toBe(false);
    });
  });

  describe('file.hasLink filter condition', () => {
    it('matches notes with [[Zielnotiz]], [[Zielnotiz#Header]], and [[Zielnotiz|Alias]]', () => {
      const noteDirect = createRecordFromNote({
        path: 'Notes/One.md',
        links: ['Zielnotiz'],
      });
      const noteAnchor = createRecordFromNote({
        path: 'Notes/Two.md',
        links: ['Zielnotiz#Header'],
      });
      const noteAlias = createRecordFromNote({
        path: 'Notes/Three.md',
        links: ['Zielnotiz|Mein Alias'],
      });
      const noteUnrelated = createRecordFromNote({
        path: 'Notes/Four.md',
        links: ['AndereNotiz'],
      });

      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteDirect)).toBe(true);
      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteAnchor)).toBe(true);
      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteAlias)).toBe(true);
      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteUnrelated)).toBe(false);
    });

    it('matches note paths like [[Ordner/Zielnotiz]] and markdown links [Text](Zielnotiz.md)', () => {
      const notePath = createRecordFromNote({
        path: 'Notes/Five.md',
        links: ['Ordner/Zielnotiz'],
      });
      const noteMarkdown = createRecordFromNote({
        path: 'Notes/Six.md',
        body: 'Hier ist ein [Link](Zielnotiz.md) im Text.',
      });
      const noteMarkdownPath = createRecordFromNote({
        path: 'Notes/Seven.md',
        body: 'Hier ist ein [Link](Ordner/Zielnotiz.md#kapitel) im Text.',
      });

      expect(evaluateCondition('file.hasLink("Zielnotiz")', notePath)).toBe(true);
      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteMarkdown)).toBe(true);
      expect(evaluateCondition('file.hasLink("Zielnotiz")', noteMarkdownPath)).toBe(true);
    });

    it('correctly evaluates negation !file.hasLink("Zielnotiz")', () => {
      const noteLinking = createRecordFromNote({
        path: 'Notes/Linking.md',
        links: ['Zielnotiz'],
      });
      const noteNotLinking = createRecordFromNote({
        path: 'Notes/NotLinking.md',
        links: ['DifferentNote'],
      });

      expect(evaluateCondition('!file.hasLink("Zielnotiz")', noteLinking)).toBe(false);
      expect(evaluateCondition('!file.hasLink("Zielnotiz")', noteNotLinking)).toBe(true);
    });
  });

  describe('executeBaseQuery', () => {
    const sampleNotes = [
      {
        path: 'Projekte/App.md',
        name: 'App.md',
        properties: [
          { key: 'priority', value: 1, type: 'number' as const },
          { key: 'status', value: 'in_progress', type: 'text' as const },
          { key: 'team', value: 'Alpha', type: 'text' as const },
        ],
        tags: ['dev'],
      },
      {
        path: 'Projekte/Backend.md',
        name: 'Backend.md',
        properties: [
          { key: 'priority', value: 3, type: 'number' as const },
          { key: 'status', value: 'done', type: 'text' as const },
          { key: 'team', value: 'Beta', type: 'text' as const },
        ],
        tags: ['dev'],
      },
      {
        path: 'Projekte/Design.md',
        name: 'Design.md',
        properties: [
          { key: 'priority', value: 2, type: 'number' as const },
          { key: 'status', value: 'in_progress', type: 'text' as const },
          { key: 'team', value: 'Alpha', type: 'text' as const },
        ],
        tags: ['ux'],
      },
      {
        path: 'Archiv/Old.md',
        name: 'Old.md',
        properties: [
          { key: 'priority', value: 99, type: 'number' as const },
          { key: 'status', value: 'done', type: 'text' as const },
        ],
      },
    ];

    it('filters records by folder and status', () => {
      const def: BaseDefinition = {
        filters: {
          and: [
            'file.inFolder("Projekte")',
            'status == "in_progress"',
          ],
        },
        views: [{ type: 'table', name: 'Active Projects' }],
      };

      const result = executeBaseQuery(def, sampleNotes, 0);
      expect(result.totalCount).toBe(2);
      expect(result.records.map((r) => r.file.name)).toEqual(['App.md', 'Design.md']);
    });

    it('sorts records ascending and descending', () => {
      const def: BaseDefinition = {
        filters: 'file.inFolder("Projekte")',
        views: [
          {
            type: 'table',
            name: 'Sorted Projects',
            sort: [{ property: 'priority', direction: 'DESC' }],
          },
        ],
      };

      const result = executeBaseQuery(def, sampleNotes, 0);
      expect(result.records.map((r) => r.file.name)).toEqual(['Backend.md', 'Design.md', 'App.md']);
    });

    it('groups records by team property', () => {
      const def: BaseDefinition = {
        filters: 'file.inFolder("Projekte")',
        views: [
          {
            type: 'cards',
            name: 'By Team',
            groupBy: { property: 'team' },
          },
        ],
      };

      const result = executeBaseQuery(def, sampleNotes, 0);
      expect(result.groups.length).toBe(2);
      const alphaGroup = result.groups.find((g) => g.key === 'Alpha');
      const betaGroup = result.groups.find((g) => g.key === 'Beta');
      expect(alphaGroup?.records).toHaveLength(2);
      expect(betaGroup?.records).toHaveLength(1);
    });

    it('limits records count when limit is specified', () => {
      const def: BaseDefinition = {
        filters: 'file.inFolder("Projekte")',
        views: [
          {
            type: 'table',
            name: 'Top 2',
            limit: 2,
            sort: [{ property: 'priority', direction: 'ASC' }],
          },
        ],
      };

      const result = executeBaseQuery(def, sampleNotes, 0);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].file.name).toBe('App.md');
      expect(result.records[1].file.name).toBe('Design.md');
    });

    it('excludes .base files and currentBasePath by default, and deduplicates candidates', () => {
      const def: BaseDefinition = {
        views: [{ type: 'table', name: 'All' }],
      };
      const notesWithBases = [
        ...sampleNotes,
        // duplicate candidate path
        { path: 'Projekte/App.md', name: 'App.md', properties: { status: 'in-progress' } },
        // .base file
        { path: 'Dashboard.base', name: 'Dashboard.base', properties: {} },
        // currentBasePath
        { path: 'Projekte/Projects.base', name: 'Projects.base', properties: {} },
      ];

      const result = executeBaseQuery(def, notesWithBases, 0, 'Projekte/Projects.base');
      const paths = result.records.map((r) => r.file.path);
      // No duplicate App.md
      expect(paths.filter((p) => p === 'Projekte/App.md')).toHaveLength(1);
      // No .base files
      expect(paths.some((p) => p.endsWith('.base'))).toBe(false);
      expect(paths).toContain('Projekte/App.md');
      expect(paths).toContain('Projekte/Design.md');
      expect(paths).toContain('Projekte/Backend.md');
      expect(paths).toContain('Archiv/Old.md');
    });

    it('flexibly resolves both IP and note.IP property keys in getPropertyValue and filters', () => {
      const record = createRecordFromNote({
        path: 'Servers/Web01.md',
        name: 'Web01.md',
        properties: {
          IP: '192.168.1.100',
          role: 'web',
        },
      });

      expect(getPropertyValue(record, 'IP')).toBe('192.168.1.100');
      expect(getPropertyValue(record, 'note.IP')).toBe('192.168.1.100');
      expect(getPropertyValue(record, 'role')).toBe('web');
      expect(getPropertyValue(record, 'note.role')).toBe('web');

      // In expressions
      expect(evaluateCondition('IP == "192.168.1.100"', record)).toBe(true);
      expect(evaluateCondition('note.IP == "192.168.1.100"', record)).toBe(true);
    });
  });

  describe('refactorBaseContent', () => {
    it('refactors note paths and wiki links in YAML base queries', () => {
      const yaml = `
filters:
  and:
    - "file.inFolder('OldFolder')"
    - "file.hasLink('OldNotes/Spec.md')"
views:
  - type: table
    order:
      - file.name
`;
      const updated = refactorBaseContent(yaml, 'OldNotes/Spec.md', 'NewNotes/Spec.md');
      expect(updated).toContain('NewNotes/Spec.md');
      expect(updated).not.toContain('OldNotes/Spec.md');
    });
  });

  describe('groupBoard2D (2D Kanban Matrix: Columns x Swimlanes)', () => {
    it('groups records across columns and swimlanes and creates catch-all rows/columns when needed', () => {
      const records = [
        createRecordFromNote({
          path: 'Tasks/T1.md',
          name: 'T1.md',
          properties: { status: 'Open', prio: 'Prio 1' },
        }),
        createRecordFromNote({
          path: 'Tasks/T2.md',
          name: 'T2.md',
          properties: { status: 'inWork', prio: 'Prio 2' },
        }),
        createRecordFromNote({
          path: 'Tasks/T3.md',
          name: 'T3.md',
          properties: { status: 'Open', prio: '' }, // Unassigned swimlane
        }),
        createRecordFromNote({
          path: 'Tasks/T4.md',
          name: 'T4.md',
          properties: { status: '', prio: 'Prio 1' }, // Unassigned column
        }),
      ];

      const view = {
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
            { name: 'Prio 2', collapsed: true },
          ],
        },
        columnLimit: 10,
      };

      const matrix = groupBoard2D(records, view, {
        noStatusLabel: 'Kein Status',
        unassignedSwimlaneLabel: 'Keine Zuordnung',
      });

      // Columns: Open (2), inWork (1), Finish (0), Kein Status (1)
      expect(matrix.columns.map((c) => c.key)).toEqual([
        'Open',
        'inWork',
        'Finish',
        'no_status',
      ]);
      expect(matrix.columns.find((c) => c.key === 'Open')?.totalCount).toBe(2);
      expect(matrix.columns.find((c) => c.key === 'inWork')?.totalCount).toBe(1);
      expect(matrix.columns.find((c) => c.key === 'Finish')?.totalCount).toBe(0);
      expect(matrix.columns.find((c) => c.key === 'no_status')?.totalCount).toBe(1);

      // Swimlane rows: Prio 1 (2), Prio 2 (1, collapsed), Keine Zuordnung (1)
      expect(matrix.rows.map((r) => r.key)).toEqual([
        'Prio 1',
        'Prio 2',
        'unassigned_swimlane',
      ]);

      const prio1Row = matrix.rows.find((r) => r.key === 'Prio 1')!;
      expect(prio1Row.totalCount).toBe(2);
      expect(prio1Row.collapsed).toBe(false);
      expect(prio1Row.cells['Open'].map((r) => r.file.name)).toEqual(['T1.md']);
      expect(prio1Row.cells['no_status'].map((r) => r.file.name)).toEqual(['T4.md']);

      const prio2Row = matrix.rows.find((r) => r.key === 'Prio 2')!;
      expect(prio2Row.totalCount).toBe(1);
      expect(prio2Row.collapsed).toBe(true);
      expect(prio2Row.cells['inWork'].map((r) => r.file.name)).toEqual(['T2.md']);

      const unassignedRow = matrix.rows.find((r) => r.key === 'unassigned_swimlane')!;
      expect(unassignedRow.isUnassigned).toBe(true);
      expect(unassignedRow.label).toBe('Keine Zuordnung');
      expect(unassignedRow.totalCount).toBe(1);
      expect(unassignedRow.cells['Open'].map((r) => r.file.name)).toEqual(['T3.md']);
    });
  });
});
