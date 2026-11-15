import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  LOCK_FILENAME,
  ZENC_MAGIC,
  createFolderLockMetadata,
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  evaluatePasswordStrength,
  getLogicalExtension,
  isZencPath,
  stripZencExt,
  toZencPath,
  verifyFolderPassword,
} from './folderCrypto';
import {
  FolderLockedError,
  findEncryptedFolderForPath,
  unlockedFoldersStore,
} from './unlockedFoldersStore';
import {
  collectEncryptedAttachmentCandidates,
  resolveDecryptedAttachmentUrl,
} from './encryptedAttachmentUrl';
import { api, rawApi } from '../api';
import { VaultService } from '../../server/vaultService';
import { createApp } from '../../server/index';
import { configService } from '../../server/configService';

describe('folderCrypto (PBKDF2 + AES-256-GCM .zenc)', () => {
  beforeEach(() => {
    unlockedFoldersStore.lockAllFolders();
  });

  it('roundtrips UTF-8 Markdown content through .zenc container', async () => {
    const { metadata, key } = await createFolderLockMetadata('SuperSecret!2026');
    expect(metadata.version).toBe(1);
    expect(metadata.kdf).toBe('PBKDF2-SHA256');
    expect(metadata.iterations).toBe(310_000);

    const markdown = '# Vertraulich\n\nHallo Welt 🔒 — Umlauts äöüß & [[WikiLink]]\n';
    const encrypted = await encryptText(markdown, key);

    const magic = new TextDecoder().decode(encrypted.subarray(0, ZENC_MAGIC.length));
    expect(magic).toBe(ZENC_MAGIC);
    expect(encrypted.length).toBeGreaterThan(ZENC_MAGIC.length + 12 + 16);

    const unlockedKey = await verifyFolderPassword('SuperSecret!2026', metadata);
    const decrypted = await decryptText(encrypted, unlockedKey);
    expect(decrypted).toBe(markdown);
  });

  it('roundtrips binary PDF/image buffers without corruption', async () => {
    const { key } = await createFolderLockMetadata('BinaryPass#99');
    const binary = new Uint8Array(256);
    for (let i = 0; i < binary.length; i++) {
      binary[i] = i;
    }
    // Simulate PDF header
    binary[0] = 0x25; // %
    binary[1] = 0x50; // P
    binary[2] = 0x44; // D
    binary[3] = 0x46; // F

    const encrypted = await encryptBytes(binary, key);
    const decrypted = await decryptBytes(encrypted, key);
    expect(decrypted).toEqual(binary);
  });

  it('rejects wrong password via .zuber-lock.json verifier', async () => {
    const { metadata } = await createFolderLockMetadata('CorrectHorseBatteryStaple');
    await expect(verifyFolderPassword('WrongPassword', metadata)).rejects.toThrow(
      /Incorrect folder password/i
    );
  });

  it('rejects tampered .zenc ciphertext or invalid magic header', async () => {
    const { key } = await createFolderLockMetadata('TamperTest!1');
    const encrypted = await encryptText('Sensitive note', key);

    const tamperedCipher = new Uint8Array(encrypted);
    tamperedCipher[tamperedCipher.length - 1] ^= 0xff;
    await expect(decryptBytes(tamperedCipher, key)).rejects.toThrow();

    const badMagic = new Uint8Array(encrypted);
    badMagic[0] = 0x58; // 'X'
    await expect(decryptBytes(badMagic, key)).rejects.toThrow(/magic/i);
  });

  it('handles .zenc path helpers and password strength evaluation', () => {
    expect(isZencPath('Private/Note.md.zenc')).toBe(true);
    expect(isZencPath('Private/Note.md')).toBe(false);
    expect(stripZencExt('Private/Note.md.zenc')).toBe('Private/Note.md');
    expect(toZencPath('Private/Note.md')).toBe('Private/Note.md.zenc');
    expect(toZencPath('Private/Note.md.zenc')).toBe('Private/Note.md.zenc');
    expect(getLogicalExtension('Private/invoice.pdf.zenc')).toBe('pdf');
    expect(evaluatePasswordStrength('')).toBe(0);
    expect(evaluatePasswordStrength('Strong!Pass123')).toBe(4);
  });

  it('clears in-memory keys and triggers IndexedDB purge on lock', async () => {
    const { key } = await createFolderLockMetadata('SessionKey#1');
    const purgeSpy = vi.fn();
    const unsub = unlockedFoldersStore.registerPurgeHandler(purgeSpy);

    unlockedFoldersStore.unlockFolder('Finance/2026', key);
    expect(unlockedFoldersStore.isFolderUnlocked('Finance/2026')).toBe(true);
    expect(unlockedFoldersStore.findUnlockedFolderForPath('Finance/2026/tax.md.zenc')?.folderPath).toBe('Finance/2026');
    expect(findEncryptedFolderForPath('Finance/2026/sub/doc.pdf.zenc', ['Finance/2026'])).toBe('Finance/2026');

    unlockedFoldersStore.lockFolder('Finance/2026');
    expect(unlockedFoldersStore.isFolderUnlocked('Finance/2026')).toBe(false);
    expect(unlockedFoldersStore.getFolderKey('Finance/2026')).toBeNull();
    expect(purgeSpy).toHaveBeenCalledWith('Finance/2026');

    unsub();
  });
});

describe('Folder Encryption End-to-End Workflows (.zuber-lock.json, .md.zenc & attachments)', () => {
  let tmpVaultDir: string;
  let server: http.Server;
  let baseUrl: string;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    configService.updateSecurity(false);
    tmpVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-folder-enc-e2e-'));
    const vaultService = new VaultService(tmpVaultDir);
    const app = createApp(vaultService);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('/')) {
        return originalFetch(`${baseUrl}${urlStr}`, init);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    unlockedFoldersStore.lockAllFolders();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tmpVaultDir && fs.existsSync(tmpVaultDir)) {
      fs.rmSync(tmpVaultDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    unlockedFoldersStore.lockAllFolders();
  });

  it('saves and fetches .zuber-lock.json via /api/vault/folder-lock and unlocks passwords including "test", "1234", and NFC/NFD Unicode', async () => {
    fs.mkdirSync(path.join(tmpVaultDir, 'Tresor'), { recursive: true });
    for (const pwd of ['test', '1234', 'Pässwörd!']) {
      const { metadata } = await createFolderLockMetadata(pwd.normalize('NFD'));
      const saved = await rawApi.saveFolderLockMetadata('Tresor', metadata);
      expect(saved.ok).toBe(true);
      expect(saved.path).toBe(`Tresor/${LOCK_FILENAME}`);

      // Verify raw JSON on disk is valid and not mangled by Markdown parsing
      const onDisk = JSON.parse(
        fs.readFileSync(path.join(tmpVaultDir, 'Tresor', LOCK_FILENAME), 'utf-8')
      );
      expect(onDisk.version).toBe(1);
      expect(onDisk.kdf).toBe('PBKDF2-SHA256');
      expect(onDisk.salt).toBe(metadata.salt);

      // Verify GET /api/vault/folder-lock does NOT get rejected as a dotfile (404 regression)
      const fetched = await rawApi.getFolderLockMetadata('Tresor');
      expect(fetched.verifier).toBe(metadata.verifier);

      const derivedKey = await verifyFolderPassword(pwd.normalize('NFC'), fetched);
      expect(derivedKey).toBeDefined();
      await expect(verifyFolderPassword('wrong-pwd', fetched)).rejects.toThrow(/Incorrect folder password/i);
    }
  });

  it('encrypts created/saved notes inside unlocked encrypted folder as .md.zenc and decrypts them transparently', async () => {
    fs.mkdirSync(path.join(tmpVaultDir, 'SecretBox'), { recursive: true });
    const { metadata, key } = await createFolderLockMetadata('test');
    await rawApi.saveFolderLockMetadata('SecretBox', metadata);
    unlockedFoldersStore.unlockFolder('SecretBox', key);

    const saved = await rawApi.saveNote({
      path: 'SecretBox/Diary.md',
      body: '# Confidential Entry\nOnly readable with key.',
      properties: [{ key: 'status', value: 'private', type: 'text' }],
      forceOverwrite: true,
    });

    expect(saved.path).toBe('SecretBox/Diary.md.zenc');
    expect(stripZencExt(saved.path)).toBe('SecretBox/Diary.md');
    expect(saved.body.trim()).toBe('# Confidential Entry\nOnly readable with key.');

    // Verify plaintext file was NEVER written and .md.zenc has ZENC0001 container header
    expect(fs.existsSync(path.join(tmpVaultDir, 'SecretBox', 'Diary.md'))).toBe(false);
    const encDiskPath = path.join(tmpVaultDir, 'SecretBox', 'Diary.md.zenc');
    expect(fs.existsSync(encDiskPath)).toBe(true);
    const rawBytes = fs.readFileSync(encDiskPath);
    expect(rawBytes.subarray(0, ZENC_MAGIC.length).toString('utf-8')).toBe(ZENC_MAGIC);
    expect(rawBytes.toString('utf-8')).not.toContain('Confidential Entry');

    // Re-read while unlocked -> decrypted transparently
    const reopened = await rawApi.getNote('SecretBox/Diary.md.zenc');
    expect(reopened.path).toBe('SecretBox/Diary.md.zenc');
    expect(reopened.body.trim()).toBe('# Confidential Entry\nOnly readable with key.');
    expect(reopened.properties.some((p) => p.key === 'status' && p.value === 'private')).toBe(true);

    // Lock folder -> opening note throws FolderLockedError
    unlockedFoldersStore.lockFolder('SecretBox');
    await expect(rawApi.getNote('SecretBox/Diary.md.zenc')).rejects.toBeInstanceOf(FolderLockedError);
  });

  it('encrypts uploaded attachments inside unlocked folder into <folder>/attachments/*.zenc and decrypts embeds back to valid Blob bytes', async () => {
    fs.mkdirSync(path.join(tmpVaultDir, 'MediaVault'), { recursive: true });
    const { metadata, key } = await createFolderLockMetadata('1234');
    await rawApi.saveFolderLockMetadata('MediaVault', metadata);
    unlockedFoldersStore.unlockFolder('MediaVault', key);

    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const file = new File([pngHeader], 'diagram.png', { type: 'image/png' });

    const uploaded = await api.uploadAttachment(file, 'attachments', 'MediaVault/Note.md.zenc');
    expect(uploaded.path.startsWith('MediaVault/attachments/')).toBe(true);
    expect(uploaded.path.endsWith('.png.zenc')).toBe(true);
    expect(uploaded.wikiEmbed).toMatch(/^!\[\[diagram-\d+\.png\]\]$/);

    // On disk the file is strictly encrypted (.zenc) inside MediaVault/attachments/
    const absAttachment = path.join(tmpVaultDir, uploaded.path);
    expect(fs.existsSync(absAttachment)).toBe(true);
    const diskBytes = fs.readFileSync(absAttachment);
    expect(diskBytes.subarray(0, ZENC_MAGIC.length).toString('utf-8')).toBe(ZENC_MAGIC);
    expect(fs.existsSync(path.join(tmpVaultDir, 'attachments', uploaded.name))).toBe(false);

    // Candidate collection finds <folder>/attachments/<logicalName>.zenc
    const logicalName = uploaded.wikiEmbed!.slice(3, -2);
    const candidates = collectEncryptedAttachmentCandidates(logicalName, 'MediaVault/Note.md.zenc');
    expect(candidates.map((c) => c.zencPath)).toContain(`MediaVault/attachments/${logicalName}.zenc`);

    // Decrypting wiki-embed target returns an object URL whose Blob matches original PNG bytes
    const resolved = await resolveDecryptedAttachmentUrl(logicalName, 'MediaVault/Note.md.zenc');
    expect(resolved).not.toBeNull();
    expect(resolved!.isObjectUrl).toBe(true);
    const blobRes = await originalFetch(resolved!.url);
    const decodedBytes = new Uint8Array(await blobRes.arrayBuffer());
    expect(decodedBytes).toEqual(pngHeader);
    URL.revokeObjectURL(resolved!.url);
  });
});
