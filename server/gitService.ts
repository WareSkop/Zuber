import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitConfig, GitRemoteConfig, GitStatusInfo, GitFileCommit, NoteData } from '../shared/types';
import { ConfigService, configService as defaultConfigService } from './configService';
import type { VaultService } from './vaultService';

const execFileAsync = promisify(execFile);

export class GitService {
  private vaultDir: string;
  private configService: ConfigService;
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(vaultDir: string, configService: ConfigService = defaultConfigService) {
    this.vaultDir = path.resolve(vaultDir);
    this.configService = configService;
  }

  /**
   * Enqueue operations to run sequentially, preventing index.lock collisions.
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(() => fn(), () => fn());
    this.opQueue = next.catch(() => {});
    return next;
  }

  /**
   * Safely execute git with sanitized output to protect credentials.
   */
  private async execGit(
    args: string[],
    tokenToMask?: string
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync('git', args, {
        cwd: this.vaultDir,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          LC_ALL: 'C',
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: this.maskCredentials(result.stdout || '', tokenToMask),
        stderr: this.maskCredentials(result.stderr || '', tokenToMask),
      };
    } catch (err: unknown) {
      const error = err as { message?: string; stdout?: string; stderr?: string };
      const rawMessage = (error.stderr || error.stdout || error.message || String(err));
      const sanitized = this.maskCredentials(rawMessage, tokenToMask);
      throw new Error(sanitized);
    }
  }

  /**
   * Mask URLs containing credentials and raw tokens from messages.
   */
  public maskCredentials(text: string, tokenToMask?: string): string {
    if (!text) return text;
    let out = text.replace(/https?:\/\/([^:]+):([^@]+)@/gi, 'https://***:***@');
    if (tokenToMask && tokenToMask.trim().length > 0) {
      out = out.split(tokenToMask).join('***');
    }
    return out;
  }

  /**
   * Constructs an in-memory authenticated HTTPS URL.
   */
  public buildAuthenticatedUrl(remote: GitRemoteConfig): string {
    if (!remote.url) {
      throw new Error('Keine Remote-URL angegeben.');
    }

    try {
      const parsed = new URL(remote.url);
      if (!parsed.protocol.startsWith('http')) {
        throw new Error('Nur HTTPS- oder HTTP-Remote-URLs werden unterstützt.');
      }

      if (remote.token && remote.token.trim().length > 0) {
        const username = remote.username ? encodeURIComponent(remote.username.trim()) : 'token';
        const token = encodeURIComponent(remote.token.trim());
        parsed.username = username;
        parsed.password = token;
      } else if (remote.username) {
        parsed.username = encodeURIComponent(remote.username.trim());
      }

      return parsed.toString();
    } catch (err: unknown) {
      if (err instanceof Error) {
        throw new Error(`Ungültige Remote-URL: ${err.message}`);
      }
      throw new Error('Ungültige Remote-URL.');
    }
  }

  /**
   * Initializes local git repository in vault if enabled and not yet initialized.
   */
  public async initIfNeeded(): Promise<void> {
    const config = this.configService.getGitConfig();
    if (!config.enabled) return;

    await this.runExclusive(async () => {
      if (!fs.existsSync(this.vaultDir)) {
        fs.mkdirSync(this.vaultDir, { recursive: true });
      }

      const gitDir = path.join(this.vaultDir, '.git');
      const isRepo = fs.existsSync(gitDir);

      if (!isRepo) {
        try {
          await execFileAsync('git', ['init', '-b', 'main'], { cwd: this.vaultDir });
        } catch {
          // Fallback for older git versions that do not support -b
          await execFileAsync('git', ['init'], { cwd: this.vaultDir });
          try {
            await execFileAsync('git', ['checkout', '-b', 'main'], { cwd: this.vaultDir });
          } catch {}
        }

        // Add standard .gitignore if not present
        const gitignorePath = path.join(this.vaultDir, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
          const defaultIgnore = [
            '.DS_Store',
            'Thumbs.db',
            '*~',
            '*.tmp',
            '.trash',
            '',
          ].join('\n');
          fs.writeFileSync(gitignorePath, defaultIgnore, 'utf-8');
        }
      }

      // Configure author identity
      const userName = config.userName || 'Zuber Server';
      const userEmail = config.userEmail || 'zuber@local';

      await execFileAsync('git', ['config', 'user.name', userName], { cwd: this.vaultDir });
      await execFileAsync('git', ['config', 'user.email', userEmail], { cwd: this.vaultDir });

      // Initial commit if empty repo
      if (!isRepo) {
        try {
          await execFileAsync('git', ['add', '-A'], { cwd: this.vaultDir });
          await execFileAsync(
            'git',
            ['commit', '-m', 'chore: initial zuber vault commit', '--allow-empty'],
            { cwd: this.vaultDir }
          );
        } catch {}
      }
    });
  }

  /**
   * Synchronize git identity with config.
   */
  public async syncConfig(): Promise<void> {
    const config = this.configService.getGitConfig();
    if (!config.enabled) return;

    const gitDir = path.join(this.vaultDir, '.git');
    if (!fs.existsSync(gitDir)) {
      await this.initIfNeeded();
      return;
    }

    await this.runExclusive(async () => {
      const userName = config.userName || 'Zuber Server';
      const userEmail = config.userEmail || 'zuber@local';
      await execFileAsync('git', ['config', 'user.name', userName], { cwd: this.vaultDir });
      await execFileAsync('git', ['config', 'user.email', userEmail], { cwd: this.vaultDir });
    });
  }

  /**
   * Get current Git status including modified/untracked files and last commit info.
   */
  public async getStatus(): Promise<GitStatusInfo> {
    const config = this.configService.getGitConfig();
    const gitDir = path.join(this.vaultDir, '.git');
    const isRepo = fs.existsSync(gitDir);

    if (!isRepo) {
      return {
        isRepo: false,
        enabled: config.enabled,
        clean: true,
        modifiedCount: 0,
        untrackedCount: 0,
        lastCommit: null,
        remoteConfigured: Boolean(config.remote?.url),
        lastPushTime: config.remote?.lastPushTime ?? null,
        lastPushError: config.remote?.lastPushError ?? null,
      };
    }

    return this.runExclusive(async () => {
      let modifiedCount = 0;
      let untrackedCount = 0;

      try {
        const { stdout } = await this.execGit(['status', '--porcelain']);
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.startsWith('??')) {
            untrackedCount++;
          } else {
            modifiedCount++;
          }
        }
      } catch {}

      let lastCommit: GitStatusInfo['lastCommit'] = null;
      try {
        const { stdout } = await this.execGit(['log', '-1', '--format=%h%x1f%s%x1f%ai%x1f%an']);
        const parts = stdout.trim().split('\x1f');
        if (parts.length >= 4) {
          lastCommit = {
            hash: parts[0],
            message: parts[1],
            date: parts[2],
            author: parts[3],
          };
        }
      } catch {}

      return {
        isRepo: true,
        enabled: config.enabled,
        clean: modifiedCount === 0 && untrackedCount === 0,
        modifiedCount,
        untrackedCount,
        lastCommit,
        remoteConfigured: Boolean(config.remote?.url),
        lastPushTime: config.remote?.lastPushTime ?? null,
        lastPushError: config.remote?.lastPushError ?? null,
      };
    });
  }

  /**
   * Adds all changes and creates a commit if changes exist.
   */
  public async commit(
    message?: string
  ): Promise<{ committed: boolean; commitHash?: string; message?: string }> {
    const config = this.configService.getGitConfig();
    if (!config.enabled) {
      return { committed: false, message: 'Git ist in den Einstellungen deaktiviert.' };
    }

    const gitDir = path.join(this.vaultDir, '.git');
    if (!fs.existsSync(gitDir)) {
      await this.initIfNeeded();
    }

    return this.runExclusive(async () => {
      // Check status first
      const { stdout: statusOut } = await this.execGit(['status', '--porcelain']);
      const hasChanges = statusOut.trim().length > 0;

      if (!hasChanges) {
        return { committed: false, message: 'Keine Änderungen zum Committen vorhanden.' };
      }

      await this.execGit(['add', '-A']);
      const commitMsg = message && message.trim().length > 0 ? message.trim() : 'auto: update vault';
      await this.execGit(['commit', '-m', commitMsg]);

      let commitHash = '';
      try {
        const { stdout: hashOut } = await this.execGit(['rev-parse', '--short', 'HEAD']);
        commitHash = hashOut.trim();
      } catch {}

      return {
        committed: true,
        commitHash,
        message: commitMsg,
      };
    });
  }

  /**
   * Tests connection to a remote Git repository without changing configuration.
   */
  public async testRemote(
    remoteConfig: GitRemoteConfig
  ): Promise<{ success: boolean; message: string }> {
    if (!remoteConfig.url) {
      return { success: false, message: 'Keine Remote-URL angegeben.' };
    }

    const token = remoteConfig.token;
    try {
      const authUrl = this.buildAuthenticatedUrl(remoteConfig);
      await this.execGit(['ls-remote', '--heads', authUrl], token);
      return {
        success: true,
        message: 'Verbindung zum Remote-Repository erfolgreich hergestellt.',
      };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: this.maskCredentials(rawMsg, token),
      };
    }
  }

  /**
   * Pushes current branch to configured remote HTTPS repository.
   * Auto-commits any uncommitted changes before pushing.
   */
  public async push(): Promise<{ success: boolean; message: string }> {
    const config = this.configService.getGitConfig();
    if (!config.enabled) {
      return { success: false, message: 'Git ist nicht aktiviert.' };
    }

    if (!config.remote?.enabled || !config.remote?.url) {
      return { success: false, message: 'Remote-Backup ist nicht konfiguriert oder deaktiviert.' };
    }

    const branch = config.remote.branch?.trim() || 'main';
    const token = config.remote.token;

    return this.runExclusive(async () => {
      // 1. Commit any pending local changes first
      try {
        const { stdout: statusOut } = await this.execGit(['status', '--porcelain']);
        if (statusOut.trim().length > 0) {
          await this.execGit(['add', '-A']);
          await this.execGit(['commit', '-m', 'auto: pre-push commit']);
        }
      } catch (commitErr) {
        console.warn('[Zuber Git] Pre-push commit note:', commitErr);
      }

      // 2. Push to remote
      try {
        const authUrl = this.buildAuthenticatedUrl(config.remote);
        await this.execGit(['push', '-u', authUrl, branch], token);

        const now = Date.now();
        this.configService.updateGitRemotePushStatus(now, null);
        return {
          success: true,
          message: `Erfolgreich auf Branch „${branch}“ gesichert.`,
        };
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const sanitized = this.maskCredentials(rawMsg, token);
        this.configService.updateGitRemotePushStatus(config.remote.lastPushTime ?? null, sanitized);
        return {
          success: false,
          message: sanitized,
        };
      }
    });
  }

  /**
   * Sanitizes and verifies that a relative path stays within the vault directory.
   */
  public sanitizeRelativePath(relPath: string): string {
    if (!relPath || typeof relPath !== 'string') {
      throw new Error('Ungültiger Dateipfad.');
    }
    const cleaned = relPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const resolved = path.resolve(this.vaultDir, cleaned);
    if (resolved !== this.vaultDir && !resolved.startsWith(this.vaultDir + path.sep)) {
      throw new Error('Ungültiger Dateipfad außerhalb des Vaults.');
    }
    return path.relative(this.vaultDir, resolved).replace(/\\/g, '/');
  }

  /**
   * Retrieves Git commit history for a specific file across renames using --follow.
   */
  public async getFileHistory(relPath: string, limit = 50): Promise<GitFileCommit[]> {
    const config = this.configService.getGitConfig();
    const gitDir = path.join(this.vaultDir, '.git');
    if (!config.enabled || !fs.existsSync(gitDir)) {
      return [];
    }

    const cleanPath = this.sanitizeRelativePath(relPath);
    const safeLimit = Math.max(1, Math.min(limit, 500));

    return this.runExclusive(async () => {
      try {
        const { stdout } = await this.execGit([
          'log',
          '--follow',
          `-n`,
          String(safeLimit),
          '--pretty=format:%H%x1f%h%x1f%aI%x1f%an%x1f%s',
          '--',
          cleanPath,
        ]);

        if (!stdout || stdout.trim().length === 0) {
          return [];
        }

        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const commits: GitFileCommit[] = [];

        for (const line of lines) {
          const parts = line.split('\x1f');
          if (parts.length >= 5) {
            commits.push({
              hash: parts[0],
              shortHash: parts[1],
              date: parts[2],
              author: parts[3],
              message: parts[4],
            });
          }
        }

        return commits;
      } catch {
        return [];
      }
    });
  }

  /**
   * Retrieves full raw file content at a specific historical Git commit.
   * Resolves historical paths if the file was renamed in previous commits.
   */
  public async getFileAtCommit(relPath: string, commitHash: string): Promise<string> {
    const config = this.configService.getGitConfig();
    const gitDir = path.join(this.vaultDir, '.git');
    if (!config.enabled || !fs.existsSync(gitDir)) {
      throw new Error('Git ist nicht initialisiert oder deaktiviert.');
    }

    const cleanPath = this.sanitizeRelativePath(relPath);
    if (!commitHash || !/^[0-9a-f]{7,40}$/i.test(commitHash)) {
      throw new Error('Ungültiger Commit-Hash.');
    }

    return this.runExclusive(async () => {
      // 1. Direct retrieval with cleanPath
      try {
        const { stdout } = await this.execGit(['show', `${commitHash}:${cleanPath}`]);
        return stdout;
      } catch {
        // Direct retrieval failed (likely renamed in past commits)
      }

      // 2. Resolve historical path via git log --follow --name-status
      try {
        const { stdout: logOut } = await this.execGit([
          'log',
          '--follow',
          '--name-status',
          '--format=%H',
          '--',
          cleanPath,
        ]);

        let historicalPath: string | null = null;
        let currentCommit = '';
        const lines = logOut.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (/^[0-9a-f]{40}$/i.test(trimmed)) {
            currentCommit = trimmed;
          } else if (currentCommit.toLowerCase().startsWith(commitHash.toLowerCase()) && trimmed.length > 0) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              // In git rename status R100 oldPath newPath, parts[1] is oldPath
              historicalPath = parts[1];
              break;
            }
          }
        }

        if (historicalPath) {
          const { stdout } = await this.execGit(['show', `${commitHash}:${historicalPath}`]);
          return stdout;
        }
      } catch {}

      throw new Error(`Datei "${cleanPath}" konnte im Commit ${commitHash.slice(0, 7)} nicht gefunden werden.`);
    });
  }

  /**
   * Restores a file to its content at a specific historical commit.
   * Coordinates with VaultService so in-memory index, mtime, and WebSocket clients update atomically.
   */
  public async restoreFileToCommit(
    relPath: string,
    commitHash: string,
    vaultService: VaultService
  ): Promise<NoteData> {
    const cleanPath = this.sanitizeRelativePath(relPath);
    const content = await this.getFileAtCommit(cleanPath, commitHash);

    // Save through VaultService so caches, mtime, and in-memory index update atomically
    const restoredNote = vaultService.saveNote(cleanPath, {
      rawContent: content,
      forceOverwrite: true,
    });

    // Auto-commit restoration if Git is active
    const config = this.configService.getGitConfig();
    if (config.enabled) {
      try {
        await this.commit(`restore: ${cleanPath} to ${commitHash.slice(0, 7)}`);
      } catch (err) {
        console.warn('[Zuber Git] Auto-commit after restore error:', err);
      }
    }

    return restoredNote;
  }
}
