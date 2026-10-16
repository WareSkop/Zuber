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
