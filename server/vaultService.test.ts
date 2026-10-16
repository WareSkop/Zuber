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

describe('Obsidian Web Vault - Markdown & Frontmatter Utils', () => {
  it('parses frontmatter into visual properties and separates body from YAML', () => {
    const raw = `---
tags:
  - obsidian
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
    expect(tagsProp?.value).toEqual(['obsidian', 'wissen']);

    const favProp = parsed.properties.find((p) => p.key === 'favorit');
    expect(favProp?.type).toBe('checkbox');
    expect(favProp?.value).toBe(true);

    const dateProp = parsed.properties.find((p) => p.key === 'erstellt');
    expect(dateProp?.type).toBe('date');

    const { links, embeds } = extractLinksAndEmbeds(parsed.body);
    expect(links).toEqual(['Zweite Notiz']);
    expect(embeds).toEqual(['diagramm.svg']);

    const allTags = extractTags(parsed.properties, parsed.body);
    expect(allTags).toEqual(['obsidian', 'wissen', 'inlineTag']);
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

describe('VaultService & Graph Builder', () => {
  let tmpDir: string;
  let service: VaultService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-test-'));
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

  it('auto-generates self-signed TLS credentials for HTTPS', () => {
    const tls = ensureTlsCredentials(tmpDir);
    expect(tls.isSelfSigned).toBe(true);
    expect(tls.cert).toContain('BEGIN CERTIFICATE');
    expect(tls.key).toContain('BEGIN PRIVATE KEY');
  });
});
