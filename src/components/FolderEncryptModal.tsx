import React, { useMemo, useState } from 'react';
import { Fingerprint, Lock, LockOpen, ShieldCheck, X } from 'lucide-react';
import type { FileTreeNode } from '../../shared/types';
import { useTranslation } from '../i18n';
import { api } from '../api';
import {
  LOCK_FILENAME,
  createFolderLockMetadata,
  decryptBytes,
  encryptBytes,
  evaluatePasswordStrength,
  isZencPath,
  stripZencExt,
  toZencPath,
} from '../crypto/folderCrypto';
import { unlockedFoldersStore } from '../crypto/unlockedFoldersStore';
import {
  enrollBiometricForFolder,
  isBiometricAvailable,
  removeBiometricEnrollment,
} from '../crypto/biometricUnlock';

export interface FolderEncryptModalProps {
  isOpen: boolean;
  mode: 'encrypt' | 'decrypt';
  folderPath: string | null;
  tree: FileTreeNode[];
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

function collectFilesInFolder(nodes: FileTreeNode[], targetFolder: string): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  const walk = (items: FileTreeNode[], inside: boolean) => {
    for (const item of items) {
      if (item.type === 'folder') {
        const isTargetOrChild = inside || item.path === targetFolder;
        if (item.children) {
          walk(item.children, isTargetOrChild);
        }
      } else if (inside) {
        result.push(item);
      }
    }
  };
  walk(nodes, false);
  return result;
}

export const FolderEncryptModal: React.FC<FolderEncryptModalProps> = ({
  isOpen,
  mode,
  folderPath,
  tree,
  onClose,
  onCompleted,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const biometricSupported = isBiometricAvailable();

  if (!isOpen || !folderPath) return null;

  const strengthLabel =
    strength <= 1
      ? t('encryption.strengthWeak')
      : strength === 2
        ? t('encryption.strengthFair')
        : strength === 3
          ? t('encryption.strengthGood')
          : t('encryption.strengthStrong');

  const handleEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 4) {
      setError(t('encryption.passwordRequired'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('encryption.passwordMismatch'));
      return;
    }

    setBusy(true);
    try {
      const files = collectFilesInFolder(tree, folderPath).filter(
        (f) => f.name !== LOCK_FILENAME && !isZencPath(f.path)
      );
      setProgress({ done: 0, total: files.length });

      const { metadata, key } = await createFolderLockMetadata(password);
      const lockBytes = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
      await api.uploadRawFile(folderPath, LOCK_FILENAME, lockBytes);

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const plainBytes = await api.downloadRawFile(f.path);
        const encryptedBytes = await encryptBytes(plainBytes, key);
        const zencPath = toZencPath(f.path);
        const slashIdx = zencPath.lastIndexOf('/');
        const parentDir = slashIdx >= 0 ? zencPath.slice(0, slashIdx) : folderPath;
        const fileName = slashIdx >= 0 ? zencPath.slice(slashIdx + 1) : zencPath;
        await api.uploadRawFile(parentDir, fileName, encryptedBytes);
        await api.deleteEntry(f.path);
        setProgress({ done: i + 1, total: files.length });
      }

      unlockedFoldersStore.unlockFolder(folderPath, key);
      if (enableBiometric && biometricSupported) {
        try {
          await enrollBiometricForFolder(folderPath, key);
        } catch {}
      }

      setPassword('');
      setConfirmPassword('');
      await onCompleted();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || 'Encryption failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const key = unlockedFoldersStore.getFolderKey(folderPath);
    if (!key) {
      setError(t('encryption.lockedCardDesc'));
      return;
    }

    setBusy(true);
    try {
      const allFiles = collectFilesInFolder(tree, folderPath);
      const zencFiles = allFiles.filter((f) => isZencPath(f.path));
      setProgress({ done: 0, total: zencFiles.length });

      for (let i = 0; i < zencFiles.length; i++) {
        const f = zencFiles[i];
        const encBytes = await api.downloadRawFile(f.path);
        const plainBytes = await decryptBytes(encBytes, key);
        const plainPath = stripZencExt(f.path);
        const slashIdx = plainPath.lastIndexOf('/');
        const parentDir = slashIdx >= 0 ? plainPath.slice(0, slashIdx) : folderPath;
        const fileName = slashIdx >= 0 ? plainPath.slice(slashIdx + 1) : plainPath;
        await api.uploadRawFile(parentDir, fileName, plainBytes);
        await api.deleteEntry(f.path);
        setProgress({ done: i + 1, total: zencFiles.length });
      }

      try {
        await api.deleteEntry(`${folderPath}/${LOCK_FILENAME}`);
      } catch {}

      unlockedFoldersStore.lockFolder(folderPath);
      await removeBiometricEnrollment(folderPath);
      await onCompleted();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || 'Decryption failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      data-testid="folder-encrypt-modal"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content folder-encrypt-modal">
        <div className="modal-header">
          <div className="modal-title-row">
            {mode === 'encrypt' ? <Lock size={18} /> : <LockOpen size={18} />}
            <h3>
              {mode === 'encrypt'
                ? t('encryption.encryptTitle')
                : t('encryption.decryptTitle')}
            </h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            disabled={busy}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={mode === 'encrypt' ? handleEncrypt : handleDecrypt} className="folder-encrypt-form">
          <div className="folder-encrypt-target">
            <code>{folderPath}/</code>
          </div>
          <p className="settings-desc">
            {mode === 'encrypt'
              ? t('encryption.encryptDesc')
              : t('encryption.decryptDesc')}
          </p>

          {mode === 'encrypt' && (
            <>
              <label className="folder-encrypt-label">
                <span>{t('encryption.passwordLabel')}</span>
                <input
                  type="password"
                  className="base-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoFocus
                  required
                />
              </label>

              {password && (
                <div className="folder-password-strength" data-strength={strength}>
                  <div className="folder-password-strength-bars">
                    {[1, 2, 3, 4].map((lvl) => (
                      <span
                        key={lvl}
                        className={`strength-bar ${strength >= lvl ? 'is-filled' : ''}`}
                      />
                    ))}
                  </div>
                  <span className="strength-label">{strengthLabel}</span>
                </div>
              )}

              <label className="folder-encrypt-label">
                <span>{t('encryption.confirmPasswordLabel')}</span>
                <input
                  type="password"
                  className="base-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>

              {biometricSupported && (
                <label className="folder-biometric-toggle">
                  <input
                    type="checkbox"
                    checked={enableBiometric}
                    onChange={(e) => setEnableBiometric(e.target.checked)}
                    disabled={busy}
                  />
                  <Fingerprint size={16} />
                  <span>{t('encryption.enableBiometric')}</span>
                </label>
              )}
            </>
          )}

          {progress && (
            <div className="folder-encrypt-progress">
              {mode === 'encrypt'
                ? t('encryption.encryptingProgress')
                    .replace('{{done}}', String(progress.done))
                    .replace('{{total}}', String(progress.total))
                : t('encryption.decryptingProgress')
                    .replace('{{done}}', String(progress.done))
                    .replace('{{total}}', String(progress.total))}
            </div>
          )}

          {error && <div className="form-status-banner err">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <ShieldCheck size={16} />
              <span>
                {mode === 'encrypt'
                  ? t('encryption.encryptConfirmBtn')
                  : t('encryption.decryptConfirmBtn')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
