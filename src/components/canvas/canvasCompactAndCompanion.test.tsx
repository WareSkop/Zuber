/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { api } from '../../api';
import { CanvasContext } from './CanvasContext';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasInspector } from './CanvasInspector';
import { CanvasToolbar } from './CanvasToolbar';
import { FileSidebar } from '../FileSidebar';
import {
  buildCanvasTreeModel,
  extractDisplayDomain,
  findParentCanvasForCompanionFile,
} from '../../utils/canvasTreeUtils';
import type {
  AggregatedExternalLink,
  CanvasTreeMetadata,
  FileTreeNode,
  NoteData,
} from '../../../shared/types';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeNodeProps(
  id: string,
  type: string,
  data: Record<string, unknown>,
  selected = false
): NodeProps {
  return {
    id,
    type,
    data,
    selected,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

function makeNote(path: string, body: string): NoteData {
  return {
    path,
    name: path.split('/').pop() || path,
    rawContent: body,
    body,
    frontmatter: {},
    properties: [],
    links: [],
    embeds: [],
    tags: [],
    headings: [],
    updatedAt: 1000,
  };
}

describe('Canvas Compact/Preview File Nodes, Toolbar, Companion Tree & External Links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('1. CanvasFileNode renders compact card for .md and .pdf without fetching Markdown preview', () => {
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue(makeNote('Folder/Note.md', '# Hello'));
    const onOpenNote = vi.fn();

    // A: Compact .md node strips .md and renders no scroll/markdown body
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider value={{ onOpenNote, allNotes: [] }}>
            <CanvasFileNode
              {...makeNodeProps('n-md-card', 'canvasFile', {
                rawType: 'file',
                file: 'Folder/Note.md',
                displayMode: 'card',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const cardNode = container.querySelector('.canvas-file-node.is-compact-card');
    expect(cardNode).not.toBeNull();
    const titleEl = container.querySelector('.canvas-file-compact-title');
    expect(titleEl?.textContent).toBe('Note');
    expect(container.querySelector('.canvas-file-markdown')).toBeNull();
    expect(getNoteSpy).not.toHaveBeenCalled();

    const openBtn = container.querySelector('.canvas-file-open-btn') as HTMLButtonElement | null;
    expect(openBtn).not.toBeNull();
    act(() => {
      openBtn?.click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('Folder/Note.md');

    // B: Compact .pdf node preserves .pdf extension and shows PDF badge
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider value={{ onOpenNote, allNotes: [] }}>
            <CanvasFileNode
              {...makeNodeProps('n-pdf-card', 'canvasFile', {
                rawType: 'file',
                file: 'Docs/Architecture.pdf',
                displayMode: 'card',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    expect(container.querySelector('.canvas-file-node.is-compact-card')).not.toBeNull();
    expect(container.querySelector('.canvas-file-compact-title')?.textContent).toBe('Architecture.pdf');
    expect(container.querySelector('.canvas-file-pdf-badge')?.textContent).toBe('PDF');

    const pdfOpenBtn = container.querySelector('.canvas-file-open-btn') as HTMLButtonElement | null;
    act(() => {
      pdfOpenBtn?.click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('Docs/Architecture.pdf');
  });

  it('2. CanvasFileNode renders embedded PDF iframe in preview mode with selection-gated pointerEvents', () => {
    const onOpenNote = vi.fn();

    // Unselected PDF preview: iframe pointerEvents is 'none' so canvas pan/drag works smoothly
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider value={{ onOpenNote, allNotes: [] }}>
            <CanvasFileNode
              {...makeNodeProps(
                'n-pdf-prev',
                'canvasFile',
                {
                  rawType: 'file',
                  file: 'Docs/Manual.pdf',
                  displayMode: 'preview',
                },
                false
              )}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    let iframe = container.querySelector('iframe.canvas-file-pdf-iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toContain('/api/vault/attachment');
    expect(iframe?.getAttribute('src')).toContain('#toolbar=1&view=FitH');
    expect(iframe?.style.pointerEvents).toBe('none');

    // Selected PDF preview: iframe pointerEvents switches to 'auto' for interactive PDF scrolling
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider value={{ onOpenNote, allNotes: [] }}>
            <CanvasFileNode
              {...makeNodeProps(
                'n-pdf-prev',
                'canvasFile',
                {
                  rawType: 'file',
                  file: 'Docs/Manual.pdf',
                  displayMode: 'preview',
                },
                true
              )}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    iframe = container.querySelector('iframe.canvas-file-pdf-iframe') as HTMLIFrameElement | null;
    expect(iframe?.style.pointerEvents).toBe('auto');
  });

  it('3. CanvasFileNode keeps legacy .md nodes without displayMode in preview mode', async () => {
    const getNoteSpy = vi.spyOn(api, 'getNote').mockResolvedValue(
      makeNote('Legacy.md', '# Legacy Heading\n\nLegacy paragraph content.')
    );

    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider value={{ onOpenNote: vi.fn(), allNotes: [] }}>
            <CanvasFileNode
              {...makeNodeProps('n-legacy', 'canvasFile', {
                rawType: 'file',
                file: 'Legacy.md',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getNoteSpy).toHaveBeenCalledWith('Legacy.md');
    expect(container.querySelector('.canvas-file-node.is-compact-card')).toBeNull();
    const mdEl = container.querySelector('.canvas-file-markdown');
    expect(mdEl).not.toBeNull();
    expect(mdEl?.textContent).toContain('Legacy Heading');
  });

  it('4. CanvasInspector shows Card/Preview toggle only for .md and .pdf file nodes', () => {
    const onToggleFileDisplayMode = vi.fn();

    // A: .md file node in card mode
    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={{
            id: 'node-md',
            type: 'canvasFile',
            position: { x: 0, y: 0 },
            data: { rawType: 'file', file: 'Notes/Alpha.md', displayMode: 'card' },
          }}
          selectedEdge={null}
          onUpdateNodeData={vi.fn()}
          onToggleFileDisplayMode={onToggleFileDisplayMode}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[]}
        />
      );
    });

    let toggleButtons = container.querySelectorAll('.inspector-display-mode-toggle .inspector-mode-toggle-btn');
    expect(toggleButtons.length).toBe(2);
    expect(toggleButtons[0].classList.contains('active')).toBe(true);
    expect(toggleButtons[1].classList.contains('active')).toBe(false);

    act(() => {
      (toggleButtons[1] as HTMLButtonElement).click();
    });
    expect(onToggleFileDisplayMode).toHaveBeenCalledWith('node-md', 'preview');

    // B: .pdf file node in preview mode
    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={{
            id: 'node-pdf',
            type: 'canvasFile',
            position: { x: 0, y: 0 },
            data: { rawType: 'file', file: 'Docs/Spec.pdf', displayMode: 'preview' },
          }}
          selectedEdge={null}
          onUpdateNodeData={vi.fn()}
          onToggleFileDisplayMode={onToggleFileDisplayMode}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[]}
        />
      );
    });

    toggleButtons = container.querySelectorAll('.inspector-display-mode-toggle .inspector-mode-toggle-btn');
    expect(toggleButtons.length).toBe(2);
    expect(toggleButtons[0].classList.contains('active')).toBe(false);
    expect(toggleButtons[1].classList.contains('active')).toBe(true);

    act(() => {
      (toggleButtons[0] as HTMLButtonElement).click();
    });
    expect(onToggleFileDisplayMode).toHaveBeenCalledWith('node-pdf', 'card');

    // C: Image file node omits display mode toggle
    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={{
            id: 'node-img',
            type: 'canvasFile',
            position: { x: 0, y: 0 },
            data: { rawType: 'file', file: 'img/pic.png' },
          }}
          selectedEdge={null}
          onUpdateNodeData={vi.fn()}
          onToggleFileDisplayMode={onToggleFileDisplayMode}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[]}
        />
      );
    });
    expect(container.querySelector('.inspector-display-mode-toggle')).toBeNull();

    // D: Shape node omits display mode toggle
    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={{
            id: 'node-shape',
            type: 'canvasShape',
            position: { x: 0, y: 0 },
            data: { rawType: 'text', text: 'Hello', shape: 'rectangle' },
          }}
          selectedEdge={null}
          onUpdateNodeData={vi.fn()}
          onToggleFileDisplayMode={onToggleFileDisplayMode}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[]}
        />
      );
    });
    expect(container.querySelector('.inspector-display-mode-toggle')).toBeNull();
  });

  it('5. CanvasToolbar supports + New Note, PDF entries in Embed picker, and assetsFolder settings', () => {
    const onRequestCreateNote = vi.fn();
    const onAddFileNode = vi.fn();
    const onChangeAssetsFolder = vi.fn();

    act(() => {
      root.render(
        <CanvasToolbar
          onAddTextNode={vi.fn()}
          onAddFileNode={onAddFileNode}
          onAddGroupNode={vi.fn()}
          onFitView={vi.fn()}
          gridMode="dots"
          canUndo={false}
          canRedo={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          allNotes={[{ path: 'Alpha.md', name: 'Alpha.md', basename: 'Alpha' }]}
          allFiles={[
            { path: 'Alpha.md', name: 'Alpha.md', basename: 'Alpha' },
            { path: 'Docs/Spec.pdf', name: 'Spec.pdf', basename: 'Spec' },
            { path: 'Img/diagram.png', name: 'diagram.png', basename: 'diagram' },
          ]}
          onRequestCreateNote={onRequestCreateNote}
          assetsFolder="Custom/Assets"
          defaultAssetsFolder="Projects/Board.canvas.assets"
          onChangeAssetsFolder={onChangeAssetsFolder}
        />
      );
    });

    // Click "+ New Note" button
    const newNoteBtn = Array.from(container.querySelectorAll('.canvas-toolbar-btn')).find((b) =>
      b.textContent?.includes('New Note')
    ) as HTMLButtonElement | undefined;
    expect(newNoteBtn).toBeDefined();
    act(() => {
      newNoteBtn?.click();
    });
    expect(onRequestCreateNote).toHaveBeenCalledTimes(1);

    // Open Embed File picker -> includes Spec.pdf and Alpha.md
    const embedBtn = Array.from(container.querySelectorAll('.canvas-toolbar-btn')).find((b) =>
      b.textContent?.includes('Embed')
    ) as HTMLButtonElement | undefined;
    expect(embedBtn).toBeDefined();
    act(() => {
      embedBtn?.click();
    });

    const pickerMenu = container.querySelector('.canvas-file-picker-menu');
    expect(pickerMenu?.textContent).toContain('Alpha');
    expect(pickerMenu?.textContent).toContain('Spec.pdf');
    expect(pickerMenu?.textContent).not.toContain('diagram.png');

    const pdfOption = Array.from(container.querySelectorAll('.canvas-dropdown-item')).find((b) =>
      b.textContent?.includes('Docs/Spec.pdf')
    ) as HTMLButtonElement | undefined;
    act(() => {
      pdfOption?.click();
    });
    expect(onAddFileNode).toHaveBeenCalledWith('Docs/Spec.pdf');

    // Open Canvas Settings -> update & reset assetsFolder
    const settingsBtn = container.querySelector('button[aria-label="Canvas companion folder settings"]') as HTMLButtonElement | null;
    expect(settingsBtn).not.toBeNull();
    act(() => {
      settingsBtn?.click();
    });

    const input = container.querySelector('.canvas-settings-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Custom/Assets');

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '/Projects/SharedAssets/');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveBtn = container.querySelector('.canvas-settings-btn.primary') as HTMLButtonElement | null;
    act(() => {
      saveBtn?.click();
    });
    expect(onChangeAssetsFolder).toHaveBeenCalledWith('Projects/SharedAssets');

    // Re-open and reset to default
    act(() => {
      settingsBtn?.click();
    });
    const resetBtn = Array.from(container.querySelectorAll('.canvas-settings-btn')).find(
      (b) => !b.classList.contains('primary')
    ) as HTMLButtonElement | undefined;
    act(() => {
      resetBtn?.click();
    });
    expect(onChangeAssetsFolder).toHaveBeenLastCalledWith(undefined);
  });

  it('6. canvasTreeUtils suppresses companion folders, splits direct/linked/external children, and extracts domains', () => {
    expect(extractDisplayDomain('https://www.example.com/docs/page')).toBe('example.com');
    expect(extractDisplayDomain('https://zuber.dev/guide')).toBe('zuber.dev');

    const tree: FileTreeNode[] = [
      {
        name: 'Projects',
        path: 'Projects',
        type: 'folder',
        children: [
          {
            name: 'Board.canvas',
            path: 'Projects/Board.canvas',
            type: 'file',
            extension: 'canvas',
            attachmentKind: 'canvas',
          },
          {
            name: 'Board.canvas.assets',
            path: 'Projects/Board.canvas.assets',
            type: 'folder',
            children: [
              {
                name: 'Idea.md',
                path: 'Projects/Board.canvas.assets/Idea.md',
                type: 'file',
                extension: 'md',
              },
              {
                name: 'Diagram.png',
                path: 'Projects/Board.canvas.assets/Diagram.png',
                type: 'file',
                extension: 'png',
                attachmentKind: 'image',
              },
            ],
          },
        ],
      },
      {
        name: 'Shared',
        path: 'Shared',
        type: 'folder',
        children: [
          {
            name: 'Overview.md',
            path: 'Shared/Overview.md',
            type: 'file',
            extension: 'md',
          },
        ],
      },
    ];

    const canvasMeta: Record<string, CanvasTreeMetadata> = {
      'Projects/Board.canvas': {
        canvasPath: 'Projects/Board.canvas',
        assetsFolder: 'Projects/Board.canvas.assets',
        referencedFiles: [
          'Projects/Board.canvas.assets/Idea.md', // inside companion -> not duplicated in linkedFiles
          'Shared/Overview.md',
          'Shared/Overview.md', // duplicate -> deduplicated
          'Projects/Board.canvas', // self -> skipped
        ],
        externalLinks: [{ url: 'https://example.org/spec', title: 'Spec Site' }],
      },
    };

    const model = buildCanvasTreeModel(tree, canvasMeta, 'name-asc');
    expect(model.suppressedFolderPaths.has('Projects/Board.canvas.assets')).toBe(true);

    const children = model.canvasChildrenByPath.get('Projects/Board.canvas');
    expect(children).toBeDefined();
    expect(children?.directFiles.map((f) => f.path)).toEqual([
      'Projects/Board.canvas.assets/Diagram.png',
      'Projects/Board.canvas.assets/Idea.md',
    ]);
    expect(children?.linkedFiles.map((f) => f.path)).toEqual(['Shared/Overview.md']);
    expect(children?.externalLinks).toEqual([{ url: 'https://example.org/spec', title: 'Spec Site' }]);
    expect(findParentCanvasForCompanionFile('Projects/Board.canvas.assets/Idea.md', model)).toBe(
      'Projects/Board.canvas'
    );
  });

  it('7. FileSidebar hides companion folder, renders virtual canvas children, emits x-zuber-file drag payload, and filters External Links', () => {
    const onSelectNote = vi.fn();
    const onOpenExternalUrl = vi.fn();

    const tree: FileTreeNode[] = [
      {
        name: 'Board.canvas',
        path: 'Board.canvas',
        type: 'file',
        extension: 'canvas',
        attachmentKind: 'canvas',
      },
      {
        name: 'Board.canvas.assets',
        path: 'Board.canvas.assets',
        type: 'folder',
        children: [
          {
            name: 'NoteA.md',
            path: 'Board.canvas.assets/NoteA.md',
            type: 'file',
            extension: 'md',
          },
        ],
      },
      {
        name: 'Reference.pdf',
        path: 'Reference.pdf',
        type: 'file',
        extension: 'pdf',
        attachmentKind: 'pdf',
      },
    ];

    const canvasMeta: Record<string, CanvasTreeMetadata> = {
      'Board.canvas': {
        canvasPath: 'Board.canvas',
        assetsFolder: 'Board.canvas.assets',
        referencedFiles: ['Board.canvas.assets/NoteA.md', 'Reference.pdf'],
        externalLinks: [{ url: 'https://jsoncanvas.org/spec/1.0/', title: 'JSON Canvas Spec' }],
      },
    };

    const externalLinks: AggregatedExternalLink[] = [
      {
        url: 'https://jsoncanvas.org/spec/1.0/',
        domain: 'jsoncanvas.org',
        title: 'JSON Canvas Spec',
        sources: [{ path: 'Board.canvas', name: 'Board.canvas', kind: 'canvas' }],
      },
      {
        url: 'https://vitest.dev/',
        domain: 'vitest.dev',
        title: 'Vitest Docs',
        sources: [{ path: 'Board.canvas.assets/NoteA.md', name: 'NoteA', kind: 'markdown' }],
      },
    ];

    act(() => {
      root.render(
        <FileSidebar
          tree={tree}
          activePath={null}
          tags={[]}
          selectedTagFilter={null}
          onSelectTagFilter={vi.fn()}
          onClose={vi.fn()}
          onSelectNote={onSelectNote}
          onCreateNote={vi.fn()}
          onCreateCanvas={vi.fn()}
          onCreateFolder={vi.fn()}
          onRenameEntry={vi.fn()}
          onDeleteEntry={vi.fn()}
          onRefresh={vi.fn()}
          onOpenDailyNote={vi.fn()}
          onOpenTemplateSelect={vi.fn()}
          canvasMeta={canvasMeta}
          externalLinks={externalLinks}
          onOpenExternalUrl={onOpenExternalUrl}
        />
      );
    });

    // Standalone companion folder is hidden from folder rows
    const folderLabels = Array.from(container.querySelectorAll('.tree-folder-item .tree-label')).map(
      (el) => el.textContent
    );
    expect(folderLabels).not.toContain('Board.canvas.assets');

    // Expand Board.canvas virtual children via chevron button
    const chevronBtn = container.querySelector('.tree-canvas-chevron-btn') as HTMLButtonElement | null;
    expect(chevronBtn).not.toBeNull();
    act(() => {
      chevronBtn?.click();
    });

    const virtualTree = container.querySelector('.tree-canvas-children');
    expect(virtualTree).not.toBeNull();
    expect(virtualTree?.textContent).toContain('NoteA');
    expect(virtualTree?.querySelector('.canvas-linked-file-item')?.textContent).toContain('Reference.pdf');
    expect(virtualTree?.querySelector('.canvas-external-link-item')?.textContent).toContain('JSON Canvas Spec');

    // Dragstart on Reference.pdf emits application/x-zuber-file JSON payload
    const refRow = Array.from(container.querySelectorAll('.tree-file-item')).find(
      (el) => !el.classList.contains('canvas-linked-file-item') && el.textContent?.includes('Reference.pdf')
    ) as HTMLElement | undefined;
    expect(refRow).toBeDefined();

    const setDataMock = vi.fn();
    const dragEvt = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEvt, 'dataTransfer', {
      value: { setData: setDataMock, effectAllowed: '' },
    });
    act(() => {
      refRow?.dispatchEvent(dragEvt);
    });
    const zuberDragCall = setDataMock.mock.calls.find((c) => c[0] === 'application/x-zuber-file');
    expect(zuberDragCall).toBeDefined();
    expect(JSON.parse(zuberDragCall![1])).toMatchObject({
      path: 'Reference.pdf',
      name: 'Reference.pdf',
      kind: 'pdf',
    });

    // Expand bottom Global External Links section
    const extHeader = container.querySelector('.sidebar-external-links-header') as HTMLButtonElement | null;
    expect(extHeader).not.toBeNull();
    expect(extHeader?.textContent).toContain('(2)');
    act(() => {
      extHeader?.click();
    });

    let rows = container.querySelectorAll('.external-link-row');
    expect(rows.length).toBe(2);

    // Filter External Links by "vitest"
    const filterInput = container.querySelector('.sidebar-external-links-filter input') as HTMLInputElement | null;
    expect(filterInput).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(filterInput, 'vitest');
      filterInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    rows = container.querySelectorAll('.external-link-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Vitest Docs');

    // Toggle source chips and click source note chip
    const srcBadge = container.querySelector('.external-link-sources-btn') as HTMLButtonElement | null;
    act(() => {
      srcBadge?.click();
    });
    const chip = container.querySelector('.external-link-source-chip') as HTMLButtonElement | null;
    expect(chip?.textContent).toContain('NoteA');
    act(() => {
      chip?.click();
    });
    expect(onSelectNote).toHaveBeenCalledWith('Board.canvas.assets/NoteA.md');

    // Click external link row
    act(() => {
      (rows[0] as HTMLElement).click();
    });
    expect(onOpenExternalUrl).toHaveBeenCalledWith('https://vitest.dev/', expect.any(Object));
  });
});
