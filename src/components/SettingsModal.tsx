import React, { useState, useEffect } from 'react';
import {
  Palette,
  Shield,
  Server,
  CloudDownload,
  X,
  Check,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Trash2,
  Plus,
  Lock,
  Folder,
} from 'lucide-react';
import {
  api,
  getActiveProfile,
  getStoredProfiles,
  saveStoredProfiles,
  setActiveProfile,
} from '../api';
import { syncEngine, type SyncState } from '../sync/syncEngine';
import type { FileTreeNode, VaultProfile } from '../../shared/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  fileTree: FileTreeNode[];
}

type SettingsTab = 'appearance' | 'security' | 'servers' | 'sync';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onThemeChange,
  fileTree,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  // Security state
  const [authEnabled, setAuthEnabled] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [securityStatusMsg, setSecurityStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);

  // Profiles state
  const [profiles, setProfiles] = useState<VaultProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('default');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileUrl, setNewProfileUrl] = useState('');
  const [profileCheckResult, setProfileCheckResult] = useState<{
    profileId: string;
    success: boolean;
    error?: string;
    certUrl?: string;
  } | null>(null);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [stats, setStats] = useState<{ notesCount: number; attachmentsCount: number; approxBytes: number }>({
    notesCount: 0,
    attachmentsCount: 0,
    approxBytes: 0,
  });
  const [syncedFolders, setSyncedFolders] = useState<string[]>(['attachments']);
  const [syncInProgress, setSyncInProgress] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Load security settings
    api.getSecuritySettings()
      .then((res) => setAuthEnabled(res.authEnabled))
      .catch(() => {});

    // Load server profiles
    const profs = getStoredProfiles();
    setProfiles(profs);
    const act = getActiveProfile();
    setActiveProfileId(act.id);

    // Load sync stats & folder config
    syncEngine.getStats().then(setStats);
    syncEngine.getSyncedFolders().then(setSyncedFolders);
    const unsub = syncEngine.subscribe(setSyncState);
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const themes = [
    {
      id: 'knowmesh',
      name: 'Knowmesh (Standard)',
      desc: 'Dunkles Knowmesh, Kristall-Gold (#d4af37) & Facetten-Türkis (#29b6c8)',
      bg: '#0d1117',
      sidebar: '#161c24',
      accent: '#d4af37',
      accentSecondary: '#29b6c8',
      text: '#e6edf3',
    },
    {
      id: 'dark-cold',
      name: 'Dunkel Kalt',
      desc: 'Tiefes Mitternachtsblau (#0f172a) & Eisblau-Akzent (#38bdf8)',
      bg: '#0f172a',
      sidebar: '#1e293b',
      accent: '#38bdf8',
      accentSecondary: '#06b6d4',
      text: '#f1f5f9',
    },
    {
      id: 'dark-warm',
      name: 'Dunkel Warm',
      desc: 'Warmes Espresso-Anthrazit (#1c1917) & Bernstein-Akzent (#f59e0b)',
      bg: '#1c1917',
      sidebar: '#292524',
      accent: '#f59e0b',
      accentSecondary: '#fb923c',
      text: '#f5f5f4',
    },
    {
      id: 'light-cold',
      name: 'Hell Kalt',
      desc: 'Eisweiß (#f8fafc), Schiefergrau & Kobaltblau (#2563eb)',
      bg: '#f8fafc',
      sidebar: '#f1f5f9',
      accent: '#2563eb',
      accentSecondary: '#0ea5e9',
      text: '#0f172a',
    },
    {
      id: 'light-warm',
      name: 'Hell Warm',
      desc: 'Elfenbein-Papier (#fdfbf7), Sepiatext & Bronze-Akzent (#b45309)',
      bg: '#fdfbf7',
      sidebar: '#f5f0e6',
      accent: '#b45309',
      accentSecondary: '#d97706',
      text: '#292524',
    },
  ];

  // Collect folder paths for the checkbox tree
  const getAllFolderPaths = (nodes: FileTreeNode[]): string[] => {
    const list: string[] = [];
    const walk = (items: FileTreeNode[]) => {
      for (const item of items) {
        if (item.type === 'folder') {
          list.push(item.path);
          if (item.children) walk(item.children);
        }
      }
    };
    walk(nodes);
    return list;
  };
  const availableFolders = getAllFolderPaths(fileTree);
  if (!availableFolders.includes('attachments')) {
    availableFolders.unshift('attachments');
  }

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityStatusMsg(null);
    setSecurityLoading(true);
    try {
      await api.updateSecuritySettings({
        currentPassword: currentPassword || undefined,
        authEnabled,
        newPassword: newPassword || undefined,
      });
      setSecurityStatusMsg({ type: 'ok', text: 'Sicherheitseinstellungen erfolgreich gespeichert.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setSecurityStatusMsg({ type: 'err', text: (err as Error).message || 'Fehler beim Speichern' });
    } finally {
      setSecurityLoading(false);
    }
  };

  const handleAddProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || !newProfileUrl.trim()) return;
    const newProf: VaultProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      serverUrl: newProfileUrl.trim().replace(/\/+$/, ''),
    };
    const updated = [...profiles, newProf];
    setProfiles(updated);
    saveStoredProfiles(updated);
    setNewProfileName('');
    setNewProfileUrl('');
  };

  const handleDeleteProfile = (id: string) => {
    if (id === 'default' || profiles.length <= 1) return;
    const updated = profiles.filter((p) => p.id !== id);
    setProfiles(updated);
    saveStoredProfiles(updated);
    if (activeProfileId === id) {
      handleSwitchProfile(updated[0].id);
    }
  };

  const handleSwitchProfile = (id: string) => {
    setActiveProfileId(id);
    setActiveProfile(id);
    syncEngine.switchProfile(id);
  };

  const handleTestConnection = async (profile: VaultProfile) => {
    setProfileCheckResult(null);
    try {
      const targetUrl = `${profile.serverUrl}/api/auth/status`;
      const res = await fetch(targetUrl);
      if (res.ok) {
        setProfileCheckResult({ profileId: profile.id, success: true });
      } else {
        setProfileCheckResult({
          profileId: profile.id,
          success: false,
          error: `Server antwortete mit Status ${res.status}`,
        });
      }
    } catch {
      setProfileCheckResult({
        profileId: profile.id,
        success: false,
        error: 'Verbindung fehlgeschlagen. Falls der Server ein Self-Signed TLS-Zertifikat nutzt, muss es einmalig im Browser bestätigt werden.',
        certUrl: profile.serverUrl,
      });
    }
  };

  const handleToggleFolderSync = async (folder: string) => {
    const next = syncedFolders.includes(folder)
      ? syncedFolders.filter((f) => f !== folder)
      : [...syncedFolders, folder];
    setSyncedFolders(next);
    await syncEngine.setSyncedFolders(next);
  };

  const handleTriggerSync = async () => {
    setSyncInProgress(true);
    try {
      await syncEngine.syncNow();
      const updated = await syncEngine.getStats();
      setStats(updated);
    } finally {
      setSyncInProgress(false);
    }
  };

  const handleClearCache = async () => {
    if (confirm('Möchtest du den gesamten lokalen Offline-Speicher leeren? Gespeicherte Notizen auf dem Server bleiben erhalten.')) {
      await syncEngine.clearCache();
      const updated = await syncEngine.getStats();
      setStats(updated);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="settings-modal">
        {/* Left Navigation Sidebar */}
        <aside className="settings-nav">
          <div className="settings-nav-header">
            <h2>Einstellungen</h2>
          </div>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={16} />
            <span>Darstellung & Themes</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Shield size={16} />
            <span>Sicherheit & Passwort</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'servers' ? 'active' : ''}`}
            onClick={() => setActiveTab('servers')}
          >
            <Server size={16} />
            <span>Vault-Verbindungen</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <CloudDownload size={16} />
            <span>Synchronisation & Offline</span>
          </button>
        </aside>

        {/* Right Content Area */}
        <main className="settings-content scroller">
          <div className="settings-header">
            <h3>
              {activeTab === 'appearance' && 'Darstellung & Farb-Themes'}
              {activeTab === 'security' && 'Sicherheit & Authentifizierung'}
              {activeTab === 'servers' && 'Vault-Verbindungen (Server-Profile)'}
              {activeTab === 'sync' && 'Offline-Speicher & Synchronisation'}
            </h3>
            <button type="button" className="settings-close-btn" onClick={onClose} title="Schließen">
              <X size={18} />
            </button>
          </div>

          {/* TAB 1: Themes */}
          {activeTab === 'appearance' && (
            <div className="settings-section">
              <p className="settings-desc">
                Wähle das passende Farbschema für Knowmesh. Alle Oberflächenelemente, der Editor, der Graph und Icons passen sich sofort an.
              </p>
              <div className="theme-grid">
                {themes.map((t) => (
                  <div
                    key={t.id}
                    className={`theme-card ${currentTheme === t.id || (t.id === 'knowmesh' && currentTheme === 'basalt') ? 'active' : ''}`}
                    onClick={() => onThemeChange(t.id)}
                  >
                    <div className="theme-card-preview" style={{ background: t.bg }}>
                      <div className="preview-sidebar" style={{ background: t.sidebar }}>
                        <div className="preview-dot" style={{ background: t.accent }} />
                      </div>
                      <div className="preview-body">
                        <span className="preview-text" style={{ color: t.text }}>Aa</span>
                        <span className="preview-tag" style={{ background: t.accentSecondary }}>#tag</span>
                      </div>
                    </div>
                    <div className="theme-card-info">
                      <div className="theme-card-header">
                        <strong>{t.name}</strong>
                        {(currentTheme === t.id || (t.id === 'knowmesh' && currentTheme === 'basalt')) && <Check size={15} className="theme-check-icon" />}
                      </div>
                      <span className="theme-card-desc">{t.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Security */}
          {activeTab === 'security' && (
            <div className="settings-section">
              <p className="settings-desc">
                Konfiguriere den Passwortschutz für den Knowmesh-Server. Die Einstellungen werden in <code>server-config.json</code> persistent gespeichert.
              </p>
              <form onSubmit={handleSaveSecurity} className="settings-form">
                <div className="form-toggle-row">
                  <div>
                    <strong>Passwortschutz aktivieren</strong>
                    <p className="form-hint">Wenn deaktiviert, ist der Vault ohne Passwort zugänglich.</p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={authEnabled}
                      onChange={(e) => setAuthEnabled(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>

                {authEnabled && (
                  <>
                    <div className="form-group">
                      <label>Aktuelles Passwort</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Aktuelles Passwort eingeben"
                      />
                    </div>
                    <div className="form-group">
                      <label>Neues Passwort (optional)</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Neues Passwort vergeben"
                      />
                    </div>
                  </>
                )}

                {securityStatusMsg && (
                  <div className={`form-status-banner ${securityStatusMsg.type}`}>
                    {securityStatusMsg.type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
                    <span>{securityStatusMsg.text}</span>
                  </div>
                )}

                <button type="submit" className="btn-primary" disabled={securityLoading}>
                  {securityLoading ? 'Speichere...' : 'Sicherheitseinstellungen speichern'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: Server Profiles */}
          {activeTab === 'servers' && (
            <div className="settings-section">
              <p className="settings-desc">
                Verwalte Verbindungen zu unterschiedlichen Knowmesh-Servern. Auf Chromebooks oder Smartphones kannst du dich direkt mit deinem Heimserver verbinden.
              </p>

              <div className="profile-list">
                {profiles.map((p) => (
                  <div key={p.id} className={`profile-card ${p.id === activeProfileId ? 'active' : ''}`}>
                    <div className="profile-info">
                      <div className="profile-name-row">
                        <strong>{p.name}</strong>
                        {p.id === activeProfileId && <span className="profile-active-badge">Aktiv</span>}
                      </div>
                      <span className="profile-url">{p.serverUrl}</span>
                    </div>

                    <div className="profile-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleTestConnection(p)}
                      >
                        Verbindung prüfen
                      </button>
                      {p.id !== activeProfileId && (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => handleSwitchProfile(p.id)}
                        >
                          Wechseln
                        </button>
                      )}
                      {p.id !== 'default' && (
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => handleDeleteProfile(p.id)}
                          title="Profil löschen"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {profileCheckResult && (
                <div className={`profile-check-box ${profileCheckResult.success ? 'success' : 'warning'}`}>
                  {profileCheckResult.success ? (
                    <>
                      <Check size={16} />
                      <span>Verbindung erfolgreich hergestellt!</span>
                    </>
                  ) : (
                    <div>
                      <div className="profile-warning-header">
                        <AlertCircle size={16} />
                        <strong>Verbindungshinweis</strong>
                      </div>
                      <p>{profileCheckResult.error}</p>
                      {profileCheckResult.certUrl && (
                        <a
                          href={profileCheckResult.certUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="cert-accept-link"
                        >
                          <span>Zertifikat im Browser öffnen & akzeptieren</span>
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleAddProfile} className="add-profile-form">
                <h4>Neue Server-Verbindung hinzufügen</h4>
                <div className="form-group-row">
                  <input
                    type="text"
                    placeholder="Profilname (z. B. Heimserver)"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    required
                  />
                  <input
                    type="url"
                    placeholder="Server-URL (https://mein-server:3443)"
                    value={newProfileUrl}
                    onChange={(e) => setNewProfileUrl(e.target.value)}
                    required
                  />
                  <button type="submit" className="btn-secondary">
                    <Plus size={15} />
                    <span>Hinzufügen</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: Sync & Offline */}
          {activeTab === 'sync' && (
            <div className="settings-section">
              <p className="settings-desc">
                Knowmesh speichert alle Markdown-Notizen und ausgewählte Binärdateien lokal in deiner IndexedDB. Dadurch kannst du unterwegs auch komplett ohne Internetverbindung Notizen lesen, bearbeiten und suchen.
              </p>

              <div className="sync-stats-grid">
                <div className="sync-stat-card">
                  <span className="stat-label">Lokal gecachte Notizen</span>
                  <strong className="stat-value">{stats.notesCount}</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Gecachte Anhänge</span>
                  <strong className="stat-value">{stats.attachmentsCount}</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Geschätzter Speicher</span>
                  <strong className="stat-value">{(stats.approxBytes / (1024 * 1024)).toFixed(2)} MB</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Status</span>
                  <strong className={`stat-value status-${syncState}`}>
                    {syncState === 'synced' && 'Synchronisiert'}
                    {syncState === 'syncing' && 'Synchronisiere...'}
                    {syncState === 'online' && 'Online'}
                    {syncState === 'offline' && 'Offline'}
                    {syncState === 'conflict' && 'Konflikt vorhanden'}
                  </strong>
                </div>
              </div>

              <div className="sync-actions-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTriggerSync}
                  disabled={syncInProgress}
                >
                  <RefreshCw size={15} className={syncInProgress ? 'spin' : ''} />
                  <span>Jetzt vollständig synchronisieren</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleClearCache}
                >
                  <Trash2 size={15} />
                  <span>Lokalen Offline-Cache leeren</span>
                </button>
              </div>

              <div className="folder-sync-selector">
                <h4>Anhänge für Offline-Nutzung vorab herunterladen</h4>
                <p className="form-hint">
                  Wähle die Ordner aus, deren Bilder und Dokumente vollständig für die Offline-Verwendung heruntergeladen werden sollen:
                </p>
                <div className="folder-checkbox-list scroller">
                  {availableFolders.map((f) => (
                    <label key={f} className="folder-checkbox-item">
                      <input
                        type="checkbox"
                        checked={syncedFolders.includes(f)}
                        onChange={() => handleToggleFolderSync(f)}
                      />
                      <Folder size={14} />
                      <span>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
