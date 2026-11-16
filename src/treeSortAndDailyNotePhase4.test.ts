import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileTreeNode } from '../shared/types';
import {
  sortTreeNodes,
  getNodeTimestamp,
  getTreeSortMode,
  saveTreeSortMode,
  TREE_SORT_STORAGE_KEY,
} from './utils/treeSort';
import {
  getDailyNoteConfig,
  saveDailyNoteConfig,
  resolveStartupNotePath,
  DAILY_NOTE_CONFIG_KEY,
  STARTUP_CONFIG_KEY,
} from './startupConfig';
import { syncEngine } from './sync/syncEngine';

describe('Phase 4: Tree Sorting & Daily Note System', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };
    vi.restoreAllMocks();
  });

  describe('1. Tree Sorting Logic (src/utils/treeSort.ts)', () => {
    const mockTree: FileTreeNode[] = [
      {
        name: 'Zebra.md',
        path: 'Zebra.md',
        type: 'file',
        updatedAt: 1000,
      },
      {
        name: 'Alpha.md',
        path: 'Alpha.md',
        type: 'file',
        updatedAt: 3000,
      },
      {
        name: 'Projects',
        path: 'Projects',
        type: 'folder',
        children: [
          {
            name: 'Beta.md',
            path: 'Projects/Beta.md',
            type: 'file',
            updatedAt: 5000,
          },
          {
            name: 'Delta.md',
            path: 'Projects/Delta.md',
            type: 'file',
            updatedAt: 2000,
          },
        ],
      },
      {
        name: 'Archive',
        path: 'Archive',
        type: 'folder',
        children: [
          {
            name: 'Old.md',
            path: 'Archive/Old.md',
            type: 'file',
            updatedAt: 500,
          },
        ],
      },
    ];

    it('sorts nodes name-asc: folders A-Z at top, files A-Z below, recursively', () => {
      const sorted = sortTreeNodes(mockTree, 'name-asc');

      // Top level: Archive, Projects (folders first, A-Z), then Alpha.md, Zebra.md
      expect(sorted.map((n) => n.name)).toEqual(['Archive', 'Projects', 'Alpha.md', 'Zebra.md']);

      // Inside Projects: Beta.md, Delta.md
      const projectsNode = sorted.find((n) => n.name === 'Projects')!;
      expect(projectsNode.children?.map((c) => c.name)).toEqual(['Beta.md', 'Delta.md']);
    });

    it('sorts nodes name-desc: folders Z-A at top, files Z-A below, recursively', () => {
      const sorted = sortTreeNodes(mockTree, 'name-desc');

      // Top level: Projects, Archive (folders first, Z-A), then Zebra.md, Alpha.md
      expect(sorted.map((n) => n.name)).toEqual(['Projects', 'Archive', 'Zebra.md', 'Alpha.md']);

      // Inside Projects: Delta.md, Beta.md
      const projectsNode = sorted.find((n) => n.name === 'Projects')!;
      expect(projectsNode.children?.map((c) => c.name)).toEqual(['Delta.md', 'Beta.md']);
    });

    it('sorts nodes mtime-desc: newest first, folders prioritized by max child mtime', () => {
      const sorted = sortTreeNodes(mockTree, 'mtime-desc');

      // Projects has child Beta.md with 5000; Archive has child Old.md with 500
      // Folders: Projects (5000) before Archive (500)
      // Files: Alpha.md (3000) before Zebra.md (1000)
      expect(sorted.map((n) => n.name)).toEqual(['Projects', 'Archive', 'Alpha.md', 'Zebra.md']);

      // Inside Projects: Beta.md (5000) before Delta.md (2000)
      const projectsNode = sorted.find((n) => n.name === 'Projects')!;
      expect(projectsNode.children?.map((c) => c.name)).toEqual(['Beta.md', 'Delta.md']);
    });

    it('sorts nodes mtime-asc: oldest first, folders prioritized by min/oldest child mtime', () => {
      const sorted = sortTreeNodes(mockTree, 'mtime-asc');

      // Archive max mtime: 500; Projects max mtime: 5000
      // Folders: Archive (500) before Projects (5000)
      // Files: Zebra.md (1000) before Alpha.md (3000)
      expect(sorted.map((n) => n.name)).toEqual(['Archive', 'Projects', 'Zebra.md', 'Alpha.md']);

      // Inside Projects: Delta.md (2000) before Beta.md (5000)
      const projectsNode = sorted.find((n) => n.name === 'Projects')!;
      expect(projectsNode.children?.map((c) => c.name)).toEqual(['Delta.md', 'Beta.md']);
    });

    it('getNodeTimestamp correctly calculates maximum timestamp in nested folders', () => {
      const folder: FileTreeNode = {
        name: 'Parent',
        path: 'Parent',
        type: 'folder',
        children: [
          {
            name: 'Sub',
            path: 'Parent/Sub',
            type: 'folder',
            children: [
              {
                name: 'Deep.md',
                path: 'Parent/Sub/Deep.md',
                type: 'file',
                mtimeMs: 9999,
              },
            ],
          },
          {
            name: 'File1.md',
            path: 'Parent/File1.md',
            type: 'file',
            updatedAt: 100,
          },
        ],
      };

      expect(getNodeTimestamp(folder)).toBe(9999);
    });

    it('persists and retrieves tree sort mode from localStorage with fallback', () => {
      expect(getTreeSortMode()).toBe('name-asc');

      saveTreeSortMode('mtime-desc');
      expect(localStorage.getItem(TREE_SORT_STORAGE_KEY)).toBe('mtime-desc');
      expect(getTreeSortMode()).toBe('mtime-desc');

      // Test fallback to legacy knowmesh key
      localStorage.removeItem(TREE_SORT_STORAGE_KEY);
      localStorage.setItem('knowmesh_tree_sort', 'name-desc');
      expect(getTreeSortMode()).toBe('name-desc');
    });
  });

  describe('2. Daily Note Configuration (src/startupConfig.ts)', () => {
    it('manages daily note config in localStorage and syncs dailyFolder with startup config', () => {
      const initial = getDailyNoteConfig();
      expect(initial.dailyFolder).toBe('');
      expect(initial.templatePath).toBe('');

      saveDailyNoteConfig({
        dailyFolder: 'Tägliche Notizen',
        templatePath: 'Templates/Daily.md',
      });

      const updated = getDailyNoteConfig();
      expect(updated.dailyFolder).toBe('Tägliche Notizen');
      expect(updated.templatePath).toBe('Templates/Daily.md');

      // Check localStorage JSON
      const stored = JSON.parse(localStorage.getItem(DAILY_NOTE_CONFIG_KEY)!);
      expect(stored.dailyFolder).toBe('Tägliche Notizen');
      expect(stored.templatePath).toBe('Templates/Daily.md');

      // Check startup config dailyFolder sync
      const startup = JSON.parse(localStorage.getItem(STARTUP_CONFIG_KEY)!);
      expect(startup.dailyFolder).toBe('Tägliche Notizen');
    });
  });

  describe('3. 10-Character-Prefix Search & Template Resolution (resolveStartupNotePath)', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const todayPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    it('finds existing daily note by 10-char prefix in configured dailyFolder', async () => {
      localStorage.setItem(
        STARTUP_CONFIG_KEY,
        JSON.stringify({ behavior: 'daily', dailyFolder: 'Dailies' })
      );
      localStorage.setItem(
        DAILY_NOTE_CONFIG_KEY,
        JSON.stringify({ dailyFolder: 'Dailies', templatePath: '' })
      );

      const files = [
        { path: 'Dailies/2026-01-01.md', extension: 'md', basename: '2026-01-01' },
        {
          path: `Dailies/${todayPrefix} Standup & Meeting.md`,
          extension: 'md',
          basename: `${todayPrefix} Standup & Meeting`,
        },
        { path: 'Notes/Test.md', extension: 'md', basename: 'Test' },
      ];

      const resolved = await resolveStartupNotePath(files);
      expect(resolved).toBe(`Dailies/${todayPrefix} Standup & Meeting.md`);
    });

    it('strictly scopes daily note lookup to root when dailyFolder is empty and ignores Inbox/', async () => {
      localStorage.setItem(
        STARTUP_CONFIG_KEY,
        JSON.stringify({ behavior: 'daily', dailyFolder: '' })
      );
      localStorage.setItem(
        DAILY_NOTE_CONFIG_KEY,
        JSON.stringify({ dailyFolder: '', templatePath: '' })
      );

      // Only Inbox/ note exists -> must NOT match Inbox/, should create root daily note
      vi.spyOn(syncEngine, 'saveNote').mockImplementation(async (payload) => ({
        path: payload.path,
        name: payload.path.split('/').pop() || payload.path,
        rawContent: '',
        body: payload.body || '',
        frontmatter: {},
        properties: payload.properties || [],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: Date.now(),
      }));

      const onlyInbox = [
        { path: `Inbox/${todayPrefix} Email.md`, extension: 'md', basename: `${todayPrefix} Email` },
        { path: 'Notes/Random.md', extension: 'md', basename: 'Random' },
      ];
      const createdRoot = await resolveStartupNotePath(onlyInbox);
      expect(createdRoot).toBe(`${todayPrefix}.md`);

      // When both Inbox/ and root daily note exist, root daily note is matched
      const withRoot = [
        { path: `Inbox/${todayPrefix} Email.md`, extension: 'md', basename: `${todayPrefix} Email` },
        { path: `${todayPrefix} Notes.md`, extension: 'md', basename: `${todayPrefix} Notes` },
      ];
      const resolvedRoot = await resolveStartupNotePath(withRoot);
      expect(resolvedRoot).toBe(`${todayPrefix} Notes.md`);
    });

    it('strictly scopes daily note lookup to configured dailyFolder and ignores other folders', async () => {
      localStorage.setItem(
        STARTUP_CONFIG_KEY,
        JSON.stringify({ behavior: 'daily', dailyFolder: 'Dailies' })
      );
      localStorage.setItem(
        DAILY_NOTE_CONFIG_KEY,
        JSON.stringify({ dailyFolder: 'Dailies', templatePath: '' })
      );

      vi.spyOn(syncEngine, 'saveNote').mockImplementation(async (payload) => ({
        path: payload.path,
        name: payload.path.split('/').pop() || payload.path,
        rawContent: '',
        body: payload.body || '',
        frontmatter: {},
        properties: payload.properties || [],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: Date.now(),
      }));

      const files = [
        {
          path: `${todayPrefix}.md`, // In root, not Dailies
          extension: 'md',
          basename: todayPrefix,
        },
        {
          path: `Inbox/${todayPrefix} Testmail.md`,
          extension: 'md',
          basename: `${todayPrefix} Testmail`,
        },
        { path: 'Notes/Random.md', extension: 'md', basename: 'Random' },
      ];

      const resolved = await resolveStartupNotePath(files);
      expect(resolved).toBe(`Dailies/${todayPrefix}.md`);
    });

    it('creates new daily note with template placeholders {{date}} and {{time}} replaced', async () => {
      localStorage.setItem(
        STARTUP_CONFIG_KEY,
        JSON.stringify({ behavior: 'daily', dailyFolder: 'Tagebuch' })
      );
      localStorage.setItem(
        DAILY_NOTE_CONFIG_KEY,
        JSON.stringify({ dailyFolder: 'Tagebuch', templatePath: 'Templates/DailyTemplate.md' })
      );

      // Mock template loading from syncEngine.getNote
      vi.spyOn(syncEngine, 'getNote').mockImplementation(async (path: string) => {
        if (path === 'Templates/DailyTemplate.md') {
          return {
            path,
            name: 'DailyTemplate.md',
            rawContent: '',
            body: '# Tagesnotiz für {{date}}\nErstellt um {{time}} Uhr.\n\n## Notizen\n',
            frontmatter: {},
            properties: [
              { key: 'tags', type: 'list', value: ['daily', 'journal'] },
              { key: 'datum', type: 'date', value: '{{date}}' },
            ],
            links: [],
            embeds: [],
            tags: [],
            headings: [],
            updatedAt: 1234,
          };
        }
        throw new Error('Not found');
      });

      let savedPayload: any = null;
      vi.spyOn(syncEngine, 'saveNote').mockImplementation(async (note: any) => {
        savedPayload = note;
        return {
          ...note,
          name: `${todayPrefix}.md`,
          rawContent: '',
          frontmatter: {},
          links: [],
          embeds: [],
          tags: [],
          headings: [],
          updatedAt: Date.now(),
        };
      });

      const files = [{ path: 'Notes/Welcome.md', extension: 'md', basename: 'Welcome' }];

      const resolved = await resolveStartupNotePath(files);
      expect(resolved).toBe(`Tagebuch/${todayPrefix}.md`);
      expect(savedPayload).not.toBeNull();
      expect(savedPayload.path).toBe(`Tagebuch/${todayPrefix}.md`);
      expect(savedPayload.body).toContain(`# Tagesnotiz für ${todayPrefix}`);
      expect(savedPayload.body).toMatch(/Erstellt um \d{2}:\d{2} Uhr\./);

      const dateProp = savedPayload.properties.find((p: any) => p.key === 'datum');
      expect(dateProp.value).toBe(todayPrefix);
    });
  });
});
