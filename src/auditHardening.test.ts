import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isPrivateOrLocalHostname, checkUrlEmbeddable } from '../server/linkEmbedCheck';
import { VaultService, ensureDemoVaultSeeded } from '../server/vaultService';
import { splitTableCells, parseMarkdownTable, serializeMarkdownTable } from '../shared/markdownTableUtils';
import { searchVaultFiles, searchNotesFullTextOffline } from './utils/mobileSearchUtils';

describe('Audit & Hardening Regression Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SSRF Hardening in /api/link-embed-check', () => {
    it('blocks IPv4-mapped IPv6 loopback and private addresses', () => {
      expect(isPrivateOrLocalHostname('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('[::ffff:127.0.0.1]')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:7f00:0001')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('::ffff:192.168.1.50')).toBe(true);
      expect(isPrivateOrLocalHostname('0:0:0:0:0:0:0:1')).toBe(true);
      expect(isPrivateOrLocalHostname('100.64.0.1')).toBe(true);
      expect(isPrivateOrLocalHostname('93.184.216.34')).toBe(false);
    });

    it('blocks HTTP redirects that point to localhost or private IPs', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url === 'https://public.example.com/redirect-ssrf') {
          return new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:8080/internal' },
          });
        }
        return new Response(null, { status: 200 });
      });

      const res = await checkUrlEmbeddable('https://public.example.com/redirect-ssrf');
      expect(res.embeddable).toBe(false);
      expect(res.reason).toBe('blocked-host');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('VaultService .zuber-lock.json indexing & Demo Vault Seeding protection', () => {
    it('preserves .zuber-lock.json in file tree after rebuildIndex and prevents demo seeding over locked folder markers', () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-audit-vault-'));
      const tmpSeed = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-audit-seed-'));
      try {
        fs.writeFileSync(path.join(tmpSeed, 'Welcome.md'), '# Welcome\n', 'utf-8');
        const secretDir = path.join(tmpRoot, 'Confidential');
        fs.mkdirSync(secretDir, { recursive: true });
        fs.writeFileSync(
          path.join(secretDir, '.zuber-lock.json'),
          JSON.stringify({ version: 1, salt: 'aa', verifier: 'bb' }),
          'utf-8'
        );

        const vs = new VaultService(tmpRoot);
        const tree = vs.getFileTree();
        const folderNode = tree.find((n) => n.name === 'Confidential');
        expect(folderNode).toBeDefined();
        expect(folderNode?.children?.some((c) => c.name === '.zuber-lock.json')).toBe(true);

        // Also test root-level .zuber-lock.json protection against demo seeding
        const tmpLockOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-audit-lockonly-'));
        try {
          fs.writeFileSync(path.join(tmpLockOnly, '.zuber-lock.json'), '{}', 'utf-8');
          const seeded = ensureDemoVaultSeeded(tmpLockOnly, tmpSeed);
          expect(seeded).toBe(false);
          expect(fs.existsSync(path.join(tmpLockOnly, 'Welcome.md'))).toBe(false);
        } finally {
          fs.rmSync(tmpLockOnly, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.rmSync(tmpSeed, { recursive: true, force: true });
      }
    });
  });

  describe('Markdown Table WikiLink with Alias pipe handling', () => {
    it('keeps [[Target|Alias]] intact inside a single table cell and escapes pipe on serialize', () => {
      const cells = splitTableCells('| [[Project Alpha|Alpha]] | Done |');
      expect(cells).toEqual(['[[Project Alpha|Alpha]]', 'Done']);

      const parsed = parseMarkdownTable([
        '| Note | Status |',
        '| --- | --- |',
        '| [[Project Alpha|Alpha]] | Active |',
      ]);
      expect(parsed.rows[0]).toEqual(['[[Project Alpha|Alpha]]', 'Active']);

      const serialized = serializeMarkdownTable(parsed);
      const reparsed = parseMarkdownTable(serialized.split('\n'));
      expect(reparsed.rows[0]).toEqual(['[[Project Alpha|Alpha]]', 'Active']);
    });
  });

  describe('Plaintext search exclusion of .zenc and .zuber-lock.json', () => {
    it('excludes .zuber-lock.json from file search and .zenc from offline full-text search', () => {
      const files = searchVaultFiles(
        [
          { name: '.zuber-lock.json', path: 'Secret/.zuber-lock.json', extension: 'json' },
          { name: 'zuber-guide.md', path: 'zuber-guide.md', extension: 'md' },
        ],
        'zuber'
      );
      expect(files.map((f) => f.path)).toEqual(['zuber-guide.md']);

      const fullText = searchNotesFullTextOffline(
        [
          { path: 'Secret/passwords.md.zenc', name: 'passwords.md.zenc', body: 'topsecret token' },
          { path: 'Public/notes.md', name: 'notes.md', body: 'public topsecret reference' },
        ],
        'topsecret'
      );
      expect(fullText.map((r) => r.path)).toEqual(['Public/notes.md']);
    });
  });
});
