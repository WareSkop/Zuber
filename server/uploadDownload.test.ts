import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { VaultService } from './vaultService';
import { createApp } from './index';
import { configService } from './configService';

describe('Knowmesh - Upload & Download Endpoints (Multi-file, Directory structure & ZIP stream)', () => {
  let testVaultDir: string;
  let vaultService: VaultService;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Disable auth for simplified API testing
    configService.updateSecurity(false);

    // Create temporary vault in os.tmpdir() - CRITICAL RULE: Never touch user vault
    testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-updown-test-'));
    vaultService = new VaultService(testVaultDir);

    const app = createApp(vaultService);
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (testVaultDir && fs.existsSync(testVaultDir)) {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
    }
  });

  it('1. successfully uploads multiple files and preserves directory structure', async () => {
    const formData = new FormData();
    formData.append('targetFolder', 'ImportedProject');

    const file1 = new Blob(['# Hello World\nContent of doc 1'], { type: 'text/markdown' });
    const file2 = new Blob(['{"nodes":[],"edges":[]}'], { type: 'application/json' });
    const file3 = new Blob(['Nested sub-note content'], { type: 'text/markdown' });

    formData.append('files', file1, 'doc1.md');
    formData.append('files', file2, 'workflow.canvas');
    formData.append('files', file3, 'sub.md');

    // Specify relative paths preserving subfolder structure
    const paths = ['doc1.md', 'workflow.canvas', 'nested/sub.md'];
    formData.append('paths', JSON.stringify(paths));

    const res = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(3);
    expect(data.paths).toEqual([
      'ImportedProject/doc1.md',
      'ImportedProject/workflow.canvas',
      'ImportedProject/nested/sub.md',
    ]);

    // Verify files exist in temporary vault on disk
    const absDoc1 = path.join(testVaultDir, 'ImportedProject', 'doc1.md');
    const absWorkflow = path.join(testVaultDir, 'ImportedProject', 'workflow.canvas');
    const absSub = path.join(testVaultDir, 'ImportedProject', 'nested', 'sub.md');

    expect(fs.existsSync(absDoc1)).toBe(true);
    expect(fs.readFileSync(absDoc1, 'utf-8')).toBe('# Hello World\nContent of doc 1');

    expect(fs.existsSync(absWorkflow)).toBe(true);
    expect(fs.readFileSync(absWorkflow, 'utf-8')).toBe('{"nodes":[],"edges":[]}');

    expect(fs.existsSync(absSub)).toBe(true);
    expect(fs.readFileSync(absSub, 'utf-8')).toBe('Nested sub-note content');
  });

  it('2. strictly rejects path traversal on upload', async () => {
    // Case A: malicious relative path with ..
    const formDataA = new FormData();
    formDataA.append('targetFolder', 'SafeFolder');
    formDataA.append('files', new Blob(['evil'], { type: 'text/plain' }), 'evil.txt');
    formDataA.append('paths', JSON.stringify(['../../evil.txt']));

    const resA = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formDataA,
    });
    expect(resA.status).toBe(400);
    const dataA = await resA.json();
    expect(dataA.error).toContain('Ungültiger Dateipfad');

    // Case B: malicious targetFolder with ..
    const formDataB = new FormData();
    formDataB.append('targetFolder', '../EscapeVault');
    formDataB.append('files', new Blob(['evil'], { type: 'text/plain' }), 'file.txt');

    const resB = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formDataB,
    });
    expect(resB.status).toBe(400);
    const dataB = await resB.json();
    expect(dataB.error).toContain('Ungültiger Zielordner');

    // Case C: leading slash or absolute path
    const formDataC = new FormData();
    formDataC.append('targetFolder', '/root/target');
    formDataC.append('files', new Blob(['evil'], { type: 'text/plain' }), 'file.txt');

    const resC = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formDataC,
    });
    expect(resC.status).toBe(400);
  });

  it('3. downloads a single file with correct content and headers', async () => {
    const res = await fetch(`${baseUrl}/api/vault/download?path=ImportedProject/doc1.md`);
    expect(res.status).toBe(200);

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('doc1.md');

    const text = await res.text();
    expect(text).toBe('# Hello World\nContent of doc 1');
  });

  it('4. downloads a directory as streaming ZIP archive and excludes dotfiles', async () => {
    // Create dotfiles that must be excluded from zip archive
    const hiddenDir = path.join(testVaultDir, 'ImportedProject', '.git');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'config'), 'dummy git config');
    fs.writeFileSync(path.join(testVaultDir, 'ImportedProject', '.DS_Store'), 'junk');

    const res = await fetch(`${baseUrl}/api/vault/download?path=ImportedProject`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('ImportedProject.zip');

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate ZIP magic bytes: PK\x03\x04 (0x50, 0x4b, 0x03, 0x04)
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // Verify excluded files are not present in the zip header/entries
    const rawZipString = buffer.toString('binary');
    expect(rawZipString).toContain('doc1.md');
    expect(rawZipString).toContain('workflow.canvas');
    expect(rawZipString).not.toContain('.git/config');
    expect(rawZipString).not.toContain('.DS_Store');
  });

  it('5. returns 404 for non-existent path and 400 for path traversal on download', async () => {
    // 404 for missing
    const resMissing = await fetch(`${baseUrl}/api/vault/download?path=NonExistentFolder`);
    expect(resMissing.status).toBe(404);

    // 400 for path traversal
    const resTraversal = await fetch(`${baseUrl}/api/vault/download?path=../package.json`);
    expect(resTraversal.status).toBe(400);
  });
});
