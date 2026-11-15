export const ZENC_MAGIC = 'ZENC0001';
export const LOCK_FILENAME = '.zuber-lock.json';
export const ZENC_EXT = '.zenc';
export const PBKDF2_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const VERIFIER_PLAINTEXT = 'ZUBER_VAULT_OK';

export interface FolderLockMetadata {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  verifier: string;
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this context.');
  }
  return c.subtle;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isZencPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(ZENC_EXT);
}

export function stripZencExt(filePath: string): string {
  return isZencPath(filePath) ? filePath.slice(0, -ZENC_EXT.length) : filePath;
}

export const stripZencExtension = stripZencExt;
export const getEffectivePath = stripZencExt;

export function toZencPath(filePath: string): string {
  return isZencPath(filePath) ? filePath : `${filePath}${ZENC_EXT}`;
}

export function getLogicalExtension(filePath: string): string {
  const logical = stripZencExt(filePath);
  const dotIdx = logical.lastIndexOf('.');
  if (dotIdx === -1) return '';
  return logical.slice(dotIdx + 1).toLowerCase();
}

export function getMimeTypeForPath(filePath: string): string {
  const ext = getLogicalExtension(filePath);
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    case 'pdf':
      return 'application/pdf';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'md':
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'json':
    case 'canvas':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a folder password and 16-byte salt
 * using PBKDF2-HMAC-SHA256 (310,000 iterations).
 */
export async function deriveFolderKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
  extractable = true
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const normalizedPassword = password.normalize('NFC');
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(normalizedPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/**
 * Creates `.zuber-lock.json` metadata and returns the derived folder CryptoKey.
 */
export async function createFolderLockMetadata(
  password: string
): Promise<{ metadata: FolderLockMetadata; key: CryptoKey }> {
  const subtle = getSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveFolderKey(password, salt, PBKDF2_ITERATIONS, true);

  const verifierPlain = new TextEncoder().encode(VERIFIER_PLAINTEXT);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    verifierPlain
  );

  return {
    metadata: {
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      verifier: toBase64(new Uint8Array(cipherBuf)),
    },
    key,
  };
}

/**
 * Verifies a password against `.zuber-lock.json` and returns the unlocked CryptoKey.
 * Throws if the password is incorrect or the metadata is invalid.
 */
export async function verifyFolderPassword(
  password: string,
  metadata: FolderLockMetadata
): Promise<CryptoKey> {
  if (!metadata || metadata.version !== 1 || metadata.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Invalid folder lock metadata.');
  }
  const salt = fromBase64(metadata.salt);
  const iv = fromBase64(metadata.iv);
  const verifierCipher = fromBase64(metadata.verifier);
  const key = await deriveFolderKey(
    password,
    salt,
    metadata.iterations || PBKDF2_ITERATIONS,
    true
  );

  const subtle = getSubtle();
  let decryptedBuf: ArrayBuffer;
  try {
    decryptedBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      verifierCipher as BufferSource
    );
  } catch {
    throw new Error('Incorrect folder password.');
  }

  const text = new TextDecoder().decode(decryptedBuf);
  if (text !== VERIFIER_PLAINTEXT) {
    throw new Error('Incorrect folder password.');
  }
  return key;
}

/**
 * Encrypts arbitrary bytes into the `.zenc` container format:
 * `[8-byte "ZENC0001"][12-byte IV][AES-256-GCM ciphertext + 16-byte auth tag]`
 */
export async function encryptBytes(
  plaintext: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const magic = new TextEncoder().encode(ZENC_MAGIC);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  const out = new Uint8Array(magic.length + iv.length + cipherBytes.length);
  out.set(magic, 0);
  out.set(iv, magic.length);
  out.set(cipherBytes, magic.length + iv.length);
  return out;
}

/**
 * Decrypts a `.zenc` binary container back to raw plaintext bytes.
 */
export async function decryptBytes(
  zencBytes: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  const headerLen = ZENC_MAGIC.length + IV_BYTES;
  if (zencBytes.length < headerLen + 16) {
    throw new Error('Invalid .zenc container: file is too short.');
  }
  const magic = new TextDecoder().decode(zencBytes.subarray(0, ZENC_MAGIC.length));
  if (magic !== ZENC_MAGIC) {
    throw new Error(`Invalid .zenc magic header: ${magic}`);
  }
  const iv = zencBytes.subarray(ZENC_MAGIC.length, headerLen);
  const ciphertext = zencBytes.subarray(headerLen);

  const subtle = getSubtle();
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(plainBuf);
}

export async function encryptText(text: string, key: CryptoKey): Promise<Uint8Array> {
  return encryptBytes(new TextEncoder().encode(text), key);
}

export async function decryptText(zencBytes: Uint8Array, key: CryptoKey): Promise<string> {
  const plain = await decryptBytes(zencBytes, key);
  return new TextDecoder().decode(plain);
}

/**
 * Estimates password strength on a 0..4 scale for UI feedback.
 */
export function evaluatePasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
