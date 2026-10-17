import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound, Sparkles } from 'lucide-react';

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
      setError((err as Error).message || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <img src="/knowmesh_icon.svg" alt="Knowmesh" style={{ width: 44, height: 44 }} />
          </div>
          <h1>Knowmesh</h1>
          <p className="login-subtitle">
            Offline-First Wissensbasis & Markdown-Editor
          </p>
        </div>

        <div className="security-badge-row">
          <span className={`security-badge ${httpsActive ? 'secure' : 'standard'}`}>
            <ShieldCheck size={15} />
            {httpsActive ? 'TLS / HTTPS Verschlüsselt' : 'Lokale Verbindung'}
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
            <span>Vault-Passwort</span>
          </label>
          <div className="login-input-wrapper">
            <Lock size={16} className="login-input-icon" />
            <input
              id="vault-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort eingeben (Standard: obsidian)"
              autoFocus
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn-primary login-submit" disabled={loading}>
            {loading ? 'Verbinde mit Vault...' : 'Vault entsperren'}
          </button>

          <p className="login-hint">
            Standard-Passwort in <code>.env</code>: <code>obsidian</code>
          </p>
        </form>
      </div>
    </div>
  );
};
