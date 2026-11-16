import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  EmailConfig,
  GitConfig,
  GitRemoteConfig,
  ImapConfig,
  LogLevel,
  SmtpConfig,
} from '../shared/types';

export interface ServerConfig {
  authEnabled: boolean;
  passwordHash: string;
  salt: string;
  sessionEpoch: number;
  sessionSecret?: string;
  updatedAt: number;
  git?: GitConfig;
  email?: EmailConfig;
  logLevel?: LogLevel;
}

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), 'server-config.json');

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    fromAddress: '',
    fromName: 'Zuber',
    defaultRecipient: '',
  },
  imap: {
    enabled: false,
    host: '',
    port: 993,
    secure: true,
    username: '',
    password: '',
    mailboxFolder: 'Zuber-Inbox',
    processedFolder: '',
    pollIntervalSeconds: 60,
    maxAttachmentMb: 15,
    lastPollTime: null,
    lastPollError: null,
  },
};

export const DEFAULT_GIT_CONFIG: GitConfig = {
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
    lastPushTime: null,
    lastPushError: null,
  },
};

export class ConfigService {
  private configPath: string;
  private config: ServerConfig;

  constructor(customPath?: string) {
    this.configPath = customPath || process.env.CONFIG_PATH || process.env.SERVER_CONFIG_PATH || DEFAULT_CONFIG_FILE;
    this.config = this.loadOrCreate();
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  private ensureDirExists(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadOrCreate(): ServerConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.authEnabled === 'boolean' && parsed.passwordHash && parsed.salt) {
          if (typeof parsed.sessionEpoch !== 'number') {
            parsed.sessionEpoch = 1;
          }
          if (!parsed.git) {
            parsed.git = { ...DEFAULT_GIT_CONFIG, remote: { ...DEFAULT_GIT_CONFIG.remote } };
          } else {
            parsed.git = {
              ...DEFAULT_GIT_CONFIG,
              ...parsed.git,
              remote: {
                ...DEFAULT_GIT_CONFIG.remote,
                ...(parsed.git.remote || {}),
              },
            };
          }
          if (!parsed.email) {
            parsed.email = {
              smtp: { ...DEFAULT_EMAIL_CONFIG.smtp },
              imap: { ...DEFAULT_EMAIL_CONFIG.imap },
            };
          } else {
            parsed.email = {
              smtp: { ...DEFAULT_EMAIL_CONFIG.smtp, ...(parsed.email.smtp || {}) },
              imap: { ...DEFAULT_EMAIL_CONFIG.imap, ...(parsed.email.imap || {}) },
            };
          }
          if (!parsed.logLevel) {
            parsed.logLevel = 'info';
          }
          if (!parsed.sessionSecret || typeof parsed.sessionSecret !== 'string') {
            parsed.sessionSecret = crypto.randomBytes(32).toString('hex');
            try {
              fs.writeFileSync(this.configPath, JSON.stringify(parsed, null, 2), { encoding: 'utf-8', mode: 0o600 });
            } catch {}
          }
          return parsed as ServerConfig;
        }
      }
    } catch (err) {
      console.warn(`[Zuber] Failed to read ${this.configPath}, creating fresh config:`, err);
    }

    // Create initial config from environment or default password
    const initialPassword =
      process.env.PASSWORD ||
      process.env.ZUBER_PASSWORD ||
      process.env.KNOWMESH_PASSWORD ||
      process.env.OBSIDIAN_WEB_PASSWORD ||
      'zuber';
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(initialPassword, salt);
    const sessionSecret = crypto.randomBytes(32).toString('hex');
    const initialConfig: ServerConfig = {
      authEnabled: process.env.AUTH_ENABLED !== 'false',
      passwordHash,
      salt,
      sessionEpoch: 1,
      sessionSecret,
      updatedAt: Date.now(),
      git: { ...DEFAULT_GIT_CONFIG, remote: { ...DEFAULT_GIT_CONFIG.remote } },
      email: {
        smtp: { ...DEFAULT_EMAIL_CONFIG.smtp },
        imap: { ...DEFAULT_EMAIL_CONFIG.imap },
      },
      logLevel: 'info',
    };

    try {
      this.ensureDirExists();
      fs.writeFileSync(this.configPath, JSON.stringify(initialConfig, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      console.error(`[Zuber] Failed to write initial ${this.configPath}:`, err);
    }

    return initialConfig;
  }

  public getConfig(): ServerConfig {
    return { ...this.config };
  }

  public isForceAuthActive(): boolean {
    return (process.env.FORCE_AUTH ?? 'false').toLowerCase() === 'true';
  }

  public isAuthRequired(): boolean {
    if (this.isForceAuthActive()) {
      return true;
    }
    return this.config.authEnabled;
  }

  public getSessionEpoch(): number {
    return this.config.sessionEpoch || 1;
  }

  public getSessionSecret(): string {
    return process.env.SESSION_SECRET || this.config.sessionSecret || 'zuber-offline-vault-secret-key-change-me-in-prod';
  }

  public verifyPassword(password: string): boolean {
    if (!this.isAuthRequired()) return true;
    const computedHash = this.hashPassword(password, this.config.salt);
    const computedBuf = Buffer.from(computedHash, 'hex');
    const storedBuf = Buffer.from(this.config.passwordHash, 'hex');
    if (computedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  }

  public updateSecurity(authEnabled: boolean, newPassword?: string): void {
    if (this.isForceAuthActive() && !authEnabled) {
      throw new Error('Passwortschutz kann in dieser Umgebung nicht deaktiviert werden (FORCE_AUTH aktiv).');
    }

    let passwordHash = this.config.passwordHash;
    let salt = this.config.salt;
    let sessionEpoch = this.config.sessionEpoch || 1;

    if (newPassword && newPassword.trim().length > 0) {
      salt = crypto.randomBytes(16).toString('hex');
      passwordHash = this.hashPassword(newPassword.trim(), salt);
      // Invalidate existing sessions on password change
      sessionEpoch += 1;
    }

    this.config = {
      ...this.config,
      authEnabled,
      passwordHash,
      salt,
      sessionEpoch,
      updatedAt: Date.now(),
    };

    this.saveConfig();
  }

  public revokeAllSessions(): void {
    this.config.sessionEpoch = (this.config.sessionEpoch || 1) + 1;
    this.config.updatedAt = Date.now();
    this.saveConfig();
  }

  public getGitConfig(): GitConfig {
    if (!this.config.git) {
      this.config.git = { ...DEFAULT_GIT_CONFIG, remote: { ...DEFAULT_GIT_CONFIG.remote } };
    }
    return {
      ...this.config.git,
      remote: { ...this.config.git.remote },
    };
  }

  public getMaskedGitConfig(): GitConfig {
    const git = this.getGitConfig();
    const hasToken = Boolean(git.remote.token && git.remote.token.trim().length > 0);
    return {
      ...git,
      remote: {
        ...git.remote,
        token: undefined,
        hasToken,
      },
    };
  }

  public updateGitConfig(
    newConfig: Partial<Omit<GitConfig, 'remote'>> & { remote?: Partial<GitRemoteConfig> }
  ): GitConfig {
    const current = this.getGitConfig();
    const remoteInput: Partial<GitRemoteConfig> = newConfig.remote || {};

    let token = current.remote.token || '';
    if (typeof remoteInput.token === 'string') {
      if (remoteInput.token.trim().length > 0) {
        token = remoteInput.token.trim();
      } else if (remoteInput.token === '') {
        token = '';
      }
    }

    const updatedGit: GitConfig = {
      enabled: typeof newConfig.enabled === 'boolean' ? newConfig.enabled : current.enabled,
      userName: typeof newConfig.userName === 'string' ? newConfig.userName.trim() : current.userName,
      userEmail: typeof newConfig.userEmail === 'string' ? newConfig.userEmail.trim() : current.userEmail,
      autoCommitOnClose: typeof newConfig.autoCommitOnClose === 'boolean' ? newConfig.autoCommitOnClose : current.autoCommitOnClose,
      remote: {
        enabled: typeof remoteInput.enabled === 'boolean' ? remoteInput.enabled : current.remote.enabled,
        url: typeof remoteInput.url === 'string' ? remoteInput.url.trim() : current.remote.url,
        username: typeof remoteInput.username === 'string' ? remoteInput.username.trim() : current.remote.username,
        token,
        branch: typeof remoteInput.branch === 'string' && remoteInput.branch.trim() ? remoteInput.branch.trim() : (current.remote.branch || 'main'),
        lastPushTime: current.remote.lastPushTime ?? null,
        lastPushError: current.remote.lastPushError ?? null,
      },
    };

    this.config.git = updatedGit;
    this.config.updatedAt = Date.now();
    this.saveConfig();

    return this.getMaskedGitConfig();
  }

  public updateGitRemotePushStatus(lastPushTime: number | null, lastPushError: string | null): void {
    const current = this.getGitConfig();
    current.remote.lastPushTime = lastPushTime;
    current.remote.lastPushError = lastPushError;
    this.config.git = current;
    this.config.updatedAt = Date.now();
    this.saveConfig();
  }

  public getEmailConfig(): EmailConfig {
    if (!this.config.email) {
      this.config.email = {
        smtp: { ...DEFAULT_EMAIL_CONFIG.smtp },
        imap: { ...DEFAULT_EMAIL_CONFIG.imap },
      };
    }
    return {
      smtp: { ...DEFAULT_EMAIL_CONFIG.smtp, ...this.config.email.smtp },
      imap: { ...DEFAULT_EMAIL_CONFIG.imap, ...this.config.email.imap },
    };
  }

  public getMaskedEmailConfig(): EmailConfig {
    const email = this.getEmailConfig();
    const hasSmtpPassword = Boolean(email.smtp.password && email.smtp.password.trim().length > 0);
    const hasImapPassword = Boolean(email.imap.password && email.imap.password.trim().length > 0);
    return {
      smtp: {
        ...email.smtp,
        password: '',
        hasPassword: hasSmtpPassword,
      },
      imap: {
        ...email.imap,
        password: '',
        hasPassword: hasImapPassword,
      },
    };
  }

  public updateEmailConfig(newConfig: {
    smtp?: Partial<SmtpConfig>;
    imap?: Partial<ImapConfig>;
  }): EmailConfig {
    const current = this.getEmailConfig();
    const smtpIn = newConfig.smtp || {};
    const imapIn = newConfig.imap || {};

    // Preserve stored password when empty string / omitted
    const smtpPassword =
      typeof smtpIn.password === 'string' && smtpIn.password.trim().length > 0
        ? smtpIn.password
        : current.smtp.password || '';
    const imapPassword =
      typeof imapIn.password === 'string' && imapIn.password.trim().length > 0
        ? imapIn.password
        : current.imap.password || '';

    const pollInterval =
      typeof imapIn.pollIntervalSeconds === 'number' && Number.isFinite(imapIn.pollIntervalSeconds)
        ? Math.max(30, Math.round(imapIn.pollIntervalSeconds))
        : Math.max(30, current.imap.pollIntervalSeconds || 60);

    const maxAttachMb =
      typeof imapIn.maxAttachmentMb === 'number' && Number.isFinite(imapIn.maxAttachmentMb)
        ? Math.max(1, Math.min(100, Math.round(imapIn.maxAttachmentMb)))
        : current.imap.maxAttachmentMb || 15;

    const updated: EmailConfig = {
      smtp: {
        enabled: typeof smtpIn.enabled === 'boolean' ? smtpIn.enabled : current.smtp.enabled,
        host: typeof smtpIn.host === 'string' ? smtpIn.host.trim() : current.smtp.host,
        port:
          typeof smtpIn.port === 'number' && Number.isFinite(smtpIn.port) && smtpIn.port > 0
            ? Math.round(smtpIn.port)
            : current.smtp.port,
        secure: typeof smtpIn.secure === 'boolean' ? smtpIn.secure : current.smtp.secure,
        username: typeof smtpIn.username === 'string' ? smtpIn.username.trim() : current.smtp.username,
        password: smtpPassword,
        fromAddress:
          typeof smtpIn.fromAddress === 'string' ? smtpIn.fromAddress.trim() : current.smtp.fromAddress,
        fromName:
          typeof smtpIn.fromName === 'string' && smtpIn.fromName.trim()
            ? smtpIn.fromName.trim()
            : current.smtp.fromName || 'Zuber',
        defaultRecipient:
          typeof smtpIn.defaultRecipient === 'string'
            ? smtpIn.defaultRecipient.trim()
            : current.smtp.defaultRecipient || '',
      },
      imap: {
        enabled: typeof imapIn.enabled === 'boolean' ? imapIn.enabled : current.imap.enabled,
        host: typeof imapIn.host === 'string' ? imapIn.host.trim() : current.imap.host,
        port:
          typeof imapIn.port === 'number' && Number.isFinite(imapIn.port) && imapIn.port > 0
            ? Math.round(imapIn.port)
            : current.imap.port,
        secure: typeof imapIn.secure === 'boolean' ? imapIn.secure : current.imap.secure,
        username: typeof imapIn.username === 'string' ? imapIn.username.trim() : current.imap.username,
        password: imapPassword,
        mailboxFolder:
          typeof imapIn.mailboxFolder === 'string' && imapIn.mailboxFolder.trim()
            ? imapIn.mailboxFolder.trim()
            : current.imap.mailboxFolder || 'Zuber-Inbox',
        processedFolder:
          typeof imapIn.processedFolder === 'string'
            ? imapIn.processedFolder.trim()
            : current.imap.processedFolder || '',
        pollIntervalSeconds: pollInterval,
        maxAttachmentMb: maxAttachMb,
        lastPollTime: current.imap.lastPollTime ?? null,
        lastPollError: current.imap.lastPollError ?? null,
      },
    };

    this.config.email = updated;
    this.config.updatedAt = Date.now();
    this.saveConfig();
    return this.getMaskedEmailConfig();
  }

  public updateImapPollStatus(lastPollTime: number | null, lastPollError: string | null): void {
    const current = this.getEmailConfig();
    current.imap.lastPollTime = lastPollTime;
    current.imap.lastPollError = lastPollError;
    this.config.email = current;
    this.config.updatedAt = Date.now();
    this.saveConfig();
  }

  public getLogLevel(): LogLevel {
    return this.config.logLevel || 'info';
  }

  public setLogLevel(level: LogLevel): void {
    this.config.logLevel = level;
    this.config.updatedAt = Date.now();
    this.saveConfig();
  }

  public getConfigDir(): string {
    return path.dirname(this.configPath);
  }

  private saveConfig(): void {
    this.ensureDirExists();
    const tempPath = `${this.configPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tempPath, this.configPath);
  }
}

export const configService = new ConfigService();
