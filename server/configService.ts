import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { GitConfig, GitRemoteConfig } from '../shared/types';

export interface ServerConfig {
  authEnabled: boolean;
  passwordHash: string;
  salt: string;
  sessionEpoch: number;
  updatedAt: number;
  git?: GitConfig;
}

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), 'server-config.json');

export const DEFAULT_GIT_CONFIG: GitConfig = {
  enabled: false,
  userName: 'Knowmesh Server',
  userEmail: 'knowmesh@local',
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
          return parsed as ServerConfig;
        }
      }
    } catch (err) {
      console.warn(`[Knowmesh] Failed to read ${this.configPath}, creating fresh config:`, err);
    }

    // Create initial config from environment or default password
    const initialPassword = process.env.KNOWMESH_PASSWORD || process.env.OBSIDIAN_WEB_PASSWORD || 'knowmesh';
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(initialPassword, salt);
    const initialConfig: ServerConfig = {
      authEnabled: process.env.AUTH_ENABLED !== 'false',
      passwordHash,
      salt,
      sessionEpoch: 1,
      updatedAt: Date.now(),
      git: { ...DEFAULT_GIT_CONFIG, remote: { ...DEFAULT_GIT_CONFIG.remote } },
    };

    try {
      this.ensureDirExists();
      fs.writeFileSync(this.configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Knowmesh] Failed to write initial ${this.configPath}:`, err);
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

  private saveConfig(): void {
    this.ensureDirExists();
    const tempPath = `${this.configPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.configPath);
  }
}

export const configService = new ConfigService();
