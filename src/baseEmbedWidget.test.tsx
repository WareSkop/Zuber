/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseEmbedWidget } from './components/base/BaseEmbedWidget';
import { CanvasEmbedWidget } from './components/canvas/CanvasEmbedWidget';
import { detectFileType } from './components/ResearchPane';
import { renderReadingHtml } from './utils/readingMode';
import { api } from './api';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock ResizeObserver for jsdom / xyflow
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('BaseEmbedWidget & Borderless Dashboard Embedding', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const sampleYaml = `
views:
  - type: table
    name: "Tabelle"
    order: ["file.name", "status"]
  - type: cards
    name: "Karten"
    order: ["file.name", "priority"]
`;

  const mockNotes = [
    {
      path: 'Projects/Alpha.md',
      name: 'Alpha.md',
      folder: 'Projects',
      ext: 'md',
      tags: ['work'],
      links: [],
      properties: { status: 'Aktiv', priority: 'Hoch' },
      frontmatter: { status: 'Aktiv', priority: 'Hoch' },
    },
    {
      path: 'Projects/Beta.md',
      name: 'Beta.md',
      folder: 'Projects',
      ext: 'md',
      tags: ['personal'],
      links: [],
      properties: { status: 'Erledigt', priority: 'Niedrig' },
      frontmatter: { status: 'Erledigt', priority: 'Niedrig' },
    },
  ];

  it('renders borderless widget with subtle status bar and open-in-editor button', async () => {
    const handleOpenNote = vi.fn();

    await act(async () => {
      root.render(
        <BaseEmbedWidget
          basePath="Projekte.base"
          onOpenNote={handleOpenNote}
          rawContent={sampleYaml}
          allNotes={mockNotes}
        />
      );
    });

    // Check container classes
    const widget = container.querySelector('.base-embed-widget') as HTMLElement;
    expect(widget).toBeTruthy();
    expect(widget.classList.contains('cm-lp-base-embed')).toBe(true);
    expect(widget.classList.contains('embedded-base-container')).toBe(true);

    // Check status bar
    const statusBar = container.querySelector('.base-embed-status-bar') as HTMLElement;
    expect(statusBar).toBeTruthy();
    expect(statusBar.textContent).toContain('Projekte.base');

    // Check Open in Editor button
    const openBtn = container.querySelector('.base-embed-open-btn') as HTMLButtonElement;
    expect(openBtn).toBeTruthy();
    expect(openBtn.getAttribute('title')).toMatch(/Im Editor öffnen|Open in Editor/);

    await act(async () => {
      openBtn.click();
    });
    expect(handleOpenNote).toHaveBeenCalledWith('Projekte.base');

    // Check Table view is rendered by default
    expect(container.querySelector('.base-table')).toBeTruthy();
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Beta');
  });

  it('switches views via status bar pills', async () => {
    await act(async () => {
      root.render(
        <BaseEmbedWidget
          basePath="Dashboard.base"
          onOpenNote={vi.fn()}
          rawContent={sampleYaml}
          allNotes={mockNotes}
        />
      );
    });

    const pills = container.querySelectorAll('.base-embed-pill-btn');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toContain('Tabelle');
    expect(pills[1].textContent).toContain('Karten');

    // Table view active first
    expect(container.querySelector('.base-table')).toBeTruthy();
    expect(container.querySelector('.base-cards-grid')).toBeNull();

    // Click on Cards pill
    await act(async () => {
      (pills[1] as HTMLButtonElement).click();
    });

    // Cards view rendered
    expect(container.querySelector('.base-cards-grid')).toBeTruthy();
    expect(container.querySelector('.base-table')).toBeNull();
  });

  it('transforms ![[Name.base]] in renderReadingHtml into embedded base container', () => {
    const markdown = 'Hier ist mein Dashboard:\n\n![[Aufgaben.base]]\n\nWeiterer Text';
    const allNotesList = [
      { path: 'Aufgaben.base', name: 'Aufgaben.base', basename: 'Aufgaben' },
      { path: 'Note.md', name: 'Note.md', basename: 'Note' },
    ];

    const html = renderReadingHtml(markdown, 'Note.md', allNotesList);

    expect(html).toContain('cm-lp-base-embed');
    expect(html).toContain('embedded-base-container');
    expect(html).toContain('base-embed-widget');
    expect(html).toContain('reading-base-embed');
    expect(html).toContain('data-base-path="Aufgaben.base"');
  });

  it('transforms ![[Name]] into embedded base when matching .base file exists in vault', () => {
    const markdown = 'Embed without extension:\n\n![[Tracker]]\n';
    const allNotesList = [
      { path: 'Tracker.base', name: 'Tracker.base', basename: 'Tracker' },
    ];

    const html = renderReadingHtml(markdown, 'Index.md', allNotesList);

    expect(html).toContain('reading-base-embed');
    expect(html).toContain('data-base-path="Tracker.base"');
  });

  it('transforms ![[Name.base#View|Height]] and preserves data-view and data-height through sanitize', () => {
    const markdown = 'With view and height:\n\n![[Projekt.base#Karten|450]]\n\nWith only height:\n\n![[Projekt.base|350]]\n';
    const allNotesList = [
      { path: 'Projekt.base', name: 'Projekt.base', basename: 'Projekt' },
    ];

    const html = renderReadingHtml(markdown, 'Note.md', allNotesList);

    expect(html).toContain('data-base-path="Projekt.base"');
    expect(html).toContain('data-view="Karten"');
    expect(html).toContain('data-height="450"');
    expect(html).toContain('data-height="350"');
  });

  it('applies initialView and height to BaseEmbedWidget', async () => {
    await act(async () => {
      root.render(
        <BaseEmbedWidget
          basePath="Dashboard.base"
          initialView="Karten"
          height={420}
          onOpenNote={vi.fn()}
          rawContent={sampleYaml}
          allNotes={mockNotes}
        />
      );
    });

    const widget = container.querySelector('.base-embed-widget') as HTMLElement;
    expect(widget).toBeTruthy();
    expect(widget.style.height).toBe('420px');

    // "Karten" view should be active initially instead of default table
    expect(container.querySelector('.base-cards-grid')).toBeTruthy();
    expect(container.querySelector('.base-table')).toBeNull();
  });

  it('detectFileType recognizes .base files as "base"', () => {
    expect(detectFileType('Test.base')).toBe('base');
    expect(detectFileType('Folder/Sub/Data.BASE')).toBe('base');
  });

  it('resolves Canvas path via allNotes and renders borderless layout', async () => {
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Diagrams/Architecture.canvas',
      name: 'Architecture.canvas',
      rawContent: JSON.stringify({ nodes: [], edges: [] }),
    } as any);

    const allNotes = [
      {
        path: 'Diagrams/Architecture.canvas',
        name: 'Architecture.canvas',
        basename: 'Architecture',
      },
    ];

    await act(async () => {
      root.render(
        <CanvasEmbedWidget
          canvasPath="Architecture.canvas"
          onOpenNote={vi.fn()}
          allNotes={allNotes}
        />
      );
    });

    const widget = container.querySelector('.canvas-embed-widget') as HTMLElement;
    expect(widget).toBeTruthy();
    expect(widget.classList.contains('embedded-canvas-container')).toBe(true);
    expect(widget.classList.contains('cm-lp-canvas-embed')).toBe(true);
    expect(container.textContent).toContain('Architecture.canvas');

    // api.getNote should have been called with the resolved path "Diagrams/Architecture.canvas"
    expect(getNoteSpy).toHaveBeenCalledWith('Diagrams/Architecture.canvas');
    getNoteSpy.mockRestore();
  });

  it('transforms ![[Name.canvas|height]] into embedded-canvas-container with data-height and mount point', () => {
    const markdown = 'Here is a canvas:\n\n![[Workflow.canvas|550]]\n';
    const allNotes = [
      { path: 'Workflow.canvas', name: 'Workflow.canvas', basename: 'Workflow' },
    ];

    const html = renderReadingHtml(markdown, 'Note.md', allNotes);

    expect(html).toContain('embedded-canvas-container');
    expect(html).toContain('canvas-embed-widget');
    expect(html).toContain('data-canvas-path="Workflow.canvas"');
    expect(html).toContain('data-height="550"');
    expect(html).toContain('reading-canvas-mount');
  });

  it('supports fullSize and custom height on CanvasEmbedWidget', async () => {
    vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Diagram.canvas',
      name: 'Diagram.canvas',
      rawContent: JSON.stringify({ nodes: [], edges: [] }),
    } as any);

    await act(async () => {
      root.render(
        <CanvasEmbedWidget
          canvasPath="Diagram.canvas"
          onOpenNote={vi.fn()}
          allNotes={[]}
          height={480}
        />
      );
    });

    let widget = container.querySelector('.canvas-embed-widget') as HTMLElement;
    expect(widget).toBeTruthy();
    expect(widget.style.height).toBe('480px');

    await act(async () => {
      root.render(
        <CanvasEmbedWidget
          canvasPath="Diagram.canvas"
          onOpenNote={vi.fn()}
          allNotes={[]}
          fullSize={true}
        />
      );
    });

    widget = container.querySelector('.canvas-embed-widget') as HTMLElement;
    expect(widget.style.height).toBe('100%');
  });

  it('defaults to 380px height when height is omitted or empty on CanvasEmbedWidget', async () => {
    vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Diagram.canvas',
      name: 'Diagram.canvas',
      rawContent: JSON.stringify({ nodes: [], edges: [] }),
    } as any);

    await act(async () => {
      root.render(
        <CanvasEmbedWidget
          canvasPath="Diagram.canvas"
          onOpenNote={vi.fn()}
          allNotes={[]}
          height=""
        />
      );
    });

    const widget = container.querySelector('.canvas-embed-widget') as HTMLElement;
    expect(widget).toBeTruthy();
    expect(widget.style.height).toBe('380px');
    const viewport = container.querySelector('.canvas-embed-viewport') as HTMLElement;
    expect(viewport).toBeTruthy();
    expect(viewport.style.minHeight).toBe('342px');
  });

  it('resolves relative canvas path based on currentNotePath folder', async () => {
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue({
      path: 'Projects/Sub/Arch.canvas',
      name: 'Arch.canvas',
      rawContent: JSON.stringify({ nodes: [], edges: [] }),
    } as any);

    const allNotes = [
      { path: 'Archive/Arch.canvas', name: 'Arch.canvas', basename: 'Arch' },
      { path: 'Projects/Sub/Arch.canvas', name: 'Arch.canvas', basename: 'Arch' },
    ];

    await act(async () => {
      root.render(
        <CanvasEmbedWidget
          canvasPath="Arch.canvas"
          currentNotePath="Projects/Sub/Meeting.md"
          onOpenNote={vi.fn()}
          allNotes={allNotes}
        />
      );
    });

    expect(getNoteSpy).toHaveBeenCalledWith('Projects/Sub/Arch.canvas');
    getNoteSpy.mockRestore();
  });

  it('resolves extensionless ![[Workflow]] to Workflow.canvas in renderReadingHtml', () => {
    const markdown = 'Embed: ![[Workflow]]';
    const allNotes = [
      { path: 'Diagrams/Workflow.canvas', name: 'Workflow.canvas', basename: 'Workflow' },
    ];

    const html = renderReadingHtml(markdown, 'Note.md', allNotes);
    expect(html).toContain('embedded-canvas-container');
    expect(html).toContain('data-canvas-path="Diagrams/Workflow.canvas"');
  });
});
