import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import { useTranslation } from '../i18n';

interface LoginModalProps {
  httpsActive: boolean;
  vaultPath: string;
  onLogin: (password: string) => Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  httpsActive,
  vaultPath,
  onLogin,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onLogin(password);
    } catch (err) {
      setError((err as Error).message || t('login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <img src="/knowmesh_icon.svg" alt="Knowmesh" style={{ width: 44, height: 44 }} />
          </div>
          <h1>Knowmesh</h1>
          <p className="login-subtitle">
            {t('login.subtitle')}
          </p>
        </div>

        <div className="security-badge-row">
          <span className={`security-badge ${httpsActive ? 'secure' : 'standard'}`}>
            <ShieldCheck size={15} />
            {isOffline
              ? t('login.offlineMode')
              : httpsActive
              ? t('login.secureTls')
              : t('login.localConnection')}
          </span>
          {vaultPath && (
            <span className="vault-path-badge" title={vaultPath}>
              Vault: {vaultPath.split('/').slice(-2).join('/')}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="vault-password" className="login-label">
            <KeyRound size={15} />
            <span>{t('login.vaultPassword')}</span>
          </label>
          <div className="login-input-wrapper">
            <Lock size={16} className="login-input-icon" />
            <input
              id="vault-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              autoFocus
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn-primary login-submit" disabled={loading}>
            {loading ? t('login.connecting') : t('login.unlock')}
          </button>

          <p className="login-hint">
            {t('login.envHint')}
          </p>
        </form>
      </div>
    </div>
  );
};
