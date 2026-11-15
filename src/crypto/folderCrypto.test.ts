import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
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
  findEncryptedFolderForPath,
  unlockedFoldersStore,
} from './unlockedFoldersStore';

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
