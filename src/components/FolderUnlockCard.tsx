import React, { useEffect, useState } from 'react';
import { Fingerprint, Lock, LockOpen } from 'lucide-react';
import { useTranslation } from '../i18n';
import { api } from '../api';
import { verifyFolderPassword } from '../crypto/folderCrypto';
import { unlockedFoldersStore } from '../crypto/unlockedFoldersStore';
import {
  enrollBiometricForFolder,
  hasBiometricEnrollment,
  isBiometricAvailable,
  unlockWithBiometric,
} from '../crypto/biometricUnlock';

export interface FolderUnlockCardProps {
  folderPath: string;
  onUnlocked: () => void;
}

export const FolderUnlockCard: React.FC<FolderUnlockCardProps> = ({
  folderPath,
  onUnlocked,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [enrollBiometricOnUnlock, setEnrollBiometricOnUnlock] = useState(false);

  const biometricSupported = isBiometricAvailable();

  useEffect(() => {
    let cancelled = false;
    setPassword('');
    setError(null);
    hasBiometricEnrollment(folderPath).then((enrolled) => {
      if (!cancelled) {
        setBiometricEnrolled(enrolled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const metadata = await api.getFolderLockMetadata(folderPath);
      const key = await verifyFolderPassword(password, metadata);
      unlockedFoldersStore.unlockFolder(folderPath, key);
      if (enrollBiometricOnUnlock && biometricSupported && !biometricEnrolled) {
        try {
          await enrollBiometricForFolder(folderPath, key);
        } catch {}
      }
      setPassword('');
      onUnlocked();
    } catch {
      setError(t('encryption.wrongPassword'));
    } finally {
      setBusy(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = await unlockWithBiometric(folderPath);
      if (!key) {
        setError(t('encryption.biometricFailed'));
        return;
      }
      unlockedFoldersStore.unlockFolder(folderPath, key);
      onUnlocked();
    } catch {
      setError(t('encryption.biometricFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="folder-unlock-workspace" data-testid="folder-unlock-card">
      <div className="folder-unlock-card">
        <div className="folder-unlock-icon">
          <Lock size={32} />
        </div>
        <h2>{t('encryption.lockedCardTitle')}</h2>
        <code className="folder-unlock-path">{folderPath}/</code>
        <p>{t('encryption.lockedCardDesc')}</p>

        {biometricEnrolled && (
          <button
            type="button"
            className="btn-secondary folder-biometric-btn"
            data-testid="folder-biometric-unlock-btn"
            disabled={busy}
            onClick={handleBiometricUnlock}
          >
            <Fingerprint size={18} />
            <span>{t('encryption.unlockWithBiometric')}</span>
          </button>
        )}

        <form onSubmit={handlePasswordUnlock} className="folder-unlock-form">
          <input
            type="password"
            className="base-input"
            data-testid="folder-unlock-password-input"
            placeholder={t('encryption.passwordLabel')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoFocus={!biometricEnrolled}
          />

          {biometricSupported && !biometricEnrolled && (
            <label className="folder-biometric-toggle">
              <input
                type="checkbox"
                checked={enrollBiometricOnUnlock}
                onChange={(e) => setEnrollBiometricOnUnlock(e.target.checked)}
                disabled={busy}
              />
              <Fingerprint size={15} />
              <span>{t('encryption.enableBiometric')}</span>
            </label>
          )}

          {error && <div className="form-status-banner err">{error}</div>}

          <button
            type="submit"
            className="btn-primary folder-unlock-submit"
            disabled={busy || !password}
          >
            <LockOpen size={16} />
            <span>{t('encryption.unlockBtn')}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
