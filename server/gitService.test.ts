import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from './configService';
import { GitService } from './gitService';
import type { GitRemoteConfig } from '../shared/types';

describe('GitService & ConfigService Git Integration', () => {
  let tempDir: string;
  let vaultDir: string;
  let configPath: string;
  let configService: ConfigService;
  let gitService: GitService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-git-test-'));
    vaultDir = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });
    configPath = path.join(tempDir, 'server.config.json');
    configService = new ConfigService(configPath);
    gitService = new GitService(vaultDir, configService);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('ConfigService Git Settings', () => {
    it('returns default git config', () => {
      const cfg = configService.getGitConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.userName).toBe('Knowmesh Server');
      expect(cfg.autoCommitOnClose).toBe(true);
      expect(cfg.remote.branch).toBe('main');
    });

    it('updates git config and preserves existing token when omitted', () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'Tester',
        remote: {
          enabled: true,
          url: 'https://codeberg.org/user/repo.git',
          username: 'user',
          token: 'secret-token-123',
          branch: 'main',
        },
      });

      const masked = configService.getMaskedGitConfig();
      expect(masked.userName).toBe('Tester');
      expect(masked.remote.hasToken).toBe(true);
      expect(masked.remote.token).toBeUndefined();

      // Update without token must keep the old token
      configService.updateGitConfig({
        userName: 'Tester Renamed',
      });

      const stored = configService.getGitConfig();
      expect(stored.userName).toBe('Tester Renamed');
      expect(stored.remote.token).toBe('secret-token-123');
    });

    it('updates remote push status', () => {
      const now = Date.now();
      configService.updateGitRemotePushStatus(now, null);
      let cfg = configService.getGitConfig();
      expect(cfg.remote.lastPushTime).toBe(now);
      expect(cfg.remote.lastPushError).toBeNull();

      configService.updateGitRemotePushStatus(now, 'Network failed');
      cfg = configService.getGitConfig();
      expect(cfg.remote.lastPushError).toBe('Network failed');
    });
  });

  describe('GitService Credential Masking & URL Building', () => {
    it('builds authenticated HTTPS URL and escapes special characters', () => {
      const remote: GitRemoteConfig = {
        enabled: true,
        url: 'https://codeberg.org/user/vault-notes.git',
        username: 'ingo@knowmesh',
        token: 'p@ss:word#123',
        branch: 'main',
      };

      const authUrl = gitService.buildAuthenticatedUrl(remote);
      expect(authUrl).toContain('https://ingo%40knowmesh:p%40ss%3Aword%23123@codeberg.org/user/vault-notes.git');
    });

    it('rejects invalid or non-HTTP URLs', () => {
      expect(() => {
        gitService.buildAuthenticatedUrl({
          enabled: true,
          url: 'ftp://example.com/repo.git',
          username: 'user',
          branch: 'main',
        });
      }).toThrow(/Nur HTTPS- oder HTTP/);

      expect(() => {
        gitService.buildAuthenticatedUrl({
          enabled: true,
          url: 'invalid-not-a-url',
          username: 'user',
          branch: 'main',
        });
      }).toThrow(/Ungültige Remote-URL/);
    });

    it('masks credentials from stdout/stderr strings', () => {
      const secret = 'superSecretToken999';
      const output = `Error pushing to https://user:${secret}@codeberg.org/repo.git: fatal authentication error with token ${secret}`;
      const masked = gitService.maskCredentials(output, secret);

      expect(masked).not.toContain(secret);
      expect(masked).toContain('https://***:***@codeberg.org/repo.git');
      expect(masked).toContain('***');
    });
  });

  describe('GitService Repository Operations', () => {
    it('initializes git repository and creates initial commit when enabled', async () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'Test Author',
        userEmail: 'test@example.com',
      });

      await gitService.initIfNeeded();

      expect(fs.existsSync(path.join(vaultDir, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, '.gitignore'))).toBe(true);

      const status = await gitService.getStatus();
      expect(status.isRepo).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.clean).toBe(true);
      expect(status.lastCommit).not.toBeNull();
      expect(status.lastCommit?.message).toContain('initial knowmesh vault commit');
    });

    it('tracks changes, status, and creates commit on demand', async () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'Test Author',
        userEmail: 'test@example.com',
      });
      await gitService.initIfNeeded();

      // Write a note
      fs.writeFileSync(path.join(vaultDir, 'Note1.md'), '# Hallo Welt\n', 'utf-8');

      let status = await gitService.getStatus();
      expect(status.clean).toBe(false);
      expect(status.untrackedCount + status.modifiedCount).toBeGreaterThan(0);

      // Commit changes
      const commitRes = await gitService.commit('feat: add Note1');
      expect(commitRes.committed).toBe(true);
      expect(commitRes.commitHash).toBeDefined();

      // Working tree should now be clean
      status = await gitService.getStatus();
      expect(status.clean).toBe(true);
      expect(status.lastCommit?.message).toBe('feat: add Note1');
      expect(status.lastCommit?.author).toBe('Test Author');

      // Committing with clean tree returns committed: false
      const secondCommit = await gitService.commit('no changes');
      expect(secondCommit.committed).toBe(false);
    });

    it('handles testRemote failure safely without leaking token', async () => {
      const secretToken = 'secret-token-to-hide-456';
      const remote: GitRemoteConfig = {
        enabled: true,
        url: 'https://invalid-non-existent-domain-12345.org/repo.git',
        username: 'user',
        token: secretToken,
        branch: 'main',
      };

      const result = await gitService.testRemote(remote);
      expect(result.success).toBe(false);
      expect(result.message).not.toContain(secretToken);
    });
  });
});
