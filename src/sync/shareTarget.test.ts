/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  sanitizeFileName,
  getUniqueInboxPath,
  readBlobAsText,
  cleanShareUrlQuery,
  processIncomingShares,
  saveIncomingShare,
  getIncomingShares,
  clearAllIncomingShares,
  resetShareProcessingLock,
  clearRecentCreatedNotes,
  isRecentDuplicateNote,
  openShareDb,
  SHARE_STORE_NAME,
  type SharedIncomingPayload,
} from './shareTargetService';
import { api } from '../api';

describe('Web Share Target - Manifest & Service Worker Configuration', () => {
  it('1. verifies public/manifest.webmanifest contains valid share_target configuration', () => {
    const manifestPath = path.resolve(__dirname, '../../public/manifest.webmanifest');
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    expect(manifest.share_target).toBeDefined();
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.enctype).toBe('multipart/form-data');

    const params = manifest.share_target.params;
    expect(params.title).toBe('title');
    expect(params.text).toBe('text');
    expect(params.url).toBe('url');
    expect(Array.isArray(params.files)).toBe(true);
    expect(params.files[0].name).toBe('shared_files');

    const accepted = params.files[0].accept;
    expect(accepted).toContain('image/*');
    expect(accepted).toContain('application/pdf');
    expect(accepted).toContain('.pdf');
    expect(accepted).toContain('text/markdown');
    expect(accepted).toContain('text/plain');
    expect(accepted).toContain('.md');
  });

  it('2. verifies public/sw.js intercepts /share-target and redirects with HTTP 303', () => {
    const swPath = path.resolve(__dirname, '../../public/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');

    expect(swContent).toContain("url.pathname === '/share-target'");
    expect(swContent).toContain("event.request.method === 'POST'");
    expect(swContent).toContain('event.request.formData()');
    expect(swContent).toContain("formData.getAll('shared_files')");
    expect(swContent).toContain('knowmesh_shared_incoming');
    expect(swContent).toContain("Response.redirect('/?incoming_share=1', 303)");
  });
});

describe('Web Share Target - Filename & Path Utilities', () => {
  it('3. sanitizes illegal characters in filenames', () => {
    expect(sanitizeFileName('My:Document*Name?.pdf')).toBe('My_Document_Name_.pdf');
    expect(sanitizeFileName('Path/With\\Slashes')).toBe('Path_With_Slashes');
    expect(sanitizeFileName('   ')).toBe('unnamed');
    expect(sanitizeFileName('Normal Name.md')).toBe('Normal Name.md');
  });

  it('4. generates unique Inbox note paths without collisions', () => {
    const existing = new Set<string>(['Inbox/Test Note.md']);

    // Unique name
    const newPath = getUniqueInboxPath('Another Note', existing);
    expect(newPath).toBe('Inbox/Another Note.md');

    // Colliding name
    const collidingPath = getUniqueInboxPath('Test Note', existing);
    expect(collidingPath).toMatch(/^Inbox\/Test Note_\d+\.md$/);
  });

  it('5. reads Blob content as UTF-8 string', async () => {
    const blob = new Blob(['# Hello Markdown'], { type: 'text/markdown' });
    const text = await readBlobAsText(blob);
    expect(text).toBe('# Hello Markdown');
  });

  it('6. cleans ?incoming_share=1 query parameter from window.location', () => {
    window.history.replaceState({}, '', '/?incoming_share=1#section');
    expect(window.location.search).toContain('incoming_share=1');

    cleanShareUrlQuery();
    expect(window.location.search).not.toContain('incoming_share');
  });
});

describe('Web Share Target - Ingest Handler (Cases A, B, C, D)', () => {
  let createdFolders: string[] = [];
  let savedNotes: { path: string; body: string }[] = [];
  let uploadedAttachments: { name: string }[] = [];

  beforeEach(async () => {
    createdFolders = [];
    savedNotes = [];
    uploadedAttachments = [];

    vi.spyOn(api, 'createFolder').mockImplementation(async (folderPath) => {
      createdFolders.push(folderPath);
      return { ok: true, path: folderPath };
    });

    vi.spyOn(api, 'saveNote').mockImplementation(async (payload) => {
      savedNotes.push({ path: payload.path, body: payload.body || '' });
      return {
        path: payload.path,
        name: payload.path.split('/').pop() || '',
        basename: (payload.path.split('/').pop() || '').replace(/\.md$/, ''),
        extension: 'md',
        body: payload.body || '',
        rawContent: payload.body || '',
        properties: [],
        frontmatter: {},
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: Date.now(),
      };
    });

    vi.spyOn(api, 'uploadAttachment').mockImplementation(async (file: File) => {
      uploadedAttachments.push({ name: file.name });
      return {
        ok: true,
        name: file.name,
        originalName: file.name,
        path: `attachments/${file.name}`,
        size: file.size,
        wikiEmbed: `![[attachments/${file.name}]]`,
      };
    });

    // Clear IndexedDB, lock and recent notes cache before each test
    resetShareProcessingLock();
    clearRecentCreatedNotes();
    try {
      await clearAllIncomingShares();
    } catch {}
  });

  it('7. Case A: ingests shared Markdown file into Inbox/', async () => {
    const mdBlob = new Blob(['# Shared Meeting Notes\n\n- Task 1\n- Task 2'], {
      type: 'text/markdown',
    });
    const payload: SharedIncomingPayload = {
      id: 101,
      title: 'Meeting Notes',
      text: '',
      url: '',
      files: [
        {
          name: 'Project Discussion.md',
          type: 'text/markdown',
          blob: mdBlob,
        },
      ],
      timestamp: Date.now(),
    };

    await saveIncomingShare(payload);
    const sharesBefore = await getIncomingShares();
    expect(sharesBefore.length).toBe(1);

    const openNote = vi.fn();
    const createdPath = await processIncomingShares({ openNote });

    expect(createdPath).toBe('Inbox/Project Discussion.md');
    expect(createdFolders).toContain('Inbox');
    expect(savedNotes.length).toBe(1);
    expect(savedNotes[0].path).toBe('Inbox/Project Discussion.md');
    expect(savedNotes[0].body).toContain('# Shared Meeting Notes');
    expect(openNote).toHaveBeenCalledWith('Inbox/Project Discussion.md');

    // Should be removed from IndexedDB after successful processing
    const sharesAfter = await getIncomingShares();
    expect(sharesAfter.length).toBe(0);
  });

  it('8. Case B: ingests shared PDF file into attachments/ and creates Inbox/ note', async () => {
    const pdfBlob = new Blob(['%PDF-1.4 mock content'], { type: 'application/pdf' });
    const payload: SharedIncomingPayload = {
      id: 102,
      title: 'Research Paper',
      text: 'Wichtige Lektüre für das nächste Sprint-Review',
      url: '',
      files: [
        {
          name: 'Whitepaper.pdf',
          type: 'application/pdf',
          blob: pdfBlob,
        },
      ],
      timestamp: Date.now(),
    };

    await saveIncomingShare(payload);

    const openNote = vi.fn();
    const createdPath = await processIncomingShares({ openNote });

    expect(createdPath).toMatch(/^Inbox\/\d+_Whitepaper\.md$/);
    expect(uploadedAttachments.length).toBe(1);
    expect(uploadedAttachments[0].name).toBe('Whitepaper.pdf');

    expect(savedNotes.length).toBe(1);
    const note = savedNotes[0];
    expect(note.body).toContain('# Whitepaper');
    expect(note.body).toContain('![[attachments/Whitepaper.pdf]]');
    expect(note.body).toContain('Wichtige Lektüre für das nächste Sprint-Review');
    expect(openNote).toHaveBeenCalledWith(createdPath);
  });

  it('9. Case C: ingests shared Image into attachments/ and creates Inbox/ note', async () => {
    const imgBlob = new Blob(['mock image data'], { type: 'image/png' });
    const payload: SharedIncomingPayload = {
      id: 103,
      title: 'Architektur Skizze',
      text: 'Entwurf auf dem Whiteboard gezeichnet',
      url: '',
      files: [
        {
          name: 'diagram.png',
          type: 'image/png',
          blob: imgBlob,
        },
      ],
      timestamp: Date.now(),
    };

    await saveIncomingShare(payload);

    const openNote = vi.fn();
    const createdPath = await processIncomingShares({ openNote });

    expect(createdPath).toMatch(/^Inbox\/\d+_Architektur Skizze\.md$/);
    expect(uploadedAttachments.length).toBe(1);
    expect(uploadedAttachments[0].name).toBe('diagram.png');

    expect(savedNotes.length).toBe(1);
    const note = savedNotes[0];
    expect(note.body).toContain('# Architektur Skizze');
    expect(note.body).toContain('![[attachments/diagram.png]]');
    expect(note.body).toContain('Entwurf auf dem Whiteboard gezeichnet');
    expect(openNote).toHaveBeenCalledWith(createdPath);
  });

  it('10. Case D: ingests plain text & URL shared without files into Inbox/', async () => {
    const payload: SharedIncomingPayload = {
      id: 104,
      title: 'Interessanter Artikel',
      text: 'Eine kurze Notiz zu diesem Blogpost.',
      url: 'https://example.com/blog/article',
      files: [],
      timestamp: Date.now(),
    };

    await saveIncomingShare(payload);

    const openNote = vi.fn();
    const createdPath = await processIncomingShares({ openNote });

    expect(createdPath).toMatch(/^Inbox\/\d+_Interessanter Artikel\.md$/);
    expect(uploadedAttachments.length).toBe(0);

    expect(savedNotes.length).toBe(1);
    const note = savedNotes[0];
    expect(note.body).toContain('# Interessanter Artikel');
    expect(note.body).toContain('[Link](https://example.com/blog/article)');
    expect(note.body).toContain('Eine kurze Notiz zu diesem Blogpost.');
    expect(openNote).toHaveBeenCalledWith(createdPath);
  });

  it('11. ingests multi-file shares and creates distinct Inbox/ notes', async () => {
    const imgBlob = new Blob(['image bytes'], { type: 'image/jpeg' });
    const mdBlob = new Blob(['# Quick Guide'], { type: 'text/markdown' });

    const payload: SharedIncomingPayload = {
      id: 105,
      title: 'Multi Share',
      text: 'Zwei Dateien auf einmal empfangen',
      url: '',
      files: [
        { name: 'photo.jpg', type: 'image/jpeg', blob: imgBlob },
        { name: 'Guide.md', type: 'text/markdown', blob: mdBlob },
      ],
      timestamp: Date.now(),
    };

    await saveIncomingShare(payload);

    const openNote = vi.fn();
    const createdPath = await processIncomingShares({ openNote });

    expect(savedNotes.length).toBe(2);
    expect(savedNotes.some((n) => n.path === 'Inbox/Guide.md')).toBe(true);
    expect(savedNotes.some((n) => n.body.includes('![[attachments/photo.jpg]]'))).toBe(true);
    expect(openNote).toHaveBeenCalled();
  });

  it('12. prevents duplicate file creation on concurrent execution via processing lock', async () => {
    const payload: SharedIncomingPayload = {
      id: 106,
      title: 'Concurrent Share',
      text: 'Text message',
      url: 'https://example.com/concurrent',
      files: [],
      timestamp: 1700000000000,
    };

    await saveIncomingShare(payload);

    // Trigger two concurrent ingest calls simultaneously
    const [path1, path2] = await Promise.all([
      processIncomingShares(),
      processIncomingShares(),
    ]);

    // Exactly one call should process the share, the other should yield null
    expect(savedNotes.length).toBe(1);
    expect(savedNotes[0].path).toBe('Inbox/1700000000000_Concurrent Share.md');
    const resultPaths = [path1, path2].filter(Boolean);
    expect(resultPaths.length).toBe(1);
    expect(resultPaths[0]).toBe('Inbox/1700000000000_Concurrent Share.md');
  });

  it('13. deduplicates identical share items queued in the same batch', async () => {
    const payload1: SharedIncomingPayload = {
      id: 107,
      title: 'Batch Duplicate',
      text: 'Identical body',
      url: 'https://example.com/item',
      files: [],
      timestamp: 1700000000001,
    };
    const payload2: SharedIncomingPayload = {
      id: 108,
      title: 'Batch Duplicate',
      text: 'Identical body',
      url: 'https://example.com/item',
      files: [],
      timestamp: 1700000000002,
    };

    await saveIncomingShare(payload1);
    await saveIncomingShare(payload2);

    const createdPath = await processIncomingShares();

    // Despite two items in the queue, only one unique note is created
    expect(savedNotes.length).toBe(1);
    expect(createdPath).toBe('Inbox/1700000000001_Batch Duplicate.md');
  });

  it('14. guards against duplicate note creation within 5 seconds for identical title and content', async () => {
    const payload1: SharedIncomingPayload = {
      id: 109,
      title: 'Rapid Fire Share',
      text: 'Some shared thoughts',
      url: 'https://example.com/rapid',
      files: [],
      timestamp: 1700000000010,
    };

    await saveIncomingShare(payload1);
    const firstPath = await processIncomingShares();
    expect(savedNotes.length).toBe(1);
    expect(firstPath).toBe('Inbox/1700000000010_Rapid Fire Share.md');

    // A second identical share arrives 100ms later (simulating Android sending duplicate intent)
    const payload2: SharedIncomingPayload = {
      id: 110,
      title: 'Rapid Fire Share',
      text: 'Some shared thoughts',
      url: 'https://example.com/rapid',
      files: [],
      timestamp: 1700000000011,
    };

    await saveIncomingShare(payload2);
    const secondPath = await processIncomingShares();

    // 5-second duplicate guard detects identical title and content: skips second file creation!
    expect(savedNotes.length).toBe(1);
    expect(secondPath).toBe(firstPath);
  });

  it('15. generates deterministic note filename based on item.timestamp rather than fluctuating Date.now()', async () => {
    const fixedTimestamp = 1699999999999;
    const payload: SharedIncomingPayload = {
      id: 111,
      title: 'Deterministic Note',
      text: 'Check timestamp determinism',
      url: '',
      files: [],
      timestamp: fixedTimestamp,
    };

    await saveIncomingShare(payload);
    const createdPath = await processIncomingShares();

    expect(createdPath).toBe(`Inbox/${fixedTimestamp}_Deterministic Note.md`);
    expect(savedNotes[0].path).toBe(`Inbox/${fixedTimestamp}_Deterministic Note.md`);
  });
});
