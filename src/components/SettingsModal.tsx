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
  FileText,
  Globe,
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
import { useTranslation, type SupportedLanguage } from '../i18n';
import {
  getStartupConfig,
  saveStartupConfig,
  type StartupConfig,
  type StartupBehavior,
} from '../startupConfig';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  fileTree: FileTreeNode[];
  onInstallApp?: () => void;
  isInstalledApp?: boolean;
}

type SettingsTab = 'appearance' | 'editor' | 'security' | 'servers' | 'sync';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onThemeChange,
  fileTree,
  onInstallApp,
  isInstalledApp = false,
}) => {
  const { t, language, setLanguage } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  // Startup configuration state
  const [startupConfig, setStartupConfigState] = useState<StartupConfig>(getStartupConfig);

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

    setStartupConfigState(getStartupConfig());

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

  const updateStartup = (patch: Partial<StartupConfig>) => {
    const updated = { ...startupConfig, ...patch };
    setStartupConfigState(updated);
    saveStartupConfig(updated);
  };

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

  const getAllMdNotes = (nodes: FileTreeNode[]): { path: string; name: string }[] => {
    const list: { path: string; name: string }[] = [];
    const walk = (items: FileTreeNode[]) => {
      for (const item of items) {
        if (item.type === 'file' && item.extension === 'md') {
          list.push({ path: item.path, name: item.name });
        } else if (item.type === 'folder' && item.children) {
          walk(item.children);
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

  const allMdNotes = getAllMdNotes(fileTree);

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
      setSecurityStatusMsg({ type: 'ok', text: t('settings.securitySaved') });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setSecurityStatusMsg({ type: 'err', text: (err as Error).message || t('common.error') });
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
          error: `Server status ${res.status}`,
        });
      }
    } catch {
      setProfileCheckResult({
        profileId: profile.id,
        success: false,
        error: language === 'de'
          ? 'Verbindung fehlgeschlagen. Falls der Server ein Self-Signed TLS-Zertifikat nutzt, muss es einmalig im Browser bestätigt werden.'
          : 'Connection failed. If the server uses a self-signed TLS certificate, it must be approved in the browser once.',
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
    const confirmMsg = language === 'de'
      ? 'Lokalen Offline-Cache wirklich leeren? Alle Notizen werden beim nächsten Serverkontakt neu geladen.'
      : 'Really clear offline cache? All notes will be reloaded on next server sync.';
    if (confirm(confirmMsg)) {
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
            <h2>{t('settings.title')}</h2>
          </div>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={16} />
            <span>{t('settings.tabAppearance')}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            <FileText size={16} />
            <span>{t('settings.tabEditor')}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Shield size={16} />
            <span>{t('settings.tabSecurity')}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'servers' ? 'active' : ''}`}
            onClick={() => setActiveTab('servers')}
          >
            <Server size={16} />
            <span>{t('settings.tabServers')}</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <CloudDownload size={16} />
            <span>{t('settings.tabSync')}</span>
          </button>
        </aside>

        {/* Right Content Area */}
        <main className="settings-content scroller">
          <div className="settings-header">
            <h3>
              {activeTab === 'appearance' && t('settings.appearanceTitle')}
              {activeTab === 'editor' && t('settings.editorTitle')}
              {activeTab === 'security' && t('settings.securityTitle')}
              {activeTab === 'servers' && t('settings.serversTitle')}
              {activeTab === 'sync' && t('settings.syncTitle')}
            </h3>
            <button type="button" className="settings-close-btn" onClick={onClose} title={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          {/* TAB 1: Appearance & Language */}
          {activeTab === 'appearance' && (
            <div className="settings-section">
              {/* Language Selection */}
              <div className="settings-language-picker" style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '10px' }}>
                  <Globe size={16} style={{ color: 'var(--accent-primary)' }} />
                  <span>{t('settings.languageLabel')}</span>
                </label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className={`btn-secondary ${language === 'en' ? 'active-lang' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: language === 'en' ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: language === 'en' ? 'var(--bg-active)' : 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontWeight: language === 'en' ? 600 : 400,
                      cursor: 'pointer',
                    }}
                    onClick={() => setLanguage('en')}
                  >
                    <span>🇬🇧</span>
                    <span>{t('settings.langEn')}</span>
                    {language === 'en' && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                  </button>
                  <button
                    type="button"
                    className={`btn-secondary ${language === 'de' ? 'active-lang' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: language === 'de' ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: language === 'de' ? 'var(--bg-active)' : 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontWeight: language === 'de' ? 600 : 400,
                      cursor: 'pointer',
                    }}
                    onClick={() => setLanguage('de')}
                  >
                    <span>🇩🇪</span>
                    <span>{t('settings.langDe')}</span>
                    {language === 'de' && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                  </button>
                </div>
              </div>

              <p className="settings-desc">{t('settings.appearanceDesc')}</p>
              <div className="theme-grid">
                {themes.map((tItem) => (
                  <div
                    key={tItem.id}
                    className={`theme-card ${currentTheme === tItem.id || (tItem.id === 'knowmesh' && currentTheme === 'basalt') ? 'active' : ''}`}
                    onClick={() => onThemeChange(tItem.id)}
                  >
                    <div className="theme-card-preview" style={{ background: tItem.bg }}>
                      <div className="preview-sidebar" style={{ background: tItem.sidebar }}>
                        <div className="preview-dot" style={{ background: tItem.accent }} />
                      </div>
                      <div className="preview-body">
                        <span className="preview-text" style={{ color: tItem.text }}>Aa</span>
                        <span className="preview-tag" style={{ background: tItem.accentSecondary }}>#tag</span>
                      </div>
                    </div>
                    <div className="theme-card-info">
                      <div className="theme-card-header">
                        <strong>{tItem.name}</strong>
                        {(currentTheme === tItem.id || (tItem.id === 'knowmesh' && currentTheme === 'basalt')) && (
                          <Check size={15} className="theme-check-icon" />
                        )}
                      </div>
                      <span className="theme-card-desc">{tItem.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Editor & Files */}
          {activeTab === 'editor' && (
            <div className="settings-section">
              <p className="settings-desc">{t('settings.editorDesc')}</p>

              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '20px',
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} style={{ color: 'var(--accent-primary)' }} />
                  <span>{t('settings.startupHeading')}</span>
                </h4>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  {t('settings.startupDesc')}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Option 1: Last active */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="startupBehavior"
                      checked={startupConfig.behavior === 'last'}
                      onChange={() => updateStartup({ behavior: 'last' })}
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px' }}>{t('settings.startupLast')}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('settings.startupLastDesc')}</span>
                    </div>
                  </label>

                  {/* Option 2: Daily note */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="startupBehavior"
                      checked={startupConfig.behavior === 'daily'}
                      onChange={() => updateStartup({ behavior: 'daily' })}
                      style={{ marginTop: '3px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '14px' }}>{t('settings.startupDaily')}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('settings.startupDailyDesc')}</span>
                      {startupConfig.behavior === 'daily' && (
                        <div style={{ marginTop: '10px' }}>
                          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                            {t('settings.startupDailyFolder')}
                          </label>
                          <input
                            type="text"
                            placeholder={t('settings.startupDailyFolderPlaceholder')}
                            value={startupConfig.dailyFolder || ''}
                            onChange={(e) => updateStartup({ dailyFolder: e.target.value })}
                            style={{
                              width: '100%',
                              maxWidth: '340px',
                              padding: '6px 10px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </label>

                  {/* Option 3: Specific note */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="startupBehavior"
                      checked={startupConfig.behavior === 'specific'}
                      onChange={() => updateStartup({ behavior: 'specific' })}
                      style={{ marginTop: '3px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block', fontSize: '14px' }}>{t('settings.startupSpecific')}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('settings.startupSpecificDesc')}</span>
                      {startupConfig.behavior === 'specific' && (
                        <div style={{ marginTop: '10px' }}>
                          <select
                            value={startupConfig.specificNotePath || ''}
                            onChange={(e) => updateStartup({ specificNotePath: e.target.value })}
                            style={{
                              width: '100%',
                              maxWidth: '340px',
                              padding: '6px 10px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                            }}
                          >
                            <option value="" disabled>
                              {t('settings.startupSpecificPlaceholder')}
                            </option>
                            {allMdNotes.map((n) => (
                              <option key={n.path} value={n.path}>
                                {n.path}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Security */}
          {activeTab === 'security' && (
            <div className="settings-section">
              <p className="settings-desc">{t('settings.securityDesc')}</p>
              <form onSubmit={handleSaveSecurity} className="settings-form">
                <div className="form-toggle-row">
                  <div>
                    <strong>{t('settings.authEnabled')}</strong>
                    <p className="form-hint">
                      {language === 'de'
                        ? 'Wenn deaktiviert, ist der Vault ohne Passwort zugänglich.'
                        : 'If disabled, the vault is accessible without a password.'}
                    </p>
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
                      <label>{t('settings.currentPassword')}</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder={t('settings.currentPassword')}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('settings.newPassword')}</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={t('settings.newPassword')}
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
                  {securityLoading ? t('common.loading') : t('settings.saveSecurity')}
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: Server Profiles */}
          {activeTab === 'servers' && (
            <div className="settings-section">
              <p className="settings-desc">{t('settings.serversDesc')}</p>

              <div className="profile-list">
                {profiles.map((p) => (
                  <div key={p.id} className={`profile-card ${p.id === activeProfileId ? 'active' : ''}`}>
                    <div className="profile-info">
                      <div className="profile-name-row">
                        <strong>{p.name}</strong>
                        {p.id === activeProfileId && <span className="profile-active-badge">{t('settings.activeProfile')}</span>}
                      </div>
                      <span className="profile-url">{p.serverUrl}</span>
                    </div>

                    <div className="profile-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleTestConnection(p)}
                      >
                        {t('settings.testConnection')}
                      </button>
                      {p.id !== activeProfileId && (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => handleSwitchProfile(p.id)}
                        >
                          {t('settings.switchToProfile')}
                        </button>
                      )}
                      {p.id !== 'default' && profiles.length > 1 && (
                        <button
                          type="button"
                          className="btn-icon-danger btn-sm"
                          onClick={() => handleDeleteProfile(p.id)}
                          title={t('common.delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {profileCheckResult && profileCheckResult.profileId === p.id && (
                      <div className={`profile-check-banner ${profileCheckResult.success ? 'ok' : 'err'}`}>
                        {profileCheckResult.success ? (
                          <>
                            <Check size={14} />
                            <span>{language === 'de' ? 'Verbindung erfolgreich hergestellt.' : 'Connection established successfully.'}</span>
                          </>
                        ) : (
                          <div>
                            <div className="banner-msg">
                              <AlertCircle size={14} />
                              <span>{profileCheckResult.error}</span>
                            </div>
                            {profileCheckResult.certUrl && (
                              <a
                                href={profileCheckResult.certUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="cert-link"
                              >
                                <span>{language === 'de' ? 'Zertifikat im Browser aufrufen' : 'Open certificate in browser'}</span>
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add New Profile Form */}
              <form onSubmit={handleAddProfile} className="add-profile-form">
                <h4>{t('settings.addServer')}</h4>
                <div className="form-row">
                  <input
                    type="text"
                    placeholder={t('settings.serverName')}
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    required
                  />
                  <input
                    type="url"
                    placeholder={t('settings.serverUrl')}
                    value={newProfileUrl}
                    onChange={(e) => setNewProfileUrl(e.target.value)}
                    required
                  />
                  <button type="submit" className="btn-secondary">
                    <Plus size={15} />
                    <span>{t('common.confirm')}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 5: Sync & Offline */}
          {activeTab === 'sync' && (
            <div className="settings-section">
              <p className="settings-desc">{t('settings.syncDesc')}</p>

              <div className="pwa-install-banner">
                <div className="pwa-install-info">
                  <div className="pwa-badge">
                    {isInstalledApp ? '✅ App' : '📲 WebAPK & Desktop PWA'}
                  </div>
                  <strong className="pwa-title">
                    {isInstalledApp
                      ? language === 'de' ? 'Knowmesh ist als eigenständige App eingerichtet' : 'Knowmesh is installed as a standalone app'
                      : language === 'de' ? 'Knowmesh als App installieren' : 'Install Knowmesh as an App'}
                  </strong>
                  <p className="pwa-desc">
                    {isInstalledApp
                      ? language === 'de'
                        ? 'Die App läuft im eigenständigen WebAPK-Fenster mit schnellem Zugriff und Offline-Cache.'
                        : 'The app runs in a standalone window with quick access and offline caching.'
                      : language === 'de'
                        ? 'Installiere Knowmesh auf deinem Smartphone, Chromebook oder Desktop für sofortigen Start im Flugmodus.'
                        : 'Install Knowmesh on your phone, Chromebook, or desktop for instant startup in airplane mode.'}
                  </p>
                </div>
                {!isInstalledApp && onInstallApp && (
                  <button
                    type="button"
                    className="pwa-install-btn btn-primary"
                    onClick={onInstallApp}
                  >
                    📲 {language === 'de' ? 'Knowmesh als App installieren' : 'Install Knowmesh App'}
                  </button>
                )}
              </div>

              <div className="sync-stats-grid">
                <div className="sync-stat-card">
                  <span className="stat-label">{t('settings.notesCached')}</span>
                  <strong className="stat-value">{stats.notesCount}</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">{t('settings.attachmentsCached')}</span>
                  <strong className="stat-value">{stats.attachmentsCount}</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">{t('settings.storageUsed')}</span>
                  <strong className="stat-value">{(stats.approxBytes / (1024 * 1024)).toFixed(2)} MB</strong>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Status</span>
                  <strong className={`stat-value status-${syncState}`}>
                    {syncState === 'synced' && (language === 'de' ? 'Synchronisiert' : 'Synced')}
                    {syncState === 'syncing' && t('common.syncing')}
                    {syncState === 'online' && t('common.online')}
                    {syncState === 'offline' && t('common.offline')}
                    {syncState === 'conflict' && (language === 'de' ? 'Konflikt' : 'Conflict')}
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
                  <span>{t('settings.syncNow')}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleClearCache}
                >
                  <Trash2 size={15} />
                  <span>{t('settings.clearCache')}</span>
                </button>
              </div>

              <div className="folder-sync-selector">
                <h4>{t('settings.syncedFolders')}</h4>
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
