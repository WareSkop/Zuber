import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from './configService';
import { GitService } from './gitService';
import { VaultService } from './vaultService';
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
      expect(cfg.userName).toBe('Zuber Server');
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
      expect(status.lastCommit?.message).toContain('initial zuber vault commit');
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

  describe('Git File History & Version Restore', () => {
    it('rejects path traversal attempts in sanitizeRelativePath', () => {
      expect(() => gitService.sanitizeRelativePath('../../etc/passwd')).toThrow(
        /Ungültiger Dateipfad/
      );
      expect(() => gitService.sanitizeRelativePath('/../secrets.txt')).toThrow(
        /Ungültiger Dateipfad/
      );
      expect(() => gitService.sanitizeRelativePath('')).toThrow(
        /Ungültiger Dateipfad/
      );
    });

    it('returns empty history if git is not enabled or repo not initialized', async () => {
      const history = await gitService.getFileHistory('Note.md');
      expect(history).toEqual([]);
    });

    it('retrieves full commit history across edits and renames', async () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'History Tester',
        userEmail: 'history@test.org',
      });
      await gitService.initIfNeeded();

      const noteRel = 'Projects/Alpha.md';
      const absPath = path.join(vaultDir, noteRel);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });

      // Commit 1: Initial content
      fs.writeFileSync(absPath, '# Alpha V1\nInitial content\n', 'utf-8');
      const c1 = await gitService.commit('feat: create Alpha');
      expect(c1.committed).toBe(true);

      // Commit 2: Modification
      fs.writeFileSync(absPath, '# Alpha V2\nUpdated content with more details\n', 'utf-8');
      const c2 = await gitService.commit('update: modify Alpha');
      expect(c2.committed).toBe(true);

      const history = await gitService.getFileHistory(noteRel);
      expect(history.length).toBe(2);
      expect(history[0].message).toBe('update: modify Alpha');
      expect(history[0].author).toBe('History Tester');
      expect(history[0].shortHash).toBe(c2.commitHash);
      expect(history[0].hash.startsWith(c2.commitHash!)).toBe(true);
      expect(history[0].shortHash.length).toBe(7);
      expect(history[1].message).toBe('feat: create Alpha');
      expect(history[1].shortHash).toBe(c1.commitHash);
      expect(history[1].hash.startsWith(c1.commitHash!)).toBe(true);

      // Verify getFileAtCommit retrieves exact content at each version
      const v1Content = await gitService.getFileAtCommit(noteRel, c1.commitHash!);
      expect(v1Content).toBe('# Alpha V1\nInitial content\n');

      const v2Content = await gitService.getFileAtCommit(noteRel, c2.commitHash!);
      expect(v2Content).toBe('# Alpha V2\nUpdated content with more details\n');
    });

    it('tracks file history and retrieves content across git renames', async () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'Rename Tester',
        userEmail: 'rename@test.org',
      });
      await gitService.initIfNeeded();

      const origRel = 'DocOld.md';
      const newRel = 'DocRenamed.md';
      const origAbs = path.join(vaultDir, origRel);
      const newAbs = path.join(vaultDir, newRel);

      // Commit 1: Create under original name
      fs.writeFileSync(origAbs, '# Historic Document\nFirst draft content.\n', 'utf-8');
      const c1 = await gitService.commit('docs: add DocOld');
      expect(c1.committed).toBe(true);

      // Rename file on disk and commit
      fs.renameSync(origAbs, newAbs);
      const c2 = await gitService.commit('refactor: rename DocOld to DocRenamed');
      expect(c2.committed).toBe(true);

      // Querying the renamed file should follow the history back to commit 1
      const history = await gitService.getFileHistory(newRel);
      expect(history.length).toBe(2);
      expect(history[0].shortHash).toBe(c2.commitHash);
      expect(history[1].shortHash).toBe(c1.commitHash);

      // getFileAtCommit for the new name at commit 1 should automatically resolve historical name
      const contentAtV1 = await gitService.getFileAtCommit(newRel, c1.commitHash!);
      expect(contentAtV1).toBe('# Historic Document\nFirst draft content.\n');
    });

    it('restores file to historical commit atomically and auto-commits', async () => {
      configService.updateGitConfig({
        enabled: true,
        userName: 'Restore Tester',
        userEmail: 'restore@test.org',
      });
      await gitService.initIfNeeded();

      const vaultService = new VaultService(vaultDir);
      const testFile = 'Notes/RestoreTarget.md';
      const absPath = path.join(vaultDir, testFile);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });

      // Commit 1: Version 1
      fs.writeFileSync(absPath, '# Version 1\nImportant original data\n', 'utf-8');
      const c1 = await gitService.commit('feat: version 1');
      expect(c1.committed).toBe(true);

      // Commit 2: Corrupted or unwanted edit
      fs.writeFileSync(absPath, '# Version 2\nAccidental unwanted changes\n', 'utf-8');
      const c2 = await gitService.commit('feat: version 2 corrupted');
      expect(c2.committed).toBe(true);

      // Restore to Commit 1
      const restored = await gitService.restoreFileToCommit(testFile, c1.commitHash!, vaultService);
      expect(restored.path).toBe(testFile);
      expect(restored.rawContent).toBe('# Version 1\nImportant original data\n');

      // Verify file on disk has original content
      const diskContent = fs.readFileSync(absPath, 'utf-8');
      expect(diskContent).toBe('# Version 1\nImportant original data\n');

      // Verify VaultService cache updated
      const inMemoryNote = vaultService.getNote(testFile);
      expect(inMemoryNote?.rawContent).toBe('# Version 1\nImportant original data\n');

      // Verify automatic commit was created for the restoration
      const historyAfterRestore = await gitService.getFileHistory(testFile);
      expect(historyAfterRestore.length).toBe(3);
      expect(historyAfterRestore[0].message).toContain(`restore: ${testFile} to ${c1.commitHash!.slice(0, 7)}`);
    });
  });
});
