import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import TurndownService from 'turndown';
import type { ImapConfig, SmtpConfig } from '../shared/types';
import { extractLinksAndEmbeds, parseMarkdownWithFrontmatter } from '../shared/markdownUtils';
import type { ConfigService } from './configService';
import type { VaultService } from './vaultService';
import { serverLogger } from './logger';

const SAFE_ATTACHMENT_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.json',
]);

export function sanitizeEmailFilename(input: string, fallback = 'Email'): string {
  const cleaned = String(input || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

export function allocateUniqueVaultPath(
  vaultDir: string,
  folder: string,
  baseName: string,
  ext: string
): string {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
  const cleanExt = ext.startsWith('.') ? ext : ext ? `.${ext}` : '';
  const safeBase = sanitizeEmailFilename(baseName, 'Email');

  let candidateName = `${safeBase}${cleanExt}`;
  let relPath = cleanFolder ? `${cleanFolder}/${candidateName}` : candidateName;
  let counter = 2;

  while (fs.existsSync(path.join(vaultDir, relPath))) {
    candidateName = `${safeBase} (${counter})${cleanExt}`;
    relPath = cleanFolder ? `${cleanFolder}/${candidateName}` : candidateName;
    counter += 1;
  }

  return relPath;
}

export function convertEmailHtmlToMarkdown(html?: string | null, textFallback?: string | null): string {
  const rawHtml = (html || '').trim();
  if (!rawHtml) {
    return (textFallback || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Strip scripts, styles, hidden elements, and 1x1 tracking pixels
  turndown.remove(['script', 'style', 'noscript', 'meta', 'link', 'title']);
  turndown.addRule('stripTrackingPixels', {
    filter: (node) => {
      if (node.nodeName !== 'IMG') return false;
      const el = node as unknown as { getAttribute?: (name: string) => string | null };
      const w = el.getAttribute?.('width');
      const h = el.getAttribute?.('height');
      const style = el.getAttribute?.('style') || '';
      if (w === '1' || h === '1' || w === '0' || h === '0') return true;
      if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return true;
      return false;
    },
    replacement: () => '',
  });

  const md = turndown
    .turndown(rawHtml)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!md && textFallback) {
    return textFallback.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return md;
}

export function buildInboxEmailNote(params: {
  from: string;
  date: string;
  subject: string;
  bodyMarkdown: string;
  attachmentPaths: string[];
}): string {
  const safeFrom = params.from.replace(/[\r\n"]/g, '').trim() || 'unknown';
  const safeDate = params.date.slice(0, 10);
  const title = params.subject.trim() || 'Email';
  const embeds = params.attachmentPaths.map((p) => `![[${p}]]`).join('\n');

  const sections = [
    '---',
    'source: email',
    `from: ${safeFrom}`,
    `date: ${safeDate}`,
    '---',
    `# ${title}`,
    '',
    params.bodyMarkdown.trim(),
  ];

  if (embeds) {
    sections.push('', embeds);
  }

  return `${sections.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export class EmailService {
  private vaultService: VaultService;
  private configService: ConfigService;
  private processedStatePath: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  constructor(vaultService: VaultService, configService: ConfigService, processedStatePath?: string) {
    this.vaultService = vaultService;
    this.configService = configService;
    this.processedStatePath =
      processedStatePath || path.join(this.configService.getConfigDir(), 'imap-processed.json');
  }

  private getEffectiveSmtp(override?: Partial<SmtpConfig>): SmtpConfig {
    const stored = this.configService.getEmailConfig().smtp;
    if (!override) return stored;
    return {
      ...stored,
      ...override,
      password:
        typeof override.password === 'string' && override.password.trim().length > 0
          ? override.password
          : stored.password,
    };
  }

  private getEffectiveImap(override?: Partial<ImapConfig>): ImapConfig {
    const stored = this.configService.getEmailConfig().imap;
    if (!override) return stored;
    return {
      ...stored,
      ...override,
      password:
        typeof override.password === 'string' && override.password.trim().length > 0
          ? override.password
          : stored.password,
    };
  }

  private createSmtpTransport(smtp: SmtpConfig) {
    if (!smtp.host || !smtp.port) {
      throw new Error('SMTP host and port are required.');
    }
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: Boolean(smtp.secure),
      auth:
        smtp.username && smtp.password
          ? { user: smtp.username, pass: smtp.password }
          : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }

  public async testSmtp(params?: {
    to?: string;
    smtp?: Partial<SmtpConfig>;
  }): Promise<{ ok: boolean; message: string }> {
    const smtp = this.getEffectiveSmtp(params?.smtp);
    const recipient = (params?.to || smtp.defaultRecipient || smtp.fromAddress || '').trim();
    if (!recipient) {
      throw new Error('Recipient address is required for SMTP test.');
    }

    const transporter = this.createSmtpTransport(smtp);
    await transporter.verify();

    const fromName = smtp.fromName || 'Zuber';
    const fromAddr = smtp.fromAddress || smtp.username;
    await transporter.sendMail({
      from: fromAddr ? `"${fromName.replace(/"/g, '')}" <${fromAddr}>` : undefined,
      to: recipient,
      subject: 'Zuber SMTP Test',
      text: 'Your Zuber SMTP email export configuration is working correctly.',
      html: '<p>Your <strong>Zuber</strong> SMTP email export configuration is working correctly.</p>',
    });

    serverLogger.info('email', `SMTP test email sent to "${recipient}"`);
    return { ok: true, message: `Test email sent to ${recipient}` };
  }

  public async sendNote(params: {
    notePath: string;
    to: string;
    subject?: string;
    message?: string;
    format: 'md' | 'pdf';
    pdfBase64?: string;
  }): Promise<{ ok: boolean }> {
    const smtp = this.getEffectiveSmtp();
    if (!smtp.enabled) {
      throw new Error('Outbound email (SMTP) is not enabled in settings.');
    }
    const to = (params.to || smtp.defaultRecipient || '').trim();
    if (!to) {
      throw new Error('Recipient email address is required.');
    }

    const absNotePath = this.vaultService.resolveSafePath(params.notePath);
    if (!fs.existsSync(absNotePath)) {
      throw new Error(`Note not found: ${params.notePath}`);
    }

    const cleanNoteName = path.basename(params.notePath).replace(/\.md$/i, '') || 'Note';
    const subject = (params.subject || cleanNoteName).trim();
    const coverMessage = (params.message || '').trim();
    const fromName = smtp.fromName || 'Zuber';
    const fromAddr = smtp.fromAddress || smtp.username;
    const transporter = this.createSmtpTransport(smtp);

    if (params.format === 'pdf') {
      const rawB64 = String(params.pdfBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
      if (!rawB64) {
        throw new Error('PDF payload is missing.');
      }
      const pdfBuffer = Buffer.from(rawB64, 'base64');
      await transporter.sendMail({
        from: fromAddr ? `"${fromName.replace(/"/g, '')}" <${fromAddr}>` : undefined,
        to,
        subject,
        text: coverMessage || `Attached PDF export of "${cleanNoteName}".`,
        html: `<p>${(coverMessage || `Attached PDF export of <strong>${cleanNoteName}</strong>.`).replace(/\n/g, '<br/>')}</p>`,
        attachments: [
          {
            filename: `${cleanNoteName}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      serverLogger.info('email', `Sent note "${params.notePath}" as PDF to "${to}"`);
      return { ok: true };
    }

    // Markdown (.md) + referenced local attachments
    const rawMd = fs.readFileSync(absNotePath, 'utf-8');
    const { body } = parseMarkdownWithFrontmatter(rawMd);
    const { embeds } = extractLinksAndEmbeds(body);

    const attachments: Array<{ filename: string; path: string }> = [
      {
        filename: `${cleanNoteName}.md`,
        path: absNotePath,
      },
    ];

    const seenAttachPaths = new Set<string>([absNotePath]);
    for (const embedTarget of embeds) {
      const cleanTarget = embedTarget.split('#')[0].trim();
      if (!cleanTarget || /^(https?:|data:)/i.test(cleanTarget)) continue;
      const resolvedRel = this.vaultService.resolveWikiTarget(cleanTarget, params.notePath);
      if (!resolvedRel) continue;
      try {
        const resolvedAbs = this.vaultService.resolveSafePath(resolvedRel);
        if (!seenAttachPaths.has(resolvedAbs) && fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isFile()) {
          seenAttachPaths.add(resolvedAbs);
          attachments.push({
            filename: path.basename(resolvedAbs),
            path: resolvedAbs,
          });
        }
      } catch {}
    }

    const textBody = coverMessage ? `${coverMessage}\n\n---\n\n${body.trim()}` : body.trim();
    const escapedPreview = textBody
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    await transporter.sendMail({
      from: fromAddr ? `"${fromName.replace(/"/g, '')}" <${fromAddr}>` : undefined,
      to,
      subject,
      text: textBody,
      html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5;">${escapedPreview}</div>`,
      attachments,
    });

    serverLogger.info('email', `Sent note "${params.notePath}" (.md + ${attachments.length - 1} attachments) to "${to}"`);
    return { ok: true };
  }

  private createImapClient(imap: ImapConfig): ImapFlow {
    if (!imap.host || !imap.username || !imap.password) {
      throw new Error('IMAP host, username, and password are required.');
    }
    return new ImapFlow({
      host: imap.host,
      port: imap.port || 993,
      secure: Boolean(imap.secure),
      auth: {
        user: imap.username,
        pass: imap.password,
      },
      logger: false,
    });
  }

  public async testImap(imapOverride?: Partial<ImapConfig>): Promise<{
    ok: boolean;
    messageCount?: number;
    availableFolders?: string[];
    error?: string;
  }> {
    const imap = this.getEffectiveImap(imapOverride);
    const client = this.createImapClient(imap);
    try {
      await client.connect();
      const mailboxes = await client.list();
      const availableFolders = mailboxes.map((m) => m.path);
      const targetFolder = imap.mailboxFolder || 'Zuber-Inbox';
      const found = availableFolders.find(
        (p) => p === targetFolder || p.toLowerCase() === targetFolder.toLowerCase()
      );
      if (!found) {
        return {
          ok: false,
          availableFolders,
          error: `Mailbox folder "${targetFolder}" not found. Available: ${availableFolders.slice(0, 12).join(', ')}`,
        };
      }
      const status = await client.status(found, { messages: true, unseen: true });
      return {
        ok: true,
        messageCount: status && typeof status === 'object' ? (status.messages ?? 0) : 0,
        availableFolders,
      };
    } finally {
      try {
        await client.logout();
      } catch {}
    }
  }

  private loadProcessedIds(): Set<string> {
    try {
      if (fs.existsSync(this.processedStatePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.processedStatePath, 'utf-8'));
        if (Array.isArray(parsed)) {
          return new Set(parsed.map((x) => String(x)));
        }
      }
    } catch {}
    return new Set();
  }

  private saveProcessedIds(ids: Set<string>): void {
    try {
      const dir = path.dirname(this.processedStatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(ids).slice(-2000);
      const tmp = `${this.processedStatePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
      fs.renameSync(tmp, this.processedStatePath);
    } catch (err) {
      serverLogger.warn('email', `Failed to persist IMAP processed IDs: ${(err as Error).message}`);
    }
  }

  public async pollImapOnce(): Promise<{ imported: number }> {
    const imap = this.getEffectiveImap();
    if (!imap.enabled || !imap.host || !imap.username || !imap.password) {
      return { imported: 0 };
    }
    if (process.env.FORCE_OFFLINE === 'true') {
      return { imported: 0 };
    }
    if (this.isPolling) {
      return { imported: 0 };
    }

    this.isPolling = true;
    let imported = 0;
    const client = this.createImapClient(imap);

    try {
      await client.connect();
      const targetFolder = imap.mailboxFolder || 'Zuber-Inbox';
      const lock = await client.getMailboxLock(targetFolder);
      const processedIds = this.loadProcessedIds();

      try {
        const unseenUids = (await client.search({ seen: false }, { uid: true })) || [];
        const maxBytes = (imap.maxAttachmentMb || 15) * 1024 * 1024;
        const vaultDir = this.vaultService.getVaultDir();

        for (const uid of unseenUids) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || typeof msg !== 'object' || !('source' in msg) || !msg.source) {
            continue;
          }

          const parsed = await simpleParser(msg.source as Buffer);
          const msgId = (parsed.messageId || `uid-${targetFolder}-${uid}`).trim();

          // Mark as Seen immediately to prevent duplicate processing
          try {
            await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          } catch {}

          if (processedIds.has(msgId)) {
            continue;
          }

          const msgDate = parsed.date ? parsed.date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
          const subject = (parsed.subject || 'Email').trim();
          const fromAddr = parsed.from?.text || parsed.from?.value?.[0]?.address || 'unknown';
          const bodyMd = convertEmailHtmlToMarkdown(
            typeof parsed.html === 'string' ? parsed.html : null,
            parsed.text || ''
          );

          // Save safe attachments
          const attachmentRelPaths: string[] = [];
          const attachDir = path.join(vaultDir, 'attachments');
          if (parsed.attachments && parsed.attachments.length > 0) {
            if (!fs.existsSync(attachDir)) {
              fs.mkdirSync(attachDir, { recursive: true });
            }
            for (const att of parsed.attachments) {
              if (!att.content || att.content.length > maxBytes) continue;
              const origName = att.filename || `attachment-${Date.now()}`;
              const ext = path.extname(origName).toLowerCase();
              if (!SAFE_ATTACHMENT_EXTS.has(ext)) continue;
              const base = path.basename(origName, ext);
              const relAttPath = allocateUniqueVaultPath(vaultDir, 'attachments', base, ext);
              const absAttPath = path.join(vaultDir, relAttPath);
              fs.writeFileSync(absAttPath, att.content);
              this.vaultService.indexFile(relAttPath);
              this.vaultService.notifyChange(relAttPath, true);
              attachmentRelPaths.push(relAttPath);
            }
          }

          const inboxDir = path.join(vaultDir, 'Inbox');
          if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
          }

          const relNotePath = allocateUniqueVaultPath(
            vaultDir,
            'Inbox',
            `${msgDate} ${subject}`,
            '.md'
          );
          const noteContent = buildInboxEmailNote({
            from: fromAddr,
            date: msgDate,
            subject,
            bodyMarkdown: bodyMd,
            attachmentPaths: attachmentRelPaths,
          });
          fs.writeFileSync(path.join(vaultDir, relNotePath), noteContent, 'utf-8');
          this.vaultService.indexFile(relNotePath);
          this.vaultService.notifyChange(relNotePath, true);

          processedIds.add(msgId);
          this.saveProcessedIds(processedIds);
          imported += 1;

          if (imap.processedFolder && imap.processedFolder.trim()) {
            try {
              await client.messageMove(String(uid), imap.processedFolder.trim(), { uid: true });
            } catch (moveErr) {
              serverLogger.warn('email', `Failed to move UID ${uid} to "${imap.processedFolder}": ${(moveErr as Error).message}`);
            }
          }
        }
      } finally {
        lock.release();
      }

      this.configService.updateImapPollStatus(Date.now(), null);
      if (imported > 0) {
        serverLogger.info('email', `Imported ${imported} email(s) into Inbox/`);
      }
      return { imported };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.error('email', `IMAP poll failed: ${msg}`);
      this.configService.updateImapPollStatus(Date.now(), msg);
      throw err;
    } finally {
      this.isPolling = false;
      try {
        await client.logout();
      } catch {}
    }
  }

  public startPolling(): void {
    this.stopPolling();
    const imap = this.getEffectiveImap();
    if (!imap.enabled || process.env.FORCE_OFFLINE === 'true') {
      return;
    }
    const intervalMs = Math.max(30, imap.pollIntervalSeconds || 60) * 1000;
    this.pollTimer = setInterval(() => {
      this.pollImapOnce().catch(() => {});
    }, intervalMs);
    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
