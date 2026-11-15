import { fromBase64, toBase64 } from './folderCrypto';
import { normalizeFolderPath } from './unlockedFoldersStore';

const BIOMETRIC_DB_NAME = 'zuber_biometric_keys';
const BIOMETRIC_STORE_NAME = 'folder_keys';
const BIOMETRIC_DB_VERSION = 1;

interface StoredBiometricKeyRecord {
  folderPath: string;
  credentialIdBase64: string;
  rawKeyBase64: string;
  createdAt: number;
}

export function isBiometricAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return Boolean(
    window.PublicKeyCredential &&
      typeof navigator !== 'undefined' &&
      navigator.credentials &&
      typeof navigator.credentials.create === 'function' &&
      typeof navigator.credentials.get === 'function'
  );
}

function openBiometricDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const req = indexedDB.open(BIOMETRIC_DB_NAME, BIOMETRIC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BIOMETRIC_STORE_NAME)) {
        db.createObjectStore(BIOMETRIC_STORE_NAME, { keyPath: 'folderPath' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open biometric DB.'));
  });
}

async function getRecord(folderPath: string): Promise<StoredBiometricKeyRecord | null> {
  const db = await openBiometricDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readonly');
    const store = tx.objectStore(BIOMETRIC_STORE_NAME);
    const req = store.get(normalizeFolderPath(folderPath));
    req.onsuccess = () => {
      resolve((req.result as StoredBiometricKeyRecord | undefined) ?? null);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function putRecord(record: StoredBiometricKeyRecord): Promise<void> {
  const db = await openBiometricDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BIOMETRIC_STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function deleteRecord(folderPath: string): Promise<void> {
  const db = await openBiometricDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BIOMETRIC_STORE_NAME);
    const req = store.delete(normalizeFolderPath(folderPath));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function hasBiometricEnrollment(folderPath: string): Promise<boolean> {
  if (!isBiometricAvailable()) return false;
  try {
    const rec = await getRecord(folderPath);
    return Boolean(rec && rec.credentialIdBase64 && rec.rawKeyBase64);
  } catch {
    return false;
  }
}

export async function removeBiometricEnrollment(folderPath: string): Promise<void> {
  try {
    await deleteRecord(folderPath);
  } catch {}
}

/**
 * Registers a device-local WebAuthn platform credential (Fingerprint / Face ID / Windows Hello)
 * and stores the exported AES-GCM folder key material in browser IndexedDB bound to that credential.
 */
export async function enrollBiometricForFolder(
  folderPath: string,
  key: CryptoKey
): Promise<boolean> {
  if (!isBiometricAvailable()) {
    throw new Error('Biometric WebAuthn unlock is not available on this device.');
  }
  const normalized = normalizeFolderPath(folderPath);
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(`zuber:${normalized}`).slice(0, 64);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Zuber' },
      user: {
        id: userId,
        name: normalized,
        displayName: normalized,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    return false;
  }

  const rawKeyBuf = await globalThis.crypto.subtle.exportKey('raw', key);
  const credIdBytes = new Uint8Array(credential.rawId);

  await putRecord({
    folderPath: normalized,
    credentialIdBase64: toBase64(credIdBytes),
    rawKeyBase64: toBase64(new Uint8Array(rawKeyBuf)),
    createdAt: Date.now(),
  });
  return true;
}

/**
 * Prompts the device platform authenticator via `navigator.credentials.get` and,
 * upon successful biometric verification, restores the AES-GCM folder `CryptoKey`.
 */
export async function unlockWithBiometric(folderPath: string): Promise<CryptoKey | null> {
  if (!isBiometricAvailable()) return null;
  const record = await getRecord(folderPath);
  if (!record) return null;

  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const credId = fromBase64(record.credentialIdBase64);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: credId as BufferSource,
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      timeout: 60_000,
    },
  });

  if (!assertion) return null;

  const rawKeyBytes = fromBase64(record.rawKeyBase64);
  return globalThis.crypto.subtle.importKey(
    'raw',
    rawKeyBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}
