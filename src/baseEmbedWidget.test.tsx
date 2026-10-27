/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseEmbedWidget } from './components/base/BaseEmbedWidget';
import { renderReadingHtml } from './utils/readingMode';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});
