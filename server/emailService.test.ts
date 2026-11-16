import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import nodemailer from 'nodemailer';
import { ConfigService, configService } from './configService';
import { VaultService } from './vaultService';
import { createApp } from './index';
import {
  EmailService,
  allocateUniqueVaultPath,
  buildInboxEmailNote,
  convertEmailHtmlToMarkdown,
} from './emailService';

describe('Email Integration (SMTP Export, IMAP Markdown & Password Masking)', () => {
  let tmpRoot: string;
  let tmpVault: string;
  let tmpConfigPath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-email-test-'));
    tmpVault = path.join(tmpRoot, 'vault');
    fs.mkdirSync(tmpVault, { recursive: true });
    tmpConfigPath = path.join(tmpRoot, 'server-config.json');

    // Disable auth on global singleton for HTTP route tests
    configService.updateSecurity(false);

    const vaultService = new VaultService(tmpVault);
    const app = createApp(vaultService);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('masks SMTP/IMAP passwords in GET /api/config & GET /api/email/status and preserves stored password on empty save', async () => {
    const saveRes = await fetch(`${baseUrl}/api/email/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp: {
          enabled: true,
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          username: 'user@example.com',
          password: 'super-secret-smtp-password',
          fromAddress: 'notes@example.com',
          defaultRecipient: 'dest@example.com',
        },
        imap: {
          enabled: true,
          host: 'imap.example.com',
          port: 993,
          secure: true,
          username: 'user@example.com',
          password: 'super-secret-imap-password',
          mailboxFolder: 'Zuber-Inbox',
        },
      }),
    });

    expect(saveRes.status).toBe(200);
    const savedJson = await saveRes.json();
    expect(savedJson.smtp.hasPassword).toBe(true);
    expect(savedJson.smtp.password).toBe('');
    expect(savedJson.imap.hasPassword).toBe(true);
    expect(savedJson.imap.password).toBe('');

    const rawSaveStr = JSON.stringify(savedJson);
    expect(rawSaveStr).not.toContain('super-secret-smtp-password');
    expect(rawSaveStr).not.toContain('super-secret-imap-password');

    // Verify GET /api/config & GET /api/email/status never leak passwords
    const configRes = await fetch(`${baseUrl}/api/config`);
    expect(configRes.status).toBe(200);
    const configText = await configRes.text();
    expect(configText).not.toContain('super-secret-smtp-password');
    expect(configText).not.toContain('super-secret-imap-password');
    const configData = JSON.parse(configText);
    expect(configData.email.smtp.hasPassword).toBe(true);
    expect(configData.email.imap.hasPassword).toBe(true);

    const statusRes = await fetch(`${baseUrl}/api/email/status`);
    expect(statusRes.status).toBe(200);
    const statusText = await statusRes.text();
    expect(statusText).not.toContain('super-secret-smtp-password');
    expect(statusText).not.toContain('super-secret-imap-password');

    // Re-save with empty password strings -> preserves existing passwords on disk
    const res2 = await fetch(`${baseUrl}/api/email/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp: { host: 'smtp2.example.com', password: '' },
        imap: { host: 'imap2.example.com', password: '' },
      }),
    });
    expect(res2.status).toBe(200);
    const updated = await res2.json();
    expect(updated.smtp.host).toBe('smtp2.example.com');
    expect(updated.smtp.hasPassword).toBe(true);
    expect(updated.imap.hasPassword).toBe(true);
    expect(configService.getEmailConfig().smtp.password).toBe('super-secret-smtp-password');
    expect(configService.getEmailConfig().imap.password).toBe('super-secret-imap-password');
  });

  it('converts HTML email to clean Markdown while stripping styles, scripts, and tracking pixels', () => {
    const html = `
      <html>
        <head><style>.x { color: red; }</style></head>
        <body>
          <script>alert('xss')</script>
          <h1>Project Update</h1>
          <p>Hello <strong>Team</strong>, see <a href="https://example.com">report</a>.</p>
          <ul><li>Item 1</li><li>Item 2</li></ul>
          <img src="https://tracker.example.com/pixel.gif" width="1" height="1" />
          <img src="https://tracker.example.com/hidden.png" style="display: none" />
        </body>
      </html>
    `;

    const md = convertEmailHtmlToMarkdown(html, 'fallback');
    expect(md).toContain('# Project Update');
    expect(md).toContain('**Team**');
    expect(md).toContain('[report](https://example.com)');
    expect(md).toContain('Item 1');
    expect(md).not.toContain('alert(');
    expect(md).not.toContain('color: red');
    expect(md).not.toContain('pixel.gif');
    expect(md).not.toContain('hidden.png');

    // Empty HTML falls back cleanly to plain text
    expect(convertEmailHtmlToMarkdown('', 'Plain text body\r\nLine 2')).toBe('Plain text body\nLine 2');
  });

  it('generates Inbox/YYYY-MM-DD <Subject>.md notes with attachment embeds and handles same-day (2) collisions', () => {
    const inboxDir = path.join(tmpVault, 'Inbox');
    fs.mkdirSync(inboxDir, { recursive: true });

    const firstPath = allocateUniqueVaultPath(tmpVault, 'Inbox', '2026-11-16 Monthly Report', '.md');
    expect(firstPath).toBe('Inbox/2026-11-16 Monthly Report.md');

    const noteBody = buildInboxEmailNote({
      from: 'alice@example.com',
      date: '2026-11-16',
      subject: 'Monthly Report',
      bodyMarkdown: 'Please find attached.',
      attachmentPaths: ['attachments/invoice.pdf'],
    });

    expect(noteBody).toContain('---\nsource: email\nfrom: alice@example.com\ndate: 2026-11-16\n---\n# Monthly Report\n');
    expect(noteBody).toContain('![[attachments/invoice.pdf]]');

    fs.writeFileSync(path.join(tmpVault, firstPath), noteBody, 'utf-8');
    const secondPath = allocateUniqueVaultPath(tmpVault, 'Inbox', '2026-11-16 Monthly Report', '.md');
    expect(secondPath).toBe('Inbox/2026-11-16 Monthly Report (2).md');
  });

  it('exports Markdown notes with local embeds or PDF payloads via nodemailer transport', async () => {
    const isolatedCfg = new ConfigService(tmpConfigPath);
    isolatedCfg.updateEmailConfig({
      smtp: {
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'sender@example.com',
        password: 'pw',
        fromAddress: 'sender@example.com',
        defaultRecipient: 'to@example.com',
      },
    });

    fs.mkdirSync(path.join(tmpVault, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(tmpVault, 'attachments', 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(
      path.join(tmpVault, 'Report.md'),
      '# Report\n\nSee chart:\n![[attachments/chart.png]]\n',
      'utf-8'
    );

    const vs = new VaultService(tmpVault);
    const emailSvc = new EmailService(vs, isolatedCfg);

    const sendMailSpy = vi.fn().mockResolvedValue({ messageId: '<msg-1@example.com>' });
    const transportSpy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: sendMailSpy,
      verify: vi.fn().mockResolvedValue(true),
    } as any);

    await emailSvc.sendNote({
      notePath: 'Report.md',
      to: 'recipient@example.com',
      subject: 'Q4 Report',
      message: 'FYI',
      format: 'md',
    });

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const mdMail = sendMailSpy.mock.calls[0][0];
    expect(mdMail.to).toBe('recipient@example.com');
    expect(mdMail.subject).toBe('Q4 Report');
    expect(mdMail.attachments.map((a: any) => a.filename)).toEqual(['Report.md', 'chart.png']);

    // PDF format
    await emailSvc.sendNote({
      notePath: 'Report.md',
      to: 'recipient@example.com',
      format: 'pdf',
      pdfBase64: Buffer.from('%PDF-1.4\n').toString('base64'),
    });

    expect(sendMailSpy).toHaveBeenCalledTimes(2);
    const pdfMail = sendMailSpy.mock.calls[1][0];
    expect(pdfMail.attachments[0].filename).toBe('Report.pdf');
    expect(pdfMail.attachments[0].contentType).toBe('application/pdf');

    transportSpy.mockRestore();
  });
});
