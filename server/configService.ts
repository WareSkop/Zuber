import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ServerConfig {
  authEnabled: boolean;
  passwordHash: string;
  salt: string;
  updatedAt: number;
}

const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), 'server-config.json');

export class ConfigService {
  private configPath: string;
  private config: ServerConfig;

  constructor(customPath?: string) {
    this.configPath = customPath || process.env.SERVER_CONFIG_PATH || DEFAULT_CONFIG_FILE;
    this.config = this.loadOrCreate();
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  private loadOrCreate(): ServerConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.authEnabled === 'boolean' && parsed.passwordHash && parsed.salt) {
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
      updatedAt: Date.now(),
    };

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Knowmesh] Failed to write initial ${this.configPath}:`, err);
    }

    return initialConfig;
  }

  public getConfig(): ServerConfig {
    return { ...this.config };
  }

  public isAuthRequired(): boolean {
    return this.config.authEnabled;
  }

  public verifyPassword(password: string): boolean {
    if (!this.config.authEnabled) return true;
    const computedHash = this.hashPassword(password, this.config.salt);
    const computedBuf = Buffer.from(computedHash, 'hex');
    const storedBuf = Buffer.from(this.config.passwordHash, 'hex');
    if (computedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  }

  public updateSecurity(authEnabled: boolean, newPassword?: string): void {
    let passwordHash = this.config.passwordHash;
    let salt = this.config.salt;

    if (newPassword && newPassword.trim().length > 0) {
      salt = crypto.randomBytes(16).toString('hex');
      passwordHash = this.hashPassword(newPassword.trim(), salt);
    }

    this.config = {
      authEnabled,
      passwordHash,
      salt,
      updatedAt: Date.now(),
    };

    const tempPath = `${this.configPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.configPath);
  }
}

export const configService = new ConfigService();
