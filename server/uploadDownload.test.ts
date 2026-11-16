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

  it('2b. successfully uploads and downloads files with double dots in filename (not traversal)', async () => {
    const specialFilename = '2 Monster-Wachstumsaktien in der Entstehung  The ..md';
    const specialRelPath = `Notizbuch/Schnelle Notizen/${specialFilename}`;
    const fileContent = '# Monster-Wachstumsaktien\nNotizinhalt';

    const formData = new FormData();
    formData.append('targetFolder', '');
    formData.append('files', new Blob([fileContent], { type: 'text/markdown' }), specialFilename);
    formData.append('paths', JSON.stringify([specialRelPath]));

    const uploadRes = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formData,
    });
    expect(uploadRes.status).toBe(200);
    const uploadData = await uploadRes.json();
    expect(uploadData.success).toBe(true);
    expect(uploadData.paths).toContain(specialRelPath);

    // Verify downloaded content
    const downloadRes = await fetch(`${baseUrl}/api/vault/download?path=${encodeURIComponent(specialRelPath)}`);
    expect(downloadRes.status).toBe(200);
    const text = await downloadRes.text();
    expect(text).toBe(fileContent);
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

  it('6. saves and persists a .canvas note with rawContent via POST /api/vault/note without wiping file content to {}', async () => {
    const canvasPayload = {
      nodes: [
        {
          id: 'node-101',
          type: 'text',
          text: '# Important Architecture Node\n\nConnected to [[Wissensbasis/Obsidian-Kompatibilität.md]]',
          x: 100,
          y: 100,
          width: 250,
          height: 160,
        },
      ],
      edges: [],
    };
    const rawJson = JSON.stringify(canvasPayload, null, 2);

    // Save canvas file via POST /api/vault/note
    const saveRes = await fetch(`${baseUrl}/api/vault/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'Diagramme/SavedArchitecture.canvas',
        rawContent: rawJson,
      }),
    });

    expect(saveRes.status).toBe(200);
    const savedData = await saveRes.json();
    expect(savedData.path).toBe('Diagramme/SavedArchitecture.canvas');
    expect(savedData.rawContent).toBe(rawJson);
    expect(savedData.links).toContain('Wissensbasis/Obsidian-Kompatibilität.md');

    // Verify on disk that the file is NOT {}
    const diskPath = path.join(testVaultDir, 'Diagramme', 'SavedArchitecture.canvas');
    expect(fs.existsSync(diskPath)).toBe(true);
    const diskContent = fs.readFileSync(diskPath, 'utf-8');
    expect(diskContent).not.toBe('{}');
    expect(diskContent).toBe(rawJson);

    // Verify GET /api/vault/note returns the exact content
    const getRes = await fetch(`${baseUrl}/api/vault/note?path=Diagramme/SavedArchitecture.canvas`);
    expect(getRes.status).toBe(200);
    const retrieved = await getRes.json();
    expect(retrieved.rawContent).toBe(rawJson);
    expect(retrieved.body).toBe(rawJson);
  });

  it('7. serves PDF attachments with Content-Type application/pdf and Content-Disposition inline via GET /api/vault/attachment', async () => {
    // Upload a dummy PDF to attachments folder via endpoint so it gets indexed
    const formData = new FormData();
    formData.append('targetFolder', 'attachments');
    formData.append('files', new Blob(['%PDF-1.4 dummy pdf content'], { type: 'application/pdf' }), 'sample-manual.pdf');
    formData.append('paths', JSON.stringify(['sample-manual.pdf']));

    const upRes = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      body: formData,
    });
    expect(upRes.status).toBe(200);

    // Test with ?path=
    const resPath = await fetch(`${baseUrl}/api/vault/attachment?path=attachments/sample-manual.pdf`);
    expect(resPath.status).toBe(200);
    expect(resPath.headers.get('content-type')).toContain('application/pdf');
    expect(resPath.headers.get('content-disposition')).toBe('inline; filename="sample-manual.pdf"');
    const contentPath = await resPath.text();
    expect(contentPath).toBe('%PDF-1.4 dummy pdf content');

    // Test with ?target=
    const resTarget = await fetch(`${baseUrl}/api/vault/attachment?target=sample-manual.pdf`);
    expect(resTarget.status).toBe(200);
    expect(resTarget.headers.get('content-type')).toContain('application/pdf');
    expect(resTarget.headers.get('content-disposition')).toBe('inline; filename="sample-manual.pdf"');
  });

  it('8. packages multiple selected files and folders into a single .zip via POST /api/vault/download-batch and rejects traversal', async () => {
    const batchDir = path.join(testVaultDir, 'BatchFolder');
    fs.mkdirSync(path.join(batchDir, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(batchDir, 'alpha.md'), '# Alpha Note\n', 'utf-8');
    fs.writeFileSync(path.join(batchDir, '.hidden', 'secret.txt'), 'ignore-me', 'utf-8');
    fs.writeFileSync(path.join(testVaultDir, 'standalone.md'), '# Standalone\n', 'utf-8');

    const res = await fetch(`${baseUrl}/api/vault/download-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: ['BatchFolder', 'standalone.md', 'attachments/sample-manual.pdf'],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toContain('zuber-selection.zip');

    const buf = Buffer.from(await res.arrayBuffer());
    // Verify PK zip magic bytes 0x50 0x4b 0x03 0x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);

    const zipStr = buf.toString('latin1');
    expect(zipStr).toContain('BatchFolder/alpha.md');
    expect(zipStr).toContain('standalone.md');
    expect(zipStr).toContain('attachments/sample-manual.pdf');
    expect(zipStr).not.toContain('.hidden/secret.txt');

    // Reject path traversal
    const badRes = await fetch(`${baseUrl}/api/vault/download-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['standalone.md', '../../etc/passwd'] }),
    });
    expect(badRes.status).toBe(400);
  });
});
