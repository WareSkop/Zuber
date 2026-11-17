/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'fs';
import path from 'path';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { NoteData } from '../../../shared/types';
import { api } from '../../api';
import { jsonCanvasToReactFlow, reactFlowToJsonCanvas } from './canvasMapper';
import { CanvasContext } from './CanvasContext';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasEmbedWidget } from './CanvasEmbedWidget';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasInspector } from './CanvasInspector';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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

function makeNodeProps(id: string, type: string, data: Record<string, unknown>): NodeProps {
  return {
    id,
    type,
    data,
    selected: false,
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

describe('Canvas Images, Embed Rendering, Shapes, Links & Cycle Guard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('1. preserves shape and link on file nodes in canvasMapper roundtrip', () => {
    const doc = {
      nodes: [
        {
          id: 'img-1',
          type: 'file' as const,
          file: 'attachments/avatar.png',
          x: 100,
          y: 200,
          width: 240,
          height: 240,
          shape: 'circle' as const,
          link: 'People/Alice.md',
        },
      ],
      edges: [],
    };

    const rf = jsonCanvasToReactFlow(doc);
    expect(rf.nodes[0].type).toBe('canvasFile');
    expect(rf.nodes[0].data.shape).toBe('circle');
    expect(rf.nodes[0].data.linkUrl).toBe('People/Alice.md');

    const serialized = JSON.parse(reactFlowToJsonCanvas(rf.nodes, rf.edges));
    expect(serialized.nodes[0].shape).toBe('circle');
    expect(serialized.nodes[0].link).toBe('People/Alice.md');
    expect(serialized.nodes[0].file).toBe('attachments/avatar.png');
  });

  it('2. renders ![[image.jpeg]] inside embedded Markdown notes in CanvasFileNode as <img> instead of a broken link', async () => {
    vi.spyOn(api, 'getNote').mockResolvedValue(
      makeNote('Fest.md', '# Fest\n\n![[attachments/Gemini_Generated_Image_1.jpeg]]')
    );

    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              allNotes: [],
              currentCanvasPath: 'Testcanvas2.canvas',
              ancestorPaths: ['Testcanvas2.canvas'],
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('node-fest', 'canvasFile', { rawType: 'file', file: 'Fest.md' })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const img = container.querySelector('.canvas-file-markdown img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('/api/vault/attachment');
    expect(img?.getAttribute('src')).toContain('Gemini_Generated_Image_1.jpeg');
    expect(container.textContent).not.toContain('! attachments/');
  });

  it('3. prevents infinite recursion when Fest.md embeds ![[Testcanvas2.canvas]] or CanvasFileNode references an ancestor', async () => {
    const onOpenNote = vi.fn();
    vi.spyOn(api, 'getNote').mockResolvedValue(
      makeNote('Fest.md', '# Fest\n\n![[Testcanvas2.canvas]]')
    );

    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes: [{ path: 'Testcanvas2.canvas', name: 'Testcanvas2.canvas', basename: 'Testcanvas2' }],
              currentCanvasPath: 'Testcanvas2.canvas',
              ancestorPaths: ['Testcanvas2.canvas'],
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('node-fest-cycle', 'canvasFile', { rawType: 'file', file: 'Fest.md' })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const cycleBtn = container.querySelector('.canvas-file-safe-embed-btn.is-cycle') as HTMLButtonElement | null;
    expect(cycleBtn).not.toBeNull();
    expect(cycleBtn?.textContent).toContain('Circular embed prevented');
    expect(cycleBtn?.textContent).toContain('Testcanvas2.canvas');
    expect(container.querySelector('.canvas-embed-viewport')).toBeNull();

    act(() => {
      cycleBtn?.click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('Testcanvas2.canvas');
  });

  it('4. blocks recursive CanvasEmbedWidget load when target matches ancestorPaths', async () => {
    const getNoteSpy = vi.spyOn(api, 'getNote');

    await act(async () => {
      root.render(
        <CanvasContext.Provider
          value={{
            onOpenNote: vi.fn(),
            allNotes: [{ path: 'Testcanvas2.canvas', name: 'Testcanvas2.canvas', basename: 'Testcanvas2' }],
            ancestorPaths: ['Testcanvas2.canvas'],
          }}
        >
          <CanvasEmbedWidget
            canvasPath="Testcanvas2.canvas"
            onOpenNote={vi.fn()}
            allNotes={[{ path: 'Testcanvas2.canvas', name: 'Testcanvas2.canvas', basename: 'Testcanvas2' }]}
            currentNotePath="Fest.md"
          />
        </CanvasContext.Provider>
      );
    });

    expect(getNoteSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.canvas-embed-cycle-guard')).not.toBeNull();
  });

  it('5. renders ![[image.png]] inside CanvasShapeNode as <img> instead of a broken link', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              allNotes: [],
              currentCanvasPath: 'Testcanvas2.canvas',
            }}
          >
            <CanvasShapeNode
              {...makeNodeProps('shape-img', 'canvasShape', {
                rawType: 'text',
                text: 'Caption\n\n![[attachments/photo.png|200]]',
                shape: 'rectangle',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const img = container.querySelector('.canvas-shape-inline-image') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('/api/vault/attachment');
    expect(img?.getAttribute('style')).toContain('max-width:200px');
    expect(container.textContent).not.toContain('! attachments/');
  });

  it('6. renders shaped image node (circle) with SVG clipPath and clickable internal/external links', () => {
    const onOpenNote = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    // A: Circular image with internal note link in readOnly mode
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes: [],
              readOnly: true,
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('img-circle', 'canvasFile', {
                rawType: 'file',
                file: 'attachments/portrait.png',
                shape: 'circle',
                linkUrl: 'Projects/Plan.md',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    expect(container.querySelector('.canvas-file-node.is-shaped-image.shape-circle')).not.toBeNull();
    const circleImg = container.querySelector('.canvas-file-shaped-img') as HTMLImageElement | null;
    expect(circleImg).not.toBeNull();
    expect(circleImg?.style.clipPath).toContain('ellipse(48% 48% at 50% 50%)');
    expect(container.querySelector('clipPath g')).toBeNull();
    expect(container.querySelector('.canvas-file-header')).toBeNull();

    const imgWrapper = container.querySelector('.canvas-file-shaped-image-wrapper') as HTMLElement;
    act(() => {
      imgWrapper.click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('Projects/Plan.md');

    // B: Cloud shape uses direct <path> inside <clipPath> (no <g> wrapper)
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes: [],
              readOnly: false,
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('img-cloud', 'canvasFile', {
                rawType: 'file',
                file: 'attachments/sky.png',
                shape: 'cloud',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    expect(container.querySelector('clipPath path')).not.toBeNull();
    expect(container.querySelector('clipPath g')).toBeNull();

    // C: External URL link badge click on diamond shaped image
    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes: [],
              readOnly: false,
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('img-ext', 'canvasFile', {
                rawType: 'file',
                file: 'attachments/banner.jpg',
                shape: 'diamond',
                linkUrl: 'https://example.com/docs',
              })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const badge = container.querySelector('.canvas-file-link-badge') as HTMLButtonElement | null;
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('example.com');
    act(() => {
      badge?.click();
    });
    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
  });

  it('7. CanvasToolbar offers Image picker and CanvasInspector offers Shape + Link for image nodes', () => {
    const onAddFileNode = vi.fn();
    const onUploadImageFiles = vi.fn();
    const onUpdateNodeData = vi.fn();

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
          allNotes={[]}
          allFiles={[
            { path: 'Fest.md', name: 'Fest.md', basename: 'Fest' },
            { path: 'attachments/pic.png', name: 'pic.png', basename: 'pic' },
            { path: 'Vault/attachments/secret.webp.zenc', name: 'secret.webp.zenc', basename: 'secret' },
          ]}
          onUploadImageFiles={onUploadImageFiles}
        />
      );
    });

    const imgToolbarBtn = Array.from(container.querySelectorAll('.canvas-toolbar-btn')).find((b) =>
      b.textContent?.includes('Image')
    ) as HTMLButtonElement;
    expect(imgToolbarBtn).toBeDefined();

    act(() => {
      imgToolbarBtn.click();
    });

    const dropdownText = container.querySelector('.canvas-file-picker-menu')?.textContent || '';
    expect(dropdownText).toContain('Upload image from device');
    expect(dropdownText).toContain('attachments/pic.png');
    expect(dropdownText).toContain('Vault/attachments/secret.webp');
    expect(dropdownText).not.toContain('Fest.md');

    const pickPic = Array.from(container.querySelectorAll('.canvas-dropdown-item')).find((b) =>
      b.textContent?.includes('attachments/pic.png')
    ) as HTMLButtonElement;
    act(() => {
      pickPic.click();
    });
    expect(onAddFileNode).toHaveBeenCalledWith('attachments/pic.png');

    // Inspector with selected image file node
    const selectedImageNode: any = {
      id: 'node-img-1',
      type: 'canvasFile',
      position: { x: 0, y: 0 },
      data: { rawType: 'file', file: 'attachments/pic.png', shape: 'rectangle', linkUrl: '' },
    };

    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={selectedImageNode}
          selectedEdge={null}
          onUpdateNodeData={onUpdateNodeData}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[{ path: 'Fest.md', name: 'Fest.md', basename: 'Fest' }]}
        />
      );
    });

    const shapeBtn = Array.from(container.querySelectorAll('.inspector-tool-btn')).find((b) =>
      b.textContent?.includes('Shape')
    ) as HTMLButtonElement;
    expect(shapeBtn).toBeDefined();

    // Open Shape popover: verify 11 icon-only tiles with title tooltips & no visible text labels
    act(() => {
      shapeBtn.click();
    });
    const gridItems = Array.from(container.querySelectorAll('.shapes-grid .inspector-grid-item'));
    expect(gridItems.length).toBe(11);
    for (const item of gridItems) {
      expect(item.querySelector('svg')).not.toBeNull();
      expect((item.textContent || '').trim()).toBe('');
      expect((item.getAttribute('title') || '').length).toBeGreaterThan(0);
    }

    const linkBtn = Array.from(container.querySelectorAll('.inspector-tool-btn')).find((b) =>
      b.textContent?.includes('Link')
    ) as HTMLButtonElement;
    expect(linkBtn).toBeDefined();

    act(() => {
      linkBtn.click();
    });

    const festItem = Array.from(container.querySelectorAll('.inspector-link-item')).find((b) =>
      b.textContent?.includes('Fest')
    ) as HTMLButtonElement;
    act(() => {
      festItem.click();
    });
    expect(onUpdateNodeData).toHaveBeenCalledWith('node-img-1', { linkUrl: 'Fest.md' });
  });

  it('8. mounts non-circular embedded canvas inside CanvasFileNode while blocking circular ones', async () => {
    vi.spyOn(api, 'getNote').mockImplementation(async (targetPath: string) => {
      if (targetPath === 'Fest.md') {
        return makeNote('Fest.md', '# Fest\n\n![[Testcanvas.canvas]]\n\n![[Testcanvas2.canvas]]');
      }
      return makeNote(targetPath, JSON.stringify({ nodes: [], edges: [] }));
    });

    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              allNotes: [
                { path: 'Testcanvas.canvas', name: 'Testcanvas.canvas', basename: 'Testcanvas' },
                { path: 'Testcanvas2.canvas', name: 'Testcanvas2.canvas', basename: 'Testcanvas2' },
              ],
              currentCanvasPath: 'Testcanvas2.canvas',
              ancestorPaths: ['Testcanvas2.canvas'],
            }}
          >
            <CanvasFileNode
              {...makeNodeProps('node-fest-mixed', 'canvasFile', { rawType: 'file', file: 'Fest.md' })}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const cycleBtn = container.querySelector('.canvas-file-safe-embed-btn.is-cycle');
    expect(cycleBtn).not.toBeNull();
    expect(cycleBtn?.textContent).toContain('Testcanvas2.canvas');

    const liveEmbed = container.querySelector('.canvas-file-live-canvas-embed');
    expect(liveEmbed).not.toBeNull();
    expect(liveEmbed?.getAttribute('data-canvas-path')).toBe('Testcanvas.canvas');
    expect(liveEmbed?.querySelector('.reading-canvas-mount')).not.toBeNull();
  });

  it('9. verifies responsive toolbar label hiding and enlarged handle hit targets in styles.css', () => {
    act(() => {
      root.render(
        <CanvasToolbar
          onAddTextNode={vi.fn()}
          onAddFileNode={vi.fn()}
          onAddGroupNode={vi.fn()}
          onFitView={vi.fn()}
          gridMode="dots"
          canUndo={false}
          canRedo={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          allNotes={[]}
          onTogglePresentationPanel={vi.fn()}
          presentationSlideCount={2}
        />
      );
    });

    const labels = container.querySelectorAll('.canvas-toolbar-label');
    expect(labels.length).toBeGreaterThanOrEqual(6);

    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.canvas-toolbar-label');
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.canvas-toolbar-label\s*\{\s*display:\s*none\s*!important/);
    expect(css).toContain('width: 14px !important');
    expect(css).toContain('width: 22px !important');
    expect(css).toContain('touch-action: none !important');
    expect(css).toContain('.react-flow__handle::after');
  });
});
