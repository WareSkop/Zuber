import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Calendar,
  Globe,
  Info,
  GitBranch,
  Eye,
  EyeOff,
  Upload,
  Type,
  ScrollText,
  Copy,
} from 'lucide-react';
import { version as appVersion } from '../../package.json';
import {
  api,
  getActiveProfile,
  getStoredProfiles,
  saveStoredProfiles,
  setActiveProfile,
} from '../api';
import { syncEngine, type SyncState } from '../sync/syncEngine';
import { clientLogger } from '../utils/logger';
import type {
  FileTreeNode,
  VaultProfile,
  GitConfig,
  GitRemoteConfig,
  GitStatusInfo,
  LogLevel,
  LogEntry,
} from '../../shared/types';
import { useTranslation, type SupportedLanguage } from '../i18n';
import {
  getStartupConfig,
  saveStartupConfig,
  type StartupConfig,
  type StartupBehavior,
  getDailyNoteConfig,
  saveDailyNoteConfig,
  type DailyNoteConfig,
  getMobileReadingDefault,
  setMobileReadingDefault,
} from '../startupConfig';
import {
  getFontSettings,
  saveFontSettings,
  DEFAULT_FONT_SETTINGS,
  applyFontSettingsToDOM,
  type FontSettings,
} from '../fontSettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  fileTree: FileTreeNode[];
  onInstallApp?: () => void;
  isInstalledApp?: boolean;
  onFontSettingsChange?: (settings: FontSettings) => void;
}

type SettingsTab = 'appearance' | 'editor' | 'security' | 'servers' | 'sync' | 'git' | 'logs';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onThemeChange,
  fileTree,
  onInstallApp,
  isInstalledApp = false,
  onFontSettingsChange,
}) => {
  const { t, language, setLanguage } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  // Startup configuration state
  const [startupConfig, setStartupConfigState] = useState<StartupConfig>(getStartupConfig);

  // Daily note configuration state
  const [dailyConfig, setDailyConfigState] = useState<DailyNoteConfig>(getDailyNoteConfig);
  const [mobileReadingDefault, setMobileReadingDefaultState] = useState<boolean>(getMobileReadingDefault);

  // Font settings state
  const [fontSettings, setFontSettings] = useState<FontSettings>(getFontSettings);

  const updateFontSettings = (updater: (prev: FontSettings) => FontSettings) => {
    setFontSettings((prev) => {
      const next = updater(prev);
      saveFontSettings(next);
      applyFontSettingsToDOM(next, typeof window !== 'undefined' && window.innerWidth < 768);
      onFontSettingsChange?.(next);
      return next;
    });
  };

  const handleResetFonts = () => {
    setFontSettings(DEFAULT_FONT_SETTINGS);
    saveFontSettings(DEFAULT_FONT_SETTINGS);
    applyFontSettingsToDOM(DEFAULT_FONT_SETTINGS, typeof window !== 'undefined' && window.innerWidth < 768);
    onFontSettingsChange?.(DEFAULT_FONT_SETTINGS);
  };

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

  // Git state
  const [gitConfig, setGitConfig] = useState<GitConfig>({
    enabled: false,
    userName: 'Zuber Server',
    userEmail: 'zuber@local',
    autoCommitOnClose: true,
    remote: {
      enabled: false,
      url: '',
      username: '',
      token: '',
      branch: 'main',
    },
  });
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitSaving, setGitSaving] = useState(false);
  const [gitSaveMsg, setGitSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [manualCommitMsg, setManualCommitMsg] = useState('');
  const [manualCommitting, setManualCommitting] = useState(false);
  const [commitFeedback, setCommitFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testingRemote, setTestingRemote] = useState(false);
  const [testRemoteFeedback, setTestRemoteFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [pushingGit, setPushingGit] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [showGitToken, setShowGitToken] = useState(false);

  // Logs state
  const [logLevel, setLogLevelState] = useState<LogLevel>(() => clientLogger.getLevel());
  const [logSource, setLogSource] = useState<'all' | 'client' | 'server'>('all');
  const [logFilter, setLogFilter] = useState('');
  const [clientLogs, setClientLogs] = useState<LogEntry[]>(() => clientLogger.getEntries());
  const [serverLogs, setServerLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    setClientLogs(clientLogger.getEntries());
    try {
      const res = await api.getLogs();
      setServerLogs(res.entries);
      setLogLevelState(res.level);
    } catch (err) {
      console.warn('Failed to load server logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
      const unsub = clientLogger.subscribe((entries) => {
        setClientLogs(entries);
      });
      return unsub;
    }
  }, [activeTab, fetchLogs]);

  const handleLogLevelChange = async (newLevel: LogLevel) => {
    setLogLevelState(newLevel);
    clientLogger.setLevel(newLevel);
    try {
      await api.setLogLevel(newLevel);
    } catch (err) {
      console.warn('Failed to update server log level:', err);
    }
  };

  const handleClearLogs = async () => {
    clientLogger.clear();
    setClientLogs([]);
    try {
      await api.clearServerLogs();
      setServerLogs([]);
    } catch (err) {
      console.warn('Failed to clear server logs:', err);
    }
  };

  const filteredLogs = useMemo(() => {
    let list: LogEntry[] = [];
    if (logSource === 'all') {
      list = [...clientLogs, ...serverLogs];
    } else if (logSource === 'client') {
      list = [...clientLogs];
    } else {
      list = [...serverLogs];
    }
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (!logFilter.trim()) return list;
    const q = logFilter.toLowerCase();
    return list.filter((e) =>
      e.message.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.level.toLowerCase().includes(q) ||
      (e.details && e.details.toLowerCase().includes(q))
    );
  }, [clientLogs, serverLogs, logSource, logFilter]);

  const handleCopyLogs = async () => {
    const header = [
      `# Zuber Diagnostics & Log Export`,
      `Generated: ${new Date().toISOString()}`,
      `Zuber Version: v${appVersion}`,
      `Active Theme: ${currentTheme}`,
      `Online Status: ${navigator.onLine ? 'Online' : 'Offline'}`,
      `Active Log Level: ${logLevel.toUpperCase()}`,
      `Filtered Source: ${logSource} (${filteredLogs.length} entries)`,
      `--------------------------------------------------------------------------------`,
      '',
    ].join('\n');

    const formattedBody = filteredLogs.map((e) => {
      const details = e.details ? `\n    ${e.details.replace(/\n/g, '\n    ')}` : '';
      return `[${e.timestamp}] [${e.source.toUpperCase()}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${details}`;
    }).join('\n');

    try {
      await navigator.clipboard.writeText(`${header}\n${formattedBody}`);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2500);
    } catch (err) {
      console.error('Failed to copy logs to clipboard:', err);
    }
  };

  const loadGitInfo = async () => {
    try {
      setGitLoading(true);
      const [cfg, status] = await Promise.all([
        api.getGitConfig().catch(() => null),
        api.getGitStatus().catch(() => null),
      ]);
      if (cfg) {
        setGitConfig({
          ...cfg,
          remote: {
            ...cfg.remote,
            token: '',
          },
        });
      }
      if (status) {
        setGitStatus(status);
      }
    } finally {
      setGitLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setStartupConfigState(getStartupConfig());
    setFontSettings(getFontSettings());

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

    // Load Git configuration & status
    loadGitInfo();

    // Reload startup and daily config
    setStartupConfigState(getStartupConfig());
    setDailyConfigState(getDailyNoteConfig());

    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const updateStartup = (patch: Partial<StartupConfig>) => {
    const updated = { ...startupConfig, ...patch };
    setStartupConfigState(updated);
    saveStartupConfig(updated);
    if (patch.dailyFolder !== undefined && dailyConfig.dailyFolder !== patch.dailyFolder) {
      const updatedDaily = { ...dailyConfig, dailyFolder: patch.dailyFolder };
      setDailyConfigState(updatedDaily);
      saveDailyNoteConfig(updatedDaily);
    }
  };

  const updateDailyConfig = (patch: Partial<DailyNoteConfig>) => {
    const updated = { ...dailyConfig, ...patch };
    setDailyConfigState(updated);
    saveDailyNoteConfig(updated);
    if (patch.dailyFolder !== undefined && startupConfig.dailyFolder !== patch.dailyFolder) {
      const updatedStartup = { ...startupConfig, dailyFolder: patch.dailyFolder };
      setStartupConfigState(updatedStartup);
      saveStartupConfig(updatedStartup);
    }
  };

  const themes = [
    {
      id: 'zuber',
      name: 'Zuber (Standard)',
      desc: 'Dunkles Zuber, Kristall-Gold (#d4af37) & Facetten-Türkis (#29b6c8)',
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

  const handleSaveGitConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setGitSaving(true);
    setGitSaveMsg(null);
    try {
      const payload: Partial<GitConfig> = {
        enabled: gitConfig.enabled,
        userName: gitConfig.userName.trim(),
        userEmail: gitConfig.userEmail.trim(),
        autoCommitOnClose: gitConfig.autoCommitOnClose,
        remote: {
          enabled: gitConfig.remote.enabled,
          url: gitConfig.remote.url.trim(),
          username: gitConfig.remote.username.trim(),
          branch: gitConfig.remote.branch.trim() || 'main',
          ...(gitConfig.remote.token && gitConfig.remote.token.trim().length > 0
            ? { token: gitConfig.remote.token.trim() }
            : {}),
        },
      };
      const updated = await api.saveGitConfig(payload);
      setGitConfig({
        ...updated,
        remote: {
          ...updated.remote,
          token: '',
        },
      });
      setGitSaveMsg({ type: 'ok', text: t('settings.gitConfigSaved') });
      const newStatus = await api.getGitStatus().catch(() => null);
      if (newStatus) setGitStatus(newStatus);
    } catch (err: unknown) {
      setGitSaveMsg({ type: 'err', text: (err as Error).message || 'Fehler beim Speichern der Git-Konfiguration' });
    } finally {
      setGitSaving(false);
    }
  };

  const handleManualCommit = async () => {
    setManualCommitting(true);
    setCommitFeedback(null);
    try {
      const res = await api.commitGit({ reason: manualCommitMsg.trim() || undefined });
      if (res.committed) {
        setCommitFeedback({
          type: 'ok',
          text: t('settings.gitCommitSuccess', { hash: res.commitHash || 'HEAD' }),
        });
        setManualCommitMsg('');
      } else {
        setCommitFeedback({
          type: 'err',
          text: res.message || t('settings.gitNoChanges'),
        });
      }
      const newStatus = await api.getGitStatus().catch(() => null);
      if (newStatus) setGitStatus(newStatus);
    } catch (err: unknown) {
      setCommitFeedback({ type: 'err', text: (err as Error).message || 'Fehler beim Erstellen des Commits' });
    } finally {
      setManualCommitting(false);
    }
  };

  const handleTestRemote = async () => {
    setTestingRemote(true);
    setTestRemoteFeedback(null);
    try {
      const remoteToTest: Partial<GitRemoteConfig> = {
        url: gitConfig.remote.url.trim(),
        username: gitConfig.remote.username.trim(),
        token: gitConfig.remote.token?.trim() || undefined,
        branch: gitConfig.remote.branch.trim() || 'main',
      };
      const res = await api.testGitRemote(remoteToTest);
      setTestRemoteFeedback(res);
    } catch (err: unknown) {
      setTestRemoteFeedback({ success: false, message: (err as Error).message || 'Test fehlgeschlagen' });
    } finally {
      setTestingRemote(false);
    }
  };

  const handlePush = async () => {
    setPushingGit(true);
    setPushFeedback(null);
    try {
      const res = await api.pushGit();
      setPushFeedback(res);
      const newStatus = await api.getGitStatus().catch(() => null);
      if (newStatus) setGitStatus(newStatus);
    } catch (err: unknown) {
      setPushFeedback({ success: false, message: (err as Error).message || 'Push fehlgeschlagen' });
    } finally {
      setPushingGit(false);
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-container settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Navigation Sidebar (Desktop) / Top Header & Horizontal Tabs (Mobile) */}
        <aside className="settings-nav">
          <div className="settings-nav-header">
            <h2>{t('settings.title')}</h2>
            <button
              type="button"
              className="settings-close-btn mobile-only"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X size={20} />
            </button>
          </div>
          <div className="settings-nav-items-wrapper">
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
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'git' ? 'active' : ''}`}
              onClick={() => setActiveTab('git')}
            >
              <GitBranch size={16} />
              <span>{t('settings.tabGit')}</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <ScrollText size={16} />
              <span>{t('settings.tabLogs')}</span>
            </button>
          </div>

          <div className="settings-nav-version">
            <Info size={13} style={{ flexShrink: 0 }} />
            <span>Zuber v{appVersion}</span>
          </div>
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
              {activeTab === 'git' && t('settings.gitTitle')}
            </h3>
            <button
              type="button"
              className="settings-close-btn desktop-only"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
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
                    className={`theme-card ${currentTheme === tItem.id || (tItem.id === 'zuber' && (currentTheme === 'knowmesh' || currentTheme === 'basalt')) ? 'active' : ''}`}
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
                        {(currentTheme === tItem.id || (tItem.id === 'zuber' && (currentTheme === 'knowmesh' || currentTheme === 'basalt'))) && (
                          <Check size={15} className="theme-check-icon" />
                        )}
                      </div>
                      <span className="theme-card-desc">{tItem.desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* About Zuber Section */}
              <div
                style={{
                  marginTop: '28px',
                  padding: '16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <img src="/knowmesh_icon.png" alt="Zuber" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'contain' }} />
                    <span>{t('settings.aboutTitle')}</span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: 'var(--accent-primary)',
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      v{appVersion}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {t('settings.aboutDesc')}
                  </div>
                </div>
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
                            list="daily-folder-options"
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

              {/* Daily Note Settings */}
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
                  <Calendar size={18} style={{ color: 'var(--accent-primary)' }} />
                  <span>{t('settings.dailySection')}</span>
                </h4>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  {t('settings.dailySectionDesc')}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                      {t('settings.dailyFolder')}
                    </label>
                    <input
                      type="text"
                      list="daily-folder-options"
                      placeholder={t('settings.dailyFolderPlaceholder')}
                      value={dailyConfig.dailyFolder}
                      onChange={(e) => updateDailyConfig({ dailyFolder: e.target.value })}
                      style={{
                        width: '100%',
                        maxWidth: '380px',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                    <datalist id="daily-folder-options">
                      {availableFolders.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                      {t('settings.dailyTemplate')}
                    </label>
                    <select
                      value={dailyConfig.templatePath || ''}
                      onChange={(e) => updateDailyConfig({ templatePath: e.target.value })}
                      style={{
                        width: '100%',
                        maxWidth: '380px',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    >
                      <option value="">{t('settings.noTemplate')}</option>
                      {allMdNotes.map((n) => (
                        <option key={n.path} value={n.path}>
                          {n.path}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Mobile Reading Mode Default */}
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '20px',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mobileReadingDefault}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setMobileReadingDefaultState(next);
                      setMobileReadingDefault(next);
                    }}
                  />
                  <span>
                    {t('settings.mobileReadingDefault', 'Open notes in Reading Mode on mobile')}
                  </span>
                </label>
              </div>

              {/* Font Sizes Matrix */}
              <div
                className="font-settings-container"
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Type size={18} style={{ color: 'var(--accent-primary)' }} />
                    <span>{t('settings.fontSettingsHeading')}</span>
                  </h4>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleResetFonts}
                    style={{ fontSize: '11.5px', padding: '4px 8px' }}
                  >
                    <RefreshCw size={12} />
                    <span>{t('settings.fontResetDefaults')}</span>
                  </button>
                </div>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  {t('settings.fontSettingsDesc')}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                  {/* Desktop Column */}
                  <div style={{ background: 'var(--bg-primary)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <strong style={{ display: 'block', fontSize: '13.5px', marginBottom: '12px', color: 'var(--text-primary)' }}>
                      💻 {t('settings.fontDesktopHeading')}
                    </strong>

                    {/* Desktop UI */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                        <span>{t('settings.fontUiLabel')}</span>
                        <span className="font-size-badge" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                          {fontSettings.desktop.uiFontSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="11"
                        max="20"
                        step="1"
                        value={fontSettings.desktop.uiFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateFontSettings((prev) => ({
                            ...prev,
                            desktop: { ...prev.desktop, uiFontSize: val },
                          }));
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        <span>11px</span>
                        <span>Standard: 14px</span>
                        <span>20px</span>
                      </div>
                    </div>

                    {/* Desktop Editor */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                        <span>{t('settings.fontEditorLabel')}</span>
                        <span className="font-size-badge" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                          {fontSettings.desktop.editorFontSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="24"
                        step="1"
                        value={fontSettings.desktop.editorFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateFontSettings((prev) => ({
                            ...prev,
                            desktop: { ...prev.desktop, editorFontSize: val },
                          }));
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        <span>12px</span>
                        <span>Standard: 16px</span>
                        <span>24px</span>
                      </div>
                    </div>
                  </div>

                  {/* Mobile Column */}
                  <div style={{ background: 'var(--bg-primary)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <strong style={{ display: 'block', fontSize: '13.5px', marginBottom: '12px', color: 'var(--text-primary)' }}>
                      📱 {t('settings.fontMobileHeading')}
                    </strong>

                    {/* Mobile UI */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                        <span>{t('settings.fontUiLabel')}</span>
                        <span className="font-size-badge" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                          {fontSettings.mobile.uiFontSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="22"
                        step="1"
                        value={fontSettings.mobile.uiFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateFontSettings((prev) => ({
                            ...prev,
                            mobile: { ...prev.mobile, uiFontSize: val },
                          }));
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        <span>12px</span>
                        <span>Standard: 15px</span>
                        <span>22px</span>
                      </div>
                    </div>

                    {/* Mobile Editor */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                        <span>{t('settings.fontEditorLabel')}</span>
                        <span className="font-size-badge" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                          {fontSettings.mobile.editorFontSize}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="13"
                        max="26"
                        step="1"
                        value={fontSettings.mobile.editorFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateFontSettings((prev) => ({
                            ...prev,
                            mobile: { ...prev.mobile, editorFontSize: val },
                          }));
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        <span>13px</span>
                        <span>Standard: 16px</span>
                        <span>26px</span>
                      </div>
                    </div>
                  </div>
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
                      ? language === 'de' ? 'Zuber ist als eigenständige App eingerichtet' : 'Zuber is installed as a standalone app'
                      : language === 'de' ? 'Zuber als App installieren' : 'Install Zuber as an App'}
                  </strong>
                  <p className="pwa-desc">
                    {isInstalledApp
                      ? language === 'de'
                        ? 'Die App läuft im eigenständigen WebAPK-Fenster mit schnellem Zugriff und Offline-Cache.'
                        : 'The app runs in a standalone window with quick access and offline caching.'
                      : language === 'de'
                        ? 'Installiere Zuber auf deinem Smartphone, Chromebook oder Desktop für sofortigen Start im Flugmodus.'
                        : 'Install Zuber on your phone, Chromebook, or desktop for instant startup in airplane mode.'}
                  </p>
                </div>
                {!isInstalledApp && onInstallApp && (
                  <button
                    type="button"
                    className="pwa-install-btn btn-primary"
                    onClick={onInstallApp}
                  >
                    📲 {language === 'de' ? 'Zuber als App installieren' : 'Install Zuber App'}
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

          {/* TAB 6: Git & Remote Backup */}
          {activeTab === 'git' && (
            <div className="settings-section">
              <p className="settings-desc">{t('settings.gitDesc')}</p>

              <form onSubmit={handleSaveGitConfig} className="git-settings-form">
                {/* 1. Local Git Settings */}
                <div className="settings-subsection">
                  <h4 className="settings-subsection-title">{t('settings.gitLocalHeading')}</h4>
                  <p className="settings-subdesc" style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    {t('settings.gitEnabledDesc')}
                  </p>

                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '14px' }}>
                    <input
                      type="checkbox"
                      checked={gitConfig.enabled}
                      onChange={(e) => setGitConfig({ ...gitConfig, enabled: e.target.checked })}
                    />
                    <strong>{t('settings.gitEnabled')}</strong>
                  </label>

                  {gitConfig.enabled && (
                    <>
                      <div className="form-group-row" style={{ marginBottom: '12px' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label>{t('settings.gitUserName')}</label>
                          <input
                            type="text"
                            value={gitConfig.userName}
                            onChange={(e) => setGitConfig({ ...gitConfig, userName: e.target.value })}
                            placeholder="Zuber User"
                            required
                          />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label>{t('settings.gitUserEmail')}</label>
                          <input
                            type="email"
                            value={gitConfig.userEmail}
                            onChange={(e) => setGitConfig({ ...gitConfig, userEmail: e.target.value })}
                            placeholder="user@local"
                            required
                          />
                        </div>
                      </div>

                      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px' }}>
                        <input
                          type="checkbox"
                          checked={gitConfig.autoCommitOnClose}
                          onChange={(e) => setGitConfig({ ...gitConfig, autoCommitOnClose: e.target.checked })}
                        />
                        <span>{t('settings.gitAutoCommitClose')}</span>
                      </label>

                      {/* Repository Status Card */}
                      <div className="git-status-card">
                        <div className="git-status-header">
                          <strong>{t('settings.gitRepoStatus')}</strong>
                          <span className={`status-pill ${gitStatus?.isRepo ? 'status-ok' : 'status-warn'}`}>
                            {gitStatus?.isRepo ? t('settings.gitRepoInitialized') : t('settings.gitRepoNotInitialized')}
                          </span>
                        </div>

                        {gitStatus && (
                          <div className="git-status-details">
                            <div className="git-status-row">
                              <span className="stat-label">Working Tree:</span>
                              <strong className={gitStatus.clean ? 'text-success' : 'text-warning'}>
                                {gitStatus.clean
                                  ? t('settings.gitWorkingTreeClean')
                                  : t('settings.gitUncommittedChanges', { count: gitStatus.modifiedCount }) +
                                    (gitStatus.untrackedCount > 0 ? `, ${t('settings.gitUntrackedFiles', { count: gitStatus.untrackedCount })}` : '')}
                              </strong>
                            </div>

                            {gitStatus.lastCommit && (
                              <div className="git-commit-info">
                                <span className="stat-label">{t('settings.gitLastCommit')}:</span>
                                <code className="git-hash">{gitStatus.lastCommit.hash}</code>
                                <span className="git-commit-msg">"{gitStatus.lastCommit.message}"</span>
                                <span className="git-commit-meta">({gitStatus.lastCommit.author}, {gitStatus.lastCommit.date})</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Manual Commit Action */}
                        <div className="git-commit-action-row" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            placeholder={t('settings.gitCommitMessagePlaceholder')}
                            value={manualCommitMsg}
                            onChange={(e) => setManualCommitMsg(e.target.value)}
                            style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                          />
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={handleManualCommit}
                            disabled={manualCommitting}
                          >
                            <Check size={14} />
                            <span>{manualCommitting ? t('common.loading') : t('settings.gitCommitNow')}</span>
                          </button>
                        </div>

                        {commitFeedback && (
                          <div className={`form-status-banner ${commitFeedback.type}`} style={{ marginTop: '8px' }}>
                            {commitFeedback.type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
                            <span>{commitFeedback.text}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 2. Remote HTTPS Backup */}
                <div className="settings-subsection" style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 className="settings-subsection-title">{t('settings.gitRemoteHeading')}</h4>

                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '14px' }}>
                    <input
                      type="checkbox"
                      checked={gitConfig.remote.enabled}
                      onChange={(e) =>
                        setGitConfig({
                          ...gitConfig,
                          remote: { ...gitConfig.remote, enabled: e.target.checked },
                        })
                      }
                    />
                    <strong>{t('settings.gitRemoteEnabled')}</strong>
                  </label>

                  {gitConfig.remote.enabled && (
                    <div className="git-remote-fields" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="form-group">
                        <label>{t('settings.gitRemoteUrl')}</label>
                        <input
                          type="url"
                          value={gitConfig.remote.url}
                          onChange={(e) =>
                            setGitConfig({
                              ...gitConfig,
                              remote: { ...gitConfig.remote, url: e.target.value },
                            })
                          }
                          placeholder={t('settings.gitRemoteUrlPlaceholder')}
                          required={gitConfig.remote.enabled}
                        />
                      </div>

                      <div className="form-group-row">
                        <div className="form-group" style={{ flex: 1 }}>
                          <label>{t('settings.gitRemoteUsername')}</label>
                          <input
                            type="text"
                            value={gitConfig.remote.username}
                            onChange={(e) =>
                              setGitConfig({
                                ...gitConfig,
                                remote: { ...gitConfig.remote, username: e.target.value },
                              })
                            }
                            placeholder="z. B. ingo oder git"
                          />
                        </div>

                        <div className="form-group" style={{ flex: 1 }}>
                          <label>{t('settings.gitRemoteBranch')}</label>
                          <input
                            type="text"
                            value={gitConfig.remote.branch}
                            onChange={(e) =>
                              setGitConfig({
                                ...gitConfig,
                                remote: { ...gitConfig.remote, branch: e.target.value },
                              })
                            }
                            placeholder="main"
                            required={gitConfig.remote.enabled}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label>{t('settings.gitRemoteToken')}</label>
                        <div className="input-with-button" style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type={showGitToken ? 'text' : 'password'}
                            value={gitConfig.remote.token || ''}
                            onChange={(e) =>
                              setGitConfig({
                                ...gitConfig,
                                remote: { ...gitConfig.remote, token: e.target.value },
                              })
                            }
                            placeholder={
                              gitConfig.remote.hasToken
                                ? t('settings.gitRemoteTokenSaved')
                                : t('settings.gitRemoteTokenPlaceholder')
                            }
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => setShowGitToken(!showGitToken)}
                            title={showGitToken ? 'Token verbergen' : 'Token anzeigen'}
                            style={{ padding: '6px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                          >
                            {showGitToken ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {gitConfig.remote.hasToken && (
                          <span className="form-hint" style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                            ✓ {t('settings.gitRemoteTokenSaved')}
                          </span>
                        )}
                      </div>

                      {/* Test Connection and Push buttons */}
                      <div className="git-remote-actions" style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleTestRemote}
                          disabled={testingRemote || !gitConfig.remote.url}
                        >
                          <RefreshCw size={14} className={testingRemote ? 'spin' : ''} />
                          <span>{testingRemote ? t('settings.gitTesting') : t('settings.gitTestConnection')}</span>
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handlePush}
                          disabled={pushingGit || !gitConfig.remote.url}
                        >
                          <Upload size={14} className={pushingGit ? 'spin' : ''} />
                          <span>{pushingGit ? t('settings.gitPushing') : t('settings.gitPushNow')}</span>
                        </button>
                      </div>

                      {testRemoteFeedback && (
                        <div
                          className={`form-status-banner ${testRemoteFeedback.success ? 'ok' : 'err'}`}
                          style={{ marginTop: '8px' }}
                        >
                          {testRemoteFeedback.success ? <Check size={14} /> : <AlertCircle size={14} />}
                          <span>{testRemoteFeedback.message}</span>
                        </div>
                      )}

                      {pushFeedback && (
                        <div
                          className={`form-status-banner ${pushFeedback.success ? 'ok' : 'err'}`}
                          style={{ marginTop: '8px' }}
                        >
                          {pushFeedback.success ? <Check size={14} /> : <AlertCircle size={14} />}
                          <span>{pushFeedback.message}</span>
                        </div>
                      )}

                      {gitStatus?.lastPushTime && (
                        <div className="git-last-push-info" style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {t('settings.gitLastPush')}: {new Date(gitStatus.lastPushTime).toLocaleString()}
                          {gitStatus.lastPushError && (
                            <span style={{ color: 'var(--obsidian-red)', display: 'block', marginTop: '2px' }}>
                              Fehler: {gitStatus.lastPushError}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {gitSaveMsg && (
                  <div className={`form-status-banner ${gitSaveMsg.type}`} style={{ marginTop: '16px' }}>
                    {gitSaveMsg.type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
                    <span>{gitSaveMsg.text}</span>
                  </div>
                )}

                <div style={{ marginTop: '20px' }}>
                  <button type="submit" className="btn-primary" disabled={gitSaving}>
                    {gitSaving ? t('common.loading') : t('settings.gitSaveConfig')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Logs & Diagnostics Tab */}
          {activeTab === 'logs' && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h3>{t('settings.logsTitle')}</h3>
                <p className="settings-section-desc">{t('settings.logsDesc')}</p>
              </div>

              {/* Controls Toolbar */}
              <div className="logs-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  {/* Log Level Selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      {t('settings.logsLevel')}:
                    </label>
                    <select
                      value={logLevel}
                      onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
                      className="form-select"
                      style={{
                        padding: '5px 12px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="debug">DEBUG (Ausführlich)</option>
                      <option value="info">INFO (Standard)</option>
                      <option value="warn">WARN (Warnungen)</option>
                      <option value="error">ERROR (Nur Fehler)</option>
                    </select>
                  </div>

                  {/* Actions: Copy, Refresh, Clear */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCopyLogs}
                      title={t('settings.logsCopy')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                    >
                      {copiedLogs ? <Check size={14} style={{ color: 'var(--obsidian-green, #10b981)' }} /> : <Copy size={14} />}
                      <span>{copiedLogs ? t('settings.logsCopied') : t('settings.logsCopy')}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={fetchLogs}
                      disabled={loadingLogs}
                      title={t('settings.logsRefresh')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                    >
                      <RefreshCw size={14} className={loadingLogs ? 'spin' : ''} />
                      <span>{t('settings.logsRefresh')}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleClearLogs}
                      title={t('settings.logsClear')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                    >
                      <Trash2 size={14} />
                      <span>{t('settings.logsClear')}</span>
                    </button>
                  </div>
                </div>

                {/* Filter and Source tabs */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: '6px', padding: '2px', border: '1px solid var(--border-color)' }}>
                    <button
                      type="button"
                      onClick={() => setLogSource('all')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: logSource === 'all' ? 'var(--bg-primary)' : 'transparent',
                        color: logSource === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: logSource === 'all' ? 600 : 400,
                      }}
                    >
                      {t('settings.logsSourceAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogSource('client')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: logSource === 'client' ? 'var(--bg-primary)' : 'transparent',
                        color: logSource === 'client' ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: logSource === 'client' ? 600 : 400,
                      }}
                    >
                      {t('settings.logsSourceClient')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogSource('server')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: logSource === 'server' ? 'var(--bg-primary)' : 'transparent',
                        color: logSource === 'server' ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: logSource === 'server' ? 600 : 400,
                      }}
                    >
                      {t('settings.logsSourceServer')}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    placeholder={t('settings.logsFilterPlaceholder')}
                    style={{
                      flex: 1,
                      minWidth: '200px',
                      padding: '5px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                    }}
                  />

                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {filteredLogs.length} / {clientLogs.length + serverLogs.length}
                  </span>
                </div>
              </div>

              {/* Monospace Log Viewer Container */}
              <div
                className="logs-viewer-box"
                style={{
                  background: 'var(--bg-tertiary, #0d1117)',
                  border: '1px solid var(--border-subtle, #30363d)',
                  borderRadius: '8px',
                  padding: '12px',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  height: '420px',
                  maxHeight: '60vh',
                  overflowY: 'auto',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {filteredLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
                    {t('settings.logsEmpty')}
                  </div>
                ) : (
                  filteredLogs.map((entry) => {
                    const levelColors: Record<LogLevel, string> = {
                      debug: '#8b949e',
                      info: '#58a6ff',
                      warn: '#d29922',
                      error: '#f85149',
                    };
                    const sourceColor = entry.source === 'server' ? '#3fb950' : '#bc8cff';
                    const timeStr = entry.timestamp.split('T')[1]?.replace('Z', '') || entry.timestamp;

                    return (
                      <div key={entry.id} style={{ marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '3px' }}>
                        <span style={{ color: '#6e7681', marginRight: '6px' }}>[{timeStr}]</span>
                        <span style={{ color: sourceColor, fontWeight: 600, marginRight: '6px' }}>[{entry.source.toUpperCase()}]</span>
                        <span style={{ color: levelColors[entry.level], fontWeight: 600, marginRight: '6px' }}>[{entry.level.toUpperCase()}]</span>
                        <span style={{ color: '#e6edf3', opacity: 0.85, marginRight: '8px' }}>[{entry.category}]</span>
                        <span style={{ color: 'var(--text-primary, #c9d1d9)' }}>{entry.message}</span>
                        {entry.details && (
                          <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px', paddingLeft: '16px', wordBreak: 'break-word' }}>
                            {entry.details}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
