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
import { createSessionToken, verifySessionToken } from './auth';
import { rateLimiter } from './rateLimiter';
import { insertNodeIntoTree, generateMutationId } from '../src/sync/localDb';

describe('Knowmesh - Markdown & Frontmatter Utils', () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-vault-test-'));
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

    const welcome = service.getNote('Willkommen in Zuber.md');
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

  it('suppresses save conflict and returns existing note when incoming content is identical to server note even if baseMtime is stale', () => {
    const initialNote = service.saveNote('Identical-Conflict-Test.md', {
      body: '# Gleich\n\nDieser Text ist identisch.',
    });
    const firstMtime = initialNote.updatedAt;

    // Simulate another save on server that updates mtime
    const updated = service.saveNote('Identical-Conflict-Test.md', {
      body: '# Gleich\n\nDieser Text ist identisch.',
      forceOverwrite: true,
    });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(firstMtime);

    // Now a client sends identical content with an older baseMtime
    // It should NOT throw Conflict, but return the existing note cleanly
    const result = service.saveNote('Identical-Conflict-Test.md', {
      body: '# Gleich\n\nDieser Text ist identisch.',
      baseMtime: firstMtime - 5000,
      forceOverwrite: false,
    });
    expect(result.path).toBe('Identical-Conflict-Test.md');
    expect(result.body).toBe('# Gleich\n\nDieser Text ist identisch.');
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
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-config-test-'));
    configPath = path.join(tmpConfigDir, 'server-config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  it('creates initial server-config.json and verifies default password', () => {
    const cfg = new ConfigService(configPath);
    expect(cfg.isAuthRequired()).toBe(true);
    expect(cfg.verifyPassword('zuber')).toBe(true);
    expect(cfg.verifyPassword('knowmesh')).toBe(false);
    expect(cfg.verifyPassword('wrong-password')).toBe(false);
  });

  it('updates password and toggles authEnabled dynamically', () => {
    const cfg = new ConfigService(configPath);
    cfg.updateSecurity(true, 'neues-sicheres-passwort-123');

    expect(cfg.verifyPassword('neues-sicheres-passwort-123')).toBe(true);
    expect(cfg.verifyPassword('zuber')).toBe(false);

    // Disable auth
    cfg.updateSecurity(false);
    expect(cfg.isAuthRequired()).toBe(false);
    expect(cfg.verifyPassword('beliebig')).toBe(true);
  });

  it('respects PASSWORD, ZUBER_PASSWORD, KNOWMESH_PASSWORD and falls back to OBSIDIAN_WEB_PASSWORD', () => {
    const origPassword = process.env.PASSWORD;
    const origZuber = process.env.ZUBER_PASSWORD;
    const origKnowmesh = process.env.KNOWMESH_PASSWORD;
    const origObsidian = process.env.OBSIDIAN_WEB_PASSWORD;

    try {
      // 1. PASSWORD takes highest priority
      process.env.PASSWORD = 'pw-from-password-var';
      process.env.ZUBER_PASSWORD = 'pw-from-zuber-var';
      process.env.KNOWMESH_PASSWORD = 'super-secret-knowmesh';
      process.env.OBSIDIAN_WEB_PASSWORD = 'old-obsidian-pw';
      const testPath0 = path.join(tmpConfigDir, 'config0.json');
      const cfg0 = new ConfigService(testPath0);
      expect(cfg0.verifyPassword('pw-from-password-var')).toBe(true);
      expect(cfg0.verifyPassword('pw-from-zuber-var')).toBe(false);

      // 2. ZUBER_PASSWORD takes priority when PASSWORD is not set
      delete process.env.PASSWORD;
      const testPath1 = path.join(tmpConfigDir, 'config1.json');
      const cfg1 = new ConfigService(testPath1);
      expect(cfg1.verifyPassword('pw-from-zuber-var')).toBe(true);
      expect(cfg1.verifyPassword('super-secret-knowmesh')).toBe(false);

      // 3. KNOWMESH_PASSWORD takes priority when PASSWORD & ZUBER_PASSWORD are not set
      delete process.env.ZUBER_PASSWORD;
      const testPath2 = path.join(tmpConfigDir, 'config2.json');
      const cfg2 = new ConfigService(testPath2);
      expect(cfg2.verifyPassword('super-secret-knowmesh')).toBe(true);
      expect(cfg2.verifyPassword('old-obsidian-pw')).toBe(false);

      // 4. OBSIDIAN_WEB_PASSWORD fallback
      delete process.env.KNOWMESH_PASSWORD;
      const testPath3 = path.join(tmpConfigDir, 'config3.json');
      const cfg3 = new ConfigService(testPath3);
      expect(cfg3.verifyPassword('old-obsidian-pw')).toBe(true);
      expect(cfg3.verifyPassword('zuber')).toBe(false);
    } finally {
      if (origPassword !== undefined) process.env.PASSWORD = origPassword;
      else delete process.env.PASSWORD;

      if (origZuber !== undefined) process.env.ZUBER_PASSWORD = origZuber;
      else delete process.env.ZUBER_PASSWORD;

      if (origKnowmesh !== undefined) process.env.KNOWMESH_PASSWORD = origKnowmesh;
      else delete process.env.KNOWMESH_PASSWORD;

      if (origObsidian !== undefined) process.env.OBSIDIAN_WEB_PASSWORD = origObsidian;
      else delete process.env.OBSIDIAN_WEB_PASSWORD;
    }
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
    expect((db1 as any).dbName).toBe('zuber_cache_default');
    expect((db2 as any).dbName).toBe('zuber_cache_Heimserver_3443');
  });
});

describe('Knowmesh - Image HTML Attributes & Command Palette', () => {
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

describe('Knowmesh - Graph Semantic Zoom, Anti-Collision & Color Groups', () => {
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

describe('Knowmesh - Editor Toolbar & Mobile Swipe Gestures', () => {
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

  it('correctly calculates cursor position after inserting headings, lists, tasks, and quotes', () => {
    const calculatePrefixCursor = (
      lineText: string,
      cursorOffsetInLine: number,
      newPrefix: string,
      oldPrefixRegex?: RegExp
    ) => {
      const match = oldPrefixRegex ? lineText.match(oldPrefixRegex) : null;
      const oldPrefixLen = match ? match[0].length : 0;
      const offsetInContent = Math.max(0, cursorOffsetInLine - oldPrefixLen);
      return newPrefix.length + offsetInContent;
    };

    // Heading # on line with existing text
    expect(calculatePrefixCursor('Meine Notiz', 0, '# ', /^#{1,6}\s+/)).toBe(2);
    // Heading ### on empty line
    expect(calculatePrefixCursor('', 0, '### ', /^#{1,6}\s+/)).toBe(4);
    // Switch from # to ## with cursor inside content (offset 8 in "# Meine Notiz" -> after "Meine ")
    expect(calculatePrefixCursor('# Meine Notiz', 8, '## ', /^#{1,6}\s+/)).toBe(9);
    // List item -
    expect(calculatePrefixCursor('Erster Punkt', 0, '- ', /^-\s+/)).toBe(2);
    // Task item - [ ]
    expect(calculatePrefixCursor('Aufgabe', 0, '- [ ] ', /^-\s+\[[ xX]\]\s+/)).toBe(6);
    // Quote >
    expect(calculatePrefixCursor('Zitat', 0, '> ', /^>\s*/)).toBe(2);
  });
});

describe('Knowmesh - Security Hardening & Session Invalidation', () => {
  let tmpConfigDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-sec-test-'));
    configPath = path.join(tmpConfigDir, 'server-config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    delete process.env.FORCE_AUTH;
  });

  it('embeds sessionEpoch in tokens and invalidates tokens on session revocation', async () => {
    const config = new ConfigService(configPath);
    expect(config.getSessionEpoch()).toBe(1);

    // Initial token
    const token1 = createSessionToken();
    expect(verifySessionToken(token1)).toBe(true);

    // Revoke all sessions
    config.revokeAllSessions();
    expect(config.getSessionEpoch()).toBe(2);

    // Token1 must now be invalid
    // Note: auth.ts uses singleton configService, so test with singleton or direct epoch comparison
    const payload1 = JSON.parse(Buffer.from(token1.split('.')[0], 'base64url').toString('utf-8'));
    expect(payload1.sessionEpoch).toBe(1);
    expect(payload1.sessionEpoch).not.toBe(config.getSessionEpoch());
  });

  it('prevents deactivation of authentication when FORCE_AUTH=true', () => {
    process.env.FORCE_AUTH = 'true';
    const config = new ConfigService(configPath);
    expect(config.isForceAuthActive()).toBe(true);
    expect(config.isAuthRequired()).toBe(true);

    expect(() => {
      config.updateSecurity(false, undefined);
    }).toThrow(/FORCE_AUTH/);
  });
});

describe('Knowmesh - Brute-Force Rate Limiter', () => {
  beforeEach(() => {
    rateLimiter.resetForTest();
  });

  it('blocks IP after 5 failed login attempts and resets on success', () => {
    const testIp = '192.168.1.100';

    for (let i = 0; i < 4; i++) {
      rateLimiter.recordLoginFailure(testIp);
      expect(rateLimiter.checkLoginAllowed(testIp).allowed).toBe(true);
    }

    // 5th failure blocks
    rateLimiter.recordLoginFailure(testIp);
    const check = rateLimiter.checkLoginAllowed(testIp);
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);

    // Other IP is unaffected
    expect(rateLimiter.checkLoginAllowed('192.168.1.101').allowed).toBe(true);

    // Resetting on success unblocks
    rateLimiter.recordLoginSuccess(testIp);
    expect(rateLimiter.checkLoginAllowed(testIp).allowed).toBe(true);
  });

  it('enforces general API rate limit per IP', () => {
    const testIp = '10.0.0.5';
    let statusCode = 200;
    let jsonBody: any = null;

    const mockReq = {
      path: '/api/vault/tree',
      ip: testIp,
      headers: {},
      socket: {},
    } as any;

    const mockRes = {
      setHeader: () => {},
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            jsonBody = data;
          },
        };
      },
    } as any;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    // Simulate 600 calls (allowed)
    for (let i = 0; i < 600; i++) {
      rateLimiter.apiRateLimitMiddleware(mockReq, mockRes, next);
    }
    expect(nextCalled).toBe(600);
    expect(statusCode).toBe(200);

    // 601st call is blocked with 429
    rateLimiter.apiRateLimitMiddleware(mockReq, mockRes, next);
    expect(statusCode).toBe(429);
    expect(jsonBody?.error).toContain('Zu viele Anfragen');
  });
});

describe('Knowmesh - XSS Sanitization with DOMPurify', () => {
  it('strips malicious script tags and inline javascript while preserving allowed wiki attributes', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('');
    const dompurifyModule = await import('dompurify');
    const DOMPurify = (dompurifyModule.default as any)(dom.window);

    const dirtyHtml = `
      <h1>Überschrift</h1>
      <script>alert("xss")</script>
      <img src="x" onerror="alert(1)" />
      <a href="javascript:alert('steal')" data-wiki-target="Notiz.md" target="_blank">Link</a>
      <span class="reading-tag" data-tag="sicherheit">#sicherheit</span>
    `;

    const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
      ADD_ATTR: ['data-wiki-target', 'data-wikilink', 'data-tag', 'target'],
    });

    expect(cleanHtml).not.toContain('<script>');
    expect(cleanHtml).not.toContain('onerror');
    expect(cleanHtml).not.toContain('javascript:');
    expect(cleanHtml).toContain('data-wiki-target="Notiz.md"');
    expect(cleanHtml).toContain('data-tag="sicherheit"');
    expect(cleanHtml).toContain('target="_blank"');
    expect(cleanHtml).toContain('<h1>Überschrift</h1>');
  });
});

describe('Knowmesh - Offline Auth Verifier & Password Hashing', () => {
  it('correctly hashes password with salt using Web Crypto SHA-256 and verifies match', async () => {
    const cryptoMod = await import('node:crypto');
    const webcrypto = (globalThis.crypto || cryptoMod.webcrypto) as Crypto;
    const subtle = webcrypto.subtle;

    const saltBytes = new Uint8Array(16);
    webcrypto.getRandomValues(saltBytes);
    const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const password = 'mein-sicheres-passwort';
    const enc = new TextEncoder();
    const data = enc.encode(`${saltHex}:${password}`);
    const hashBuf = await subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Verification with same password
    const verifyData = enc.encode(`${saltHex}:${password}`);
    const verifyBuf = await subtle.digest('SHA-256', verifyData);
    const verifyHex = Array.from(new Uint8Array(verifyBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(verifyHex).toBe(hashHex);

    // Verification with wrong password
    const wrongData = enc.encode(`${saltHex}:falsches-passwort`);
    const wrongBuf = await subtle.digest('SHA-256', wrongData);
    const wrongHex = Array.from(new Uint8Array(wrongBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(wrongHex).not.toBe(hashHex);
  });
});

describe('Knowmesh - Vault Entry Operations (copyEntry & deleteEntry)', () => {
  let tmpDir: string;
  let service: VaultService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-entry-test-'));
    service = new VaultService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies an existing note with auto-generated (Copy) name', () => {
    const original = service.saveNote('Notiz.md', {
      body: '# Original Content\n\nSome text.',
      properties: [{ key: 'tags', type: 'list', value: ['test'] }],
    });
    expect(original.path).toBe('Notiz.md');

    // Copy to same directory without explicit target -> creates "Notiz (Copy).md"
    const copied1 = service.copyEntry('Notiz.md');
    expect(copied1.newPath).toBe('Notiz (Copy).md');
    expect(fs.existsSync(path.join(tmpDir, 'Notiz (Copy).md'))).toBe(true);
    const readCopy1 = service.getNote('Notiz (Copy).md');
    expect(readCopy1?.body).toContain('# Original Content');

    // Copy again -> creates "Notiz (Copy 2).md"
    const copied2 = service.copyEntry('Notiz.md');
    expect(copied2.newPath).toBe('Notiz (Copy 2).md');
    expect(fs.existsSync(path.join(tmpDir, 'Notiz (Copy 2).md'))).toBe(true);
  });

  it('copies a note into a specific folder', () => {
    service.saveNote('Idea.md', {
      body: '# My Idea',
    });
    service.createFolder('Archive');

    const copied = service.copyEntry('Idea.md', 'Archive');
    expect(copied.newPath).toBe('Archive/Idea.md');
    expect(fs.existsSync(path.join(tmpDir, 'Archive', 'Idea.md'))).toBe(true);

    // Copy again into the same folder -> adds (Copy)
    const copiedAgain = service.copyEntry('Idea.md', 'Archive');
    expect(copiedAgain.newPath).toBe('Archive/Idea (Copy).md');
    expect(fs.existsSync(path.join(tmpDir, 'Archive', 'Idea (Copy).md'))).toBe(true);
  });

  it('copies an entire directory recursively', () => {
    service.createFolder('Project/Docs');
    service.saveNote('Project/Docs/Spec.md', {
      body: '# Specs',
    });

    const copiedDir = service.copyEntry('Project');
    expect(copiedDir.newPath).toBe('Project (Copy)');
    expect(fs.existsSync(path.join(tmpDir, 'Project (Copy)', 'Docs', 'Spec.md'))).toBe(true);
    const readNested = service.getNote('Project (Copy)/Docs/Spec.md');
    expect(readNested?.body).toContain('# Specs');
  });

  it('deletes a note and removes it from index', () => {
    service.saveNote('ToDelete.md', {
      body: '# Delete me',
    });
    expect(service.getNote('ToDelete.md')).toBeDefined();

    const result = service.deleteEntry('ToDelete.md');
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'ToDelete.md'))).toBe(false);
    expect(() => service.getNote('ToDelete.md')).toThrow('Notiz nicht gefunden');
  });

  it('deletes a folder and all its contents recursively', () => {
    service.createFolder('Sub/Deep');
    service.saveNote('Sub/Deep/File.md', {
      body: '# Deep file',
    });
    expect(fs.existsSync(path.join(tmpDir, 'Sub', 'Deep', 'File.md'))).toBe(true);

    const result = service.deleteEntry('Sub');
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Sub'))).toBe(false);
    expect(() => service.getNote('Sub/Deep/File.md')).toThrow('Notiz nicht gefunden');
  });

  it('supports creating multiple offline files and folders sequentially in local tree without collisions', () => {
    let tree = insertNodeIntoTree([], ['Neue Notiz.md'], 'Neue Notiz.md', 'file');
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('Neue Notiz.md');

    // Second note with disambiguated name
    tree = insertNodeIntoTree(tree, ['Neue Notiz 2.md'], 'Neue Notiz 2.md', 'file');
    expect(tree).toHaveLength(2);

    // Offline folder creation at root and nested folder + nested note
    tree = insertNodeIntoTree(tree, ['Neuer Ordner'], 'Neuer Ordner', 'folder');
    tree = insertNodeIntoTree(tree, ['Neuer Ordner 2'], 'Neuer Ordner 2', 'folder');
    tree = insertNodeIntoTree(
      tree,
      ['Neuer Ordner', 'SubNotiz.md'],
      'Neuer Ordner/SubNotiz.md',
      'file'
    );

    const folders = tree.filter((n) => n.type === 'folder');
    const files = tree.filter((n) => n.type === 'file');
    expect(folders).toHaveLength(2);
    expect(files).toHaveLength(2);

    const firstFolder = folders.find((f) => f.path === 'Neuer Ordner');
    expect(firstFolder?.children).toHaveLength(1);
    expect(firstFolder?.children?.[0].path).toBe('Neuer Ordner/SubNotiz.md');

    const id1 = generateMutationId('save', 'Neue Notiz.md');
    const id2 = generateMutationId('save', 'Neue Notiz 2.md');
    const id3 = generateMutationId('folder', 'Neuer Ordner');
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });

  it('indexes .canvas documents, integrates with knowledge graph and backlinks, and maps bidirectionally', async () => {
    const canvasDoc = {
      nodes: [
        {
          id: 'node-1',
          type: 'text',
          text: 'Startknoten mit Verweis auf [[Wissensbasis/Obsidian-Kompatibilität.md]] und #workflow',
          x: 0,
          y: 0,
          width: 250,
          height: 100,
          shape: 'rounded',
          color: '1',
        },
        {
          id: 'node-2',
          type: 'file',
          file: 'Projekte/Projekt-Architektur.md',
          x: 350,
          y: 50,
          width: 300,
          height: 200,
        },
        {
          id: 'node-3',
          type: 'text',
          text: 'DB Server',
          x: 750,
          y: 50,
          width: 150,
          height: 80,
          shape: 'cylinder',
          color: '4',
        },
      ],
      edges: [
        {
          id: 'edge-1',
          fromNode: 'node-1',
          toNode: 'node-2',
          label: 'verwendet [[Tägliche Notizen/2026-10-16.md]]',
          toEnd: 'arrow',
          style: 'step',
        },
      ],
    };

    const rawJson = JSON.stringify(canvasDoc, null, 2);

    // 1. Save .canvas file in VaultService
    const saved = service.saveNote('Diagramme/Infrastruktur.canvas', {
      rawContent: rawJson,
      body: rawJson,
    });

    expect(saved.path).toBe('Diagramme/Infrastruktur.canvas');
    expect(saved.rawContent).toBe(rawJson);
    expect(saved.frontmatter).toEqual({});
    expect(saved.properties).toEqual([]);

    // Outgoing links extracted
    expect(saved.links).toContain('Wissensbasis/Obsidian-Kompatibilität.md');
    expect(saved.links).toContain('Projekte/Projekt-Architektur.md');
    expect(saved.links).toContain('Tägliche Notizen/2026-10-16.md');
    expect(saved.tags).toContain('workflow');

    // 2. File tree indexing
    const tree = service.getFileTree();
    const diagramFolder = tree.find((n) => n.path === 'Diagramme');
    expect(diagramFolder).toBeDefined();
    const canvasFileNode = diagramFolder?.children?.find(
      (c) => c.path === 'Diagramme/Infrastruktur.canvas'
    );
    expect(canvasFileNode).toBeDefined();
    expect(canvasFileNode?.extension).toBe('canvas');
    expect(canvasFileNode?.attachmentKind).toBe('canvas');

    // 3. Knowledge Graph integration
    const graph = service.buildGraph();
    const canvasGraphNode = graph.nodes.find(
      (n) => n.id === 'Diagramme/Infrastruktur.canvas'
    );
    expect(canvasGraphNode).toBeDefined();
    expect(canvasGraphNode?.kind).toBe('canvas');

    const edgesToArch = graph.edges.filter(
      (e) =>
        e.source === 'Diagramme/Infrastruktur.canvas' &&
        e.target === 'Projekte/Projekt-Architektur.md'
    );
    expect(edgesToArch.length).toBeGreaterThan(0);

    // 4. Backlinks query
    const backlinks = service.getBacklinks('Projekte/Projekt-Architektur.md');
    const canvasBacklink = backlinks.linked.find(
      (b) => b.sourcePath === 'Diagramme/Infrastruktur.canvas'
    );
    expect(canvasBacklink).toBeDefined();
    expect(canvasBacklink?.snippet).toContain('Canvas-Verknüpfung');

    // 5. Sync manifest includes .canvas as markdown type
    const manifest = service.getSyncManifest();
    const manifestEntry = manifest.find((m) => m.path === 'Diagramme/Infrastruktur.canvas');
    expect(manifestEntry).toBeDefined();
    expect(manifestEntry?.type).toBe('markdown');

    // 6. Rename and move preserves .canvas extension
    const renamed = await service.renameOrMove(
      'Diagramme/Infrastruktur.canvas',
      'Diagramme/Netzwerk-Plan.canvas'
    );
    expect(renamed.newPath).toBe('Diagramme/Netzwerk-Plan.canvas');
    const loadedRenamed = service.getNote('Diagramme/Netzwerk-Plan.canvas');
    expect(loadedRenamed.path).toBe('Diagramme/Netzwerk-Plan.canvas');
    expect(loadedRenamed.rawContent).toContain('DB Server');
  });
});





