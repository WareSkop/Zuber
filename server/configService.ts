import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ServerConfig {
  authEnabled: boolean;
  passwordHash: string;
  salt: string;
  sessionEpoch: number;
  updatedAt: number;
}

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), 'server-config.json');

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
          return parsed as ServerConfig;
        }
      }
    } catch (err) {
      console.warn(`[Knowmesh] Failed to read ${this.configPath}, creating fresh config:`, err);
    }

    // Create initial config from environment or default password
    const initialPassword = process.env.OBSIDIAN_WEB_PASSWORD || 'obsidian';
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(initialPassword, salt);
    const initialConfig: ServerConfig = {
      authEnabled: process.env.AUTH_ENABLED !== 'false',
      passwordHash,
      salt,
      sessionEpoch: 1,
      updatedAt: Date.now(),
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

  private saveConfig(): void {
    this.ensureDirExists();
    const tempPath = `${this.configPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.configPath);
  }
}

export const configService = new ConfigService();
