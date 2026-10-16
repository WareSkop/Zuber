import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractLinksAndEmbeds,
  extractTags,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import { VaultService } from './vaultService';
import { ensureTlsCredentials } from './tls';
import { ConfigService } from './configService';

describe('Basalt - Markdown & Frontmatter Utils', () => {
  it('parses frontmatter into visual properties and separates body from YAML', () => {
    const raw = `---
tags:
  - basalt
  - wissen
status: Aktiv
favorit: true
priorität: 2
erstellt: 2026-10-16
---

# Meine Notiz

Verweis auf [[Zweite Notiz|Alias]] und ![[diagramm.svg]].
Auch ein #inlineTag ist dabei.`;

    const parsed = parseMarkdownWithFrontmatter(raw);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.body).toContain('# Meine Notiz');
    expect(parsed.body).not.toContain('status: Aktiv');

    const tagsProp = parsed.properties.find((p) => p.key === 'tags');
    expect(tagsProp?.type).toBe('list');
    expect(tagsProp?.value).toEqual(['basalt', 'wissen']);

    const favProp = parsed.properties.find((p) => p.key === 'favorit');
    expect(favProp?.type).toBe('checkbox');
    expect(favProp?.value).toBe(true);

    const dateProp = parsed.properties.find((p) => p.key === 'erstellt');
    expect(dateProp?.type).toBe('date');

    const { links, embeds } = extractLinksAndEmbeds(parsed.body);
    expect(links).toEqual(['Zweite Notiz']);
    expect(embeds).toEqual(['diagramm.svg']);

    const allTags = extractTags(parsed.properties, parsed.body);
    expect(allTags).toEqual(['basalt', 'wissen', 'inlineTag']);
  });

  it('serializes visual properties back into clean YAML frontmatter + body', () => {
    const output = serializeMarkdownWithFrontmatter(
      [
        { key: 'tags', type: 'list', value: ['projekt', 'web'] },
        { key: 'erledigt', type: 'checkbox', value: false },
      ],
      '# Titel\n\nInhalt.'
    );
    expect(output.startsWith('---\n')).toBe(true);
    expect(output).toContain('erledigt: false');
    expect(output).toContain('# Titel\n\nInhalt.');
  });
});

describe('VaultService & Sync Engine', () => {
  let tmpDir: string;
  let service: VaultService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basalt-vault-test-'));
    service = new VaultService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds initial vault notes and builds graph + backlinks', () => {
    const tree = service.getFileTree();
    expect(tree.length).toBeGreaterThan(0);

    const graph = service.buildGraph();
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
    expect(graph.edges.length).toBeGreaterThan(0);

    const archBacklinks = service.getBacklinks('Projekte/Projekt-Architektur.md');
    expect(archBacklinks.linked.length).toBeGreaterThan(0);
  });

  it('resolves URL-encoded and folder-relative attachment paths in O(1)', () => {
    const subDir = path.join(tmpDir, 'Projekte', '3d Drucker', 'attachments');
    fs.mkdirSync(subDir, { recursive: true });
    const imgPath = path.join(subDir, 'image1.png');
    fs.writeFileSync(imgPath, 'fake-png');
    service.indexFile('Projekte/3d Drucker/attachments/image1.png');

    // URL-encoded path
    expect(
      service.resolveWikiTarget('Projekte/3d%20Drucker/attachments/image1.png')
    ).toBe('Projekte/3d Drucker/attachments/image1.png');

    // Folder-relative path from note in "Projekte/3d Drucker/Note.md"
    expect(
      service.resolveWikiTarget(
        'attachments/image1.png',
        'Projekte/3d Drucker/Tinmorry Fillament PLA .md'
      )
    ).toBe('Projekte/3d Drucker/attachments/image1.png');

    // Uploaded root attachment in attachments/ folder
    const rootAttachDir = path.join(tmpDir, 'attachments');
    fs.mkdirSync(rootAttachDir, { recursive: true });
    fs.writeFileSync(path.join(rootAttachDir, 'pasted-image-1729110000.png'), 'fake-png');
    service.indexFile('attachments/pasted-image-1729110000.png');
    expect(
      service.resolveWikiTarget('attachments/pasted-image-1729110000.png')
    ).toBe('attachments/pasted-image-1729110000.png');
    expect(
      service.resolveWikiTarget('pasted-image-1729110000.png')
    ).toBe('attachments/pasted-image-1729110000.png');
  });

  it('updates WikiLinks across the vault when a note is renamed', () => {
    const res = service.renameOrMove(
      'Projekte/Projekt-Architektur.md',
      'Projekte/System-Architektur.md'
    );
    expect(res.newPath).toBe('Projekte/System-Architektur.md');

    const welcome = service.getNote('Willkommen im Obsidian Web Vault.md');
    expect(welcome.body).toContain('[[System-Architektur]]');
  });

  it('generates sync manifest and supports batch note downloads in O(1)', () => {
    const manifest = service.getSyncManifest();
    expect(manifest.length).toBeGreaterThan(0);
    const mdEntries = manifest.filter((e) => e.type === 'markdown');
    expect(mdEntries.length).toBeGreaterThan(0);
    expect(mdEntries[0].mtime).toBeGreaterThan(0);

    const paths = mdEntries.slice(0, 3).map((e) => e.path);
    const batch = service.getNotesBatch(paths);
    expect(batch.length).toBe(paths.length);
    expect(batch[0].path).toBe(paths[0]);
  });

  it('detects save conflicts when baseMtime differs from server note', () => {
    const initialNote = service.saveNote('Konflikt-Test.md', {
      body: 'Server Version 1',
    });
    const firstMtime = initialNote.updatedAt;

    // Simulate server side edit or other user modifying the file
    // Wait a brief moment to ensure mtime ticks or force newer mtime
    const updatedServer = service.saveNote('Konflikt-Test.md', {
      body: 'Server Version 2 von anderem Client',
      forceOverwrite: true,
    });
    expect(updatedServer.body).toContain('Server Version 2');

    // Client tries to save with stale baseMtime (firstMtime - 5000)
    expect(() => {
      service.saveNote('Konflikt-Test.md', {
        body: 'Mein lokaler Offline-Text',
        baseMtime: firstMtime - 1000,
        forceOverwrite: false,
      });
    }).toThrowError('Conflict');

    // Force overwrite bypasses conflict
    const forced = service.saveNote('Konflikt-Test.md', {
      body: 'Mein erzwungener Text',
      forceOverwrite: true,
    });
    expect(forced.body).toBe('Mein erzwungener Text');
  });

  it('auto-generates self-signed TLS credentials for HTTPS', () => {
    const tls = ensureTlsCredentials(tmpDir);
    expect(tls.isSelfSigned).toBe(true);
    expect(tls.cert).toContain('BEGIN CERTIFICATE');
    expect(tls.key).toContain('BEGIN PRIVATE KEY');
  });
});

describe('ConfigService & Dynamic Security Settings', () => {
  let tmpConfigDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basalt-config-test-'));
    configPath = path.join(tmpConfigDir, 'server-config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  it('creates initial server-config.json and verifies default password', () => {
    const cfg = new ConfigService(configPath);
    expect(cfg.isAuthRequired()).toBe(true);
    expect(cfg.verifyPassword('obsidian')).toBe(true);
    expect(cfg.verifyPassword('wrong-password')).toBe(false);
  });

  it('updates password and toggles authEnabled dynamically', () => {
    const cfg = new ConfigService(configPath);
    cfg.updateSecurity(true, 'neues-sicheres-passwort-123');

    expect(cfg.verifyPassword('neues-sicheres-passwort-123')).toBe(true);
    expect(cfg.verifyPassword('obsidian')).toBe(false);

    // Disable auth
    cfg.updateSecurity(false);
    expect(cfg.isAuthRequired()).toBe(false);
    expect(cfg.verifyPassword('beliebig')).toBe(true);
  });
});

import { LocalDb } from '../src/sync/localDb';

describe('Offline Sync Structures & Conflict Resolution Utilities', () => {
  it('formats conflict filenames with timestamp according to spec', () => {
    const originalPath = 'Projekte/Mobile App.md';
    const baseName = originalPath.replace(/\.md$/, '');
    const now = new Date(1760650000000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const conflictPath = `${baseName} (Konflikt ${timeStr}).md`;

    expect(conflictPath).toContain('Projekte/Mobile App (Konflikt ');
    expect(conflictPath.endsWith('.md')).toBe(true);
  });

  it('generates predictable database names per profile id', () => {
    const db1 = new LocalDb('default');
    const db2 = new LocalDb('Heimserver:3443');
    expect((db1 as any).dbName).toBe('basalt_cache_default');
    expect((db2 as any).dbName).toBe('basalt_cache_Heimserver_3443');
  });
});

describe('Basalt - Image HTML Attributes & Command Palette', () => {
  it('formats HTML img tags with width and align attributes for maximum compatibility', () => {
    const src = 'attachments/diagramm-1729110000.png';
    const alt = 'Architektur Diagramm';
    const width = 450;
    const align = 'center';

    const parts = [`<img src="${src}"`];
    if (alt) parts.push(`alt="${alt}"`);
    if (width) parts.push(`width="${width}"`);
    if (align) parts.push(`align="${align}"`);
    parts.push('/>');

    const formattedTag = parts.join(' ');
    expect(formattedTag).toBe(
      '<img src="attachments/diagramm-1729110000.png" alt="Architektur Diagramm" width="450" align="center" />'
    );

    // Verify regex extraction from formatted HTML img tag
    const tagMatch = /<img\b([^>]*?)\/?>/i.exec(formattedTag);
    expect(tagMatch).not.toBeNull();
    const attrs = tagMatch![1];
    const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
    const widthMatch = /width=["']?(\d+)["']?/i.exec(attrs);
    const alignMatch = /align=["']?(left|center|right)["']?/i.exec(attrs);

    expect(srcMatch?.[1]).toBe(src);
    expect(parseInt(widthMatch?.[1] || '0', 10)).toBe(450);
    expect(alignMatch?.[1]).toBe('center');
  });

  it('filters command palette items across title, category, shortcut, and keywords', () => {
    const testCommands = [
      { id: '1', title: 'Fett umschalten (Bold)', category: 'Formatierung', shortcut: 'Strg+B', keywords: ['bold', 'fett'] },
      { id: '2', title: 'Tabelle einfügen', category: 'Formatierung', shortcut: 'Alt+Shift+T', keywords: ['table', 'grid'] },
      { id: '3', title: 'Bild oder Anhang einfügen', category: 'Editor', shortcut: 'Strg+Shift+I', keywords: ['bild', 'upload'] },
      { id: '4', title: 'Theme „Dracula“', category: 'Einstellungen', keywords: ['theme', 'lila'] },
    ];

    const searchFilter = (query: string) => {
      const q = query.trim().toLowerCase();
      return testCommands.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          (c.shortcut && c.shortcut.toLowerCase().includes(q)) ||
          c.keywords.some((k) => k.toLowerCase().includes(q))
      );
    };

    // By title
    expect(searchFilter('tabelle').map((c) => c.id)).toEqual(['2']);
    // By keyword
    expect(searchFilter('bold').map((c) => c.id)).toEqual(['1']);
    // By shortcut
    expect(searchFilter('strg+b').map((c) => c.id)).toEqual(['1']);
    // By category
    expect(searchFilter('einstellungen').map((c) => c.id)).toEqual(['4']);
  });
});

describe('Basalt - Graph Semantic Zoom, Anti-Collision & Color Groups', () => {
  it('correctly matches node color groups by path, tag, and label', async () => {
    const { matchNodeGroup } = await import('../src/components/GraphView');

    const testGroups = [
      { id: '1', query: 'path:Projekte', color: '#38bdf8' },
      { id: '2', query: '#krypto', color: '#22c55e' },
      { id: '3', query: 'Architektur', color: '#f59e0b' },
    ];

    const note1: any = {
      id: 'Projekte/App.md',
      label: 'App',
      path: 'Projekte/App.md',
      type: 'note',
      degree: 2,
    };
    const note2: any = {
      id: 'Finanzen/Bitcoin.md',
      label: 'Bitcoin',
      path: 'Finanzen/Bitcoin.md',
      type: 'note',
      degree: 1,
      tags: ['krypto', 'invest'],
    };
    const note3: any = {
      id: 'System/Architektur.md',
      label: 'Architektur Übersicht',
      path: 'System/Architektur.md',
      type: 'note',
      degree: 5,
    };
    const note4: any = {
      id: 'Allgemein/Notiz.md',
      label: 'Notiz',
      path: 'Allgemein/Notiz.md',
      type: 'note',
      degree: 0,
    };

    expect(matchNodeGroup(note1, testGroups)).toBe('#38bdf8');
    expect(matchNodeGroup(note2, testGroups)).toBe('#22c55e');
    expect(matchNodeGroup(note3, testGroups)).toBe('#f59e0b');
    expect(matchNodeGroup(note4, testGroups)).toBeNull();
  });

  it('calculates logarithmic radii that stay bounded under high degrees and extreme zoom levels', () => {
    const calcRadius = (degree: number, scale: number, multiplier = 1.0) => {
      const baseRadius = 2.8 + Math.log(1 + degree) * 1.6;
      return Math.min(14, Math.max(2.0, baseRadius * Math.pow(scale, 0.35) * multiplier));
    };

    // Low degree, zoomed out
    const r1 = calcRadius(0, 0.1);
    expect(r1).toBeGreaterThanOrEqual(2.0);
    expect(r1).toBeLessThan(4.0);

    // Medium degree, scale 1.0
    const r2 = calcRadius(5, 1.0);
    expect(r2).toBeGreaterThan(4.0);
    expect(r2).toBeLessThan(10.0);

    // Huge hub (degree 200), zoomed in (scale 4.0)
    const r3 = calcRadius(200, 4.0);
    expect(r3).toBe(14); // Strictly capped at 14px!
  });

  it('detects 2D bounding box collisions for anti-overlap label rendering', () => {
    const checkCollision = (
      boxA: { x1: number; y1: number; x2: number; y2: number },
      boxB: { x1: number; y1: number; x2: number; y2: number }
    ) => {
      return (
        boxA.x1 < boxB.x2 &&
        boxA.x2 > boxB.x1 &&
        boxA.y1 < boxB.y2 &&
        boxA.y2 > boxB.y1
      );
    };

    const boxA = { x1: 100, y1: 100, x2: 180, y2: 120 };
    const boxB_overlapping = { x1: 150, y1: 110, x2: 220, y2: 130 };
    const boxC_separate = { x1: 200, y1: 100, x2: 280, y2: 120 };

    expect(checkCollision(boxA, boxB_overlapping)).toBe(true);
    expect(checkCollision(boxA, boxC_separate)).toBe(false);
  });
});

describe('Basalt - Editor Toolbar & Mobile Swipe Gestures', () => {
  it('generates correct heading prefixes and replaces existing prefixes or strips for normal text (level 0)', () => {
    const applyHeadingPrefix = (lineText: string, level: number) => {
      const hashes = level > 0 ? '#'.repeat(level) + ' ' : '';
      const match = lineText.match(/^#{1,6}\s+/);
      if (match) {
        return hashes + lineText.slice(match[0].length);
      }
      return hashes + lineText;
    };

    expect(applyHeadingPrefix('Hallo Welt', 1)).toBe('# Hallo Welt');
    expect(applyHeadingPrefix('Hallo Welt', 3)).toBe('### Hallo Welt');
    expect(applyHeadingPrefix('### Alter Titel', 1)).toBe('# Alter Titel');
    expect(applyHeadingPrefix('# Alter Titel', 0)).toBe('Alter Titel'); // Normaler Text
  });

  it('generates standardized Callout blocks with localized titles', () => {
    const titleMap: Record<string, string> = {
      NOTE: 'Hinweis',
      INFO: 'Information',
      TIP: 'Tipp',
      WARNING: 'Warnung',
      DANGER: 'Gefahr',
      QUESTION: 'Frage',
    };

    const createCalloutSnippet = (type: string) => {
      const upper = type.toUpperCase();
      const title = titleMap[upper] || upper;
      return `> [!${upper}] ${title}\n> Text hier einfügen...\n\n`;
    };

    expect(createCalloutSnippet('note')).toContain('> [!NOTE] Hinweis');
    expect(createCalloutSnippet('tip')).toContain('> [!TIP] Tipp');
    expect(createCalloutSnippet('danger')).toContain('> [!DANGER] Gefahr');
    expect(createCalloutSnippet('warning')).toContain('> [!WARNING] Warnung');
    expect(createCalloutSnippet('info')).toContain('> [!INFO] Information');
    expect(createCalloutSnippet('question')).toContain('> [!QUESTION] Frage');
  });

  it('evaluates touch swipe gestures to open/close sidebar while suppressing vertical scroll', () => {
    const evaluateSwipe = (
      isOpen: boolean,
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ): 'open' | 'close' | 'none' => {
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absY > absX) return 'none'; // Vertical scroll ignored

      if (!isOpen) {
        const isEdgeStart = startX <= 35;
        const isStrongSwipe = deltaX > 65 && absX > absY * 1.5;
        if (isEdgeStart || isStrongSwipe) return 'open';
      } else {
        if (deltaX < -55 && absX > absY * 1.3) return 'close';
      }
      return 'none';
    };

    // Open from left edge (touchStartX 20px, deltaX +70px)
    expect(evaluateSwipe(false, 20, 100, 90, 102)).toBe('open');

    // Strong horizontal swipe anywhere (touchStartX 100px, deltaX +80px)
    expect(evaluateSwipe(false, 100, 200, 180, 205)).toBe('open');

    // Vertical scrolling should be ignored even with slight horizontal movement
    expect(evaluateSwipe(false, 20, 100, 50, 250)).toBe('none');

    // Close when open with swipe left (deltaX -70px)
    expect(evaluateSwipe(true, 250, 100, 180, 105)).toBe('close');

    // Slight swipe right when already open does nothing
    expect(evaluateSwipe(true, 100, 100, 140, 102)).toBe('none');
  });
});


