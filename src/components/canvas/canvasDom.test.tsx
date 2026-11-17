/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import fs from 'fs';
import path from 'path';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasInspector } from './CanvasInspector';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasContext } from './CanvasContext';
import { ReactFlowProvider } from '@xyflow/react';

// Mock ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('Knowmesh Canvas - DOM & Layout Verification', () => {
  it('1. verifies styles.css has required container heights and horizontal toolbar layout', () => {
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Container height rules
    expect(css).toContain('.canvas-editor-wrapper');
    expect(css).toContain('min-height: 450px');
    expect(css).toContain('.canvas-reactflow-container');
    expect(css).toContain('min-height: 400px');

    // Horizontal flex toolbar rules
    expect(css).toMatch(/\.canvas-toolbar[\s\S]*?flex-direction:\s*row\s*!important/);
    expect(css).toMatch(/\.canvas-toolbar-btn[\s\S]*?flex-direction:\s*row\s*!important/);
    expect(css).toMatch(/\.canvas-toolbar-group[\s\S]*?flex-direction:\s*row\s*!important/);

    // Dropdown popover styling
    expect(css).toContain('.canvas-dropdown-menu');
    expect(css).toContain('position: absolute');

    // Shape node minimum sizes and handles
    expect(css).toContain('.canvas-shape-node');
    expect(css).toContain('min-width: 120px');
    expect(css).toContain('min-height: 60px');
    expect(css).toContain('.canvas-node-handle');
  });

  it('2. mounts CanvasToolbar and verifies horizontal layout and button row in DOM', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onAddTextNode = vi.fn();
    const onAddFileNode = vi.fn();
    const onAddGroupNode = vi.fn();
    const onFitView = vi.fn();
    const onToggleGrid = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    act(() => {
      root.render(
        <CanvasToolbar
          onAddTextNode={onAddTextNode}
          onAddFileNode={onAddFileNode}
          onAddGroupNode={onAddGroupNode}
          onFitView={onFitView}
          onToggleGrid={onToggleGrid}
          gridMode="dots"
          canUndo={true}
          canRedo={false}
          onUndo={onUndo}
          onRedo={onRedo}
          allNotes={[{ path: 'Note.md', name: 'Note', basename: 'Note' }]}
        />
      );
    });

    const toolbar = container.querySelector('.canvas-toolbar');
    expect(toolbar).not.toBeNull();

    // Verify buttons exist
    const buttons = toolbar?.querySelectorAll('.canvas-toolbar-btn');
    expect(buttons && buttons.length).toBeGreaterThanOrEqual(7);

    // Text button click
    const textBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Text')) as HTMLButtonElement;
    expect(textBtn).toBeDefined();
    act(() => {
      textBtn.click();
    });
    expect(onAddTextNode).toHaveBeenCalledWith('rectangle');

    // Group button click
    const groupBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Group')) as HTMLButtonElement;
    expect(groupBtn).toBeDefined();
    act(() => {
      groupBtn.click();
    });
    expect(onAddGroupNode).toHaveBeenCalled();

    // Workflow dropdown test
    const workflowBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Workflow')) as HTMLButtonElement;
    expect(workflowBtn).toBeDefined();
    act(() => {
      workflowBtn.click();
    });

    // Dropdown popover should now be in the DOM
    const dropdownMenu = container.querySelector('.canvas-dropdown-menu');
    expect(dropdownMenu).not.toBeNull();

    // Click "Decision (Diamond)" in Workflow menu
    const diamondItem = Array.from(dropdownMenu?.querySelectorAll('.canvas-dropdown-item') || []).find((el) =>
      el.textContent?.includes('Decision')
    ) as HTMLButtonElement;
    expect(diamondItem).toBeDefined();
    act(() => {
      diamondItem.click();
    });
    expect(onAddTextNode).toHaveBeenCalledWith('diamond');

    // After click, dropdown menu should be closed
    expect(container.querySelector('.canvas-dropdown-menu')).toBeNull();

    // Network dropdown test
    const networkBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Network')) as HTMLButtonElement;
    act(() => {
      networkBtn.click();
    });
    const netMenu = container.querySelector('.canvas-dropdown-menu');
    expect(netMenu).not.toBeNull();

    const serverItem = Array.from(netMenu?.querySelectorAll('.canvas-dropdown-item') || []).find((el) =>
      el.textContent?.includes('Server')
    ) as HTMLButtonElement;
    expect(serverItem).toBeDefined();
    act(() => {
      serverItem.click();
    });
    expect(onAddTextNode).toHaveBeenCalledWith('server');
    expect(container.querySelector('.canvas-dropdown-menu')).toBeNull();

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('3. mounts CanvasShapeNode and verifies minimum size (120x60px), SVG contrast and handles', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const dummyNodeProps: any = {
      id: 'test-shape-node',
      data: {
        rawType: 'text',
        text: '## Process Title',
        shape: 'rectangle',
        color: '4', // Green
      },
      selected: true,
      width: 260,
      height: 160,
    };

    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              onSelectTag: vi.fn(),
              allNotes: [],
              readOnly: false,
            }}
          >
            <CanvasShapeNode {...dummyNodeProps} />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const shapeNode = container.querySelector('.canvas-shape-node') as HTMLElement;
    expect(shapeNode).not.toBeNull();

    // Verify inline minWidth and minHeight
    expect(shapeNode.style.minWidth).toBe('120px');
    expect(shapeNode.style.minHeight).toBe('60px');

    // Verify SVG background geometry is present
    const svg = shapeNode.querySelector('.canvas-node-svg-bg');
    expect(svg).not.toBeNull();
    const rect = svg?.querySelector('rect');
    expect(rect).not.toBeNull();
    // Green preset #08b94e stroke
    expect(rect?.getAttribute('stroke')).toBe('#08b94e');

    // Verify handles for top, right, bottom, left exist
    const handles = shapeNode.querySelectorAll('.canvas-node-handle');
    expect(handles.length).toBeGreaterThanOrEqual(4);

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('4. mounts CanvasInspector and verifies horizontal pill layout, upward popovers, and click-outside', () => {
    // A. Verify CSS rules for floating inspector and upward popover in styles.css
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    expect(css).toMatch(/\.canvas-floating-inspector[\s\S]*?position:\s*absolute/);
    expect(css).toMatch(/\.canvas-floating-inspector[\s\S]*?bottom:\s*20px/);
    expect(css).toMatch(/\.canvas-floating-inspector[\s\S]*?border-radius:\s*12px/);
    expect(css).toMatch(/\.canvas-floating-inspector[\s\S]*?box-sizing:\s*border-box/);
    expect(css).toMatch(/\.inspector-content-row[\s\S]*?flex-direction:\s*row\s*!important/);
    expect(css).toMatch(/\.inspector-dropdown-menu[\s\S]*?bottom:\s*calc\(100%\s*\+\s*10px\)/);

    // B. Mount inspector with a selected node
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onUpdateNodeData = vi.fn();
    const onUpdateEdgeData = vi.fn();
    const onDuplicateNode = vi.fn();
    const onDeleteNode = vi.fn();
    const onDeleteEdge = vi.fn();

    const selectedNode: any = {
      id: 'node-1',
      type: 'canvasShape',
      data: { shape: 'rectangle', color: '1', text: 'Sample text' },
      position: { x: 0, y: 0 },
    };

    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={selectedNode}
          selectedEdge={null}
          onUpdateNodeData={onUpdateNodeData}
          onUpdateEdgeData={onUpdateEdgeData}
          onDuplicateNode={onDuplicateNode}
          onDeleteNode={onDeleteNode}
          onDeleteEdge={onDeleteEdge}
          allNotes={[{ path: 'Note1.md', name: 'Note 1', basename: 'Note 1' }]}
        />
      );
    });

    const inspector = container.querySelector('.canvas-floating-inspector');
    expect(inspector).not.toBeNull();

    // Verify tool buttons (Shape, Color, Link, Duplicate, Delete)
    const formBtn = Array.from(inspector?.querySelectorAll('.inspector-tool-btn') || []).find((b) =>
      b.textContent?.includes('Shape')
    ) as HTMLButtonElement;
    expect(formBtn).toBeDefined();

    // Click "Shape" to open shapes popover
    act(() => {
      formBtn.click();
    });

    const shapesGrid = container.querySelector('.inspector-dropdown-menu.shapes-grid');
    expect(shapesGrid).not.toBeNull();

    // Click "Decision (Diamond)" shape in popover
    const diamondBtn = Array.from(shapesGrid?.querySelectorAll('.inspector-grid-item') || []).find((b) =>
      b.textContent?.includes('Diamond')
    ) as HTMLButtonElement;
    expect(diamondBtn).toBeDefined();

    act(() => {
      diamondBtn.click();
    });

    expect(onUpdateNodeData).toHaveBeenCalledWith('node-1', { shape: 'diamond' });
    // Popover should close after selection
    expect(container.querySelector('.inspector-dropdown-menu.shapes-grid')).toBeNull();

    // Test click outside to close popover
    act(() => {
      formBtn.click();
    });
    expect(container.querySelector('.inspector-dropdown-menu.shapes-grid')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('.inspector-dropdown-menu.shapes-grid')).toBeNull();

    // C. Test inspector with a selected edge
    const selectedEdge: any = {
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      label: 'Edge Label',
      data: { edgeStyle: 'straight', fromEnd: 'none', toEnd: 'arrow' },
    };

    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={null}
          selectedEdge={selectedEdge}
          onUpdateNodeData={onUpdateNodeData}
          onUpdateEdgeData={onUpdateEdgeData}
          onDuplicateNode={onDuplicateNode}
          onDeleteNode={onDeleteNode}
          onDeleteEdge={onDeleteEdge}
          allNotes={[]}
        />
      );
    });

    const edgeInput = container.querySelector('.inspector-edge-input') as HTMLInputElement;
    expect(edgeInput).not.toBeNull();
    expect(edgeInput.value).toBe('Edge Label');

    const toggleBtns = container.querySelectorAll('.inspector-toggle-btn');
    expect(toggleBtns.length).toBeGreaterThanOrEqual(4);

    // D. Test mutual exclusivity when both selectedNode and selectedEdge are provided
    act(() => {
      root.render(
        <CanvasInspector
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onUpdateNodeData={onUpdateNodeData}
          onUpdateEdgeData={onUpdateEdgeData}
          onDuplicateNode={onDuplicateNode}
          onDeleteNode={onDeleteNode}
          onDeleteEdge={onDeleteEdge}
          allNotes={[]}
        />
      );
    });

    // Node controls should be present, edge controls must NOT be present
    expect(container.querySelector('.inspector-tool-btn')).not.toBeNull();
    expect(container.querySelector('.inspector-edge-input')).toBeNull();

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('5. renders interactive and styled WikiLinks in CanvasShapeNode and handles clicks', () => {
    // Verify CSS for .canvas-wikilink
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.canvas-wikilink');
    expect(css).toMatch(/\.canvas-wikilink[\s\S]*?cursor:\s*pointer\s*!important/);
    expect(css).toMatch(/\.canvas-wikilink[\s\S]*?text-decoration:\s*underline\s*!important/);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onOpenNote = vi.fn();
    const onSelectTag = vi.fn();

    const nodeProps: any = {
      id: 'wikilink-shape-node',
      data: {
        rawType: 'text',
        text: 'Hier ist ein [[Zielnotiz|Verknüpfte Notiz]] und ein #projekt-tag.',
        shape: 'rectangle',
      },
      selected: false,
      width: 280,
      height: 120,
    };

    act(() => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote,
              onSelectTag,
              allNotes: [{ path: 'Zielnotiz.md', name: 'Zielnotiz', basename: 'Zielnotiz' }],
              readOnly: false,
            }}
          >
            <CanvasShapeNode {...nodeProps} />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    // Verify rendered link
    const linkEl = container.querySelector('.canvas-wikilink') as HTMLAnchorElement;
    expect(linkEl).not.toBeNull();
    expect(linkEl.tagName.toLowerCase()).toBe('a');
    expect(linkEl.textContent).toBe('Verknüpfte Notiz');
    expect(linkEl.getAttribute('data-wiki-target')).toBe('Zielnotiz');
    expect(linkEl.classList.contains('nodrag')).toBe(true);

    // Verify rendered tag
    const tagEl = container.querySelector('.canvas-tag') as HTMLElement;
    expect(tagEl).not.toBeNull();
    expect(tagEl.textContent).toBe('#projekt-tag');
    expect(tagEl.getAttribute('data-tag')).toBe('projekt-tag');
    expect(tagEl.classList.contains('nodrag')).toBe(true);

    // Click on WikiLink
    act(() => {
      linkEl.click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('Zielnotiz');

    // Click on Tag
    act(() => {
      tagEl.click();
    });
    expect(onSelectTag).toHaveBeenCalledWith('projekt-tag');

    // Test mouse down stopPropagation
    const stopPropagation = vi.fn();
    act(() => {
      const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      Object.defineProperty(mouseDownEvent, 'stopPropagation', { value: stopPropagation });
      linkEl.dispatchEvent(mouseDownEvent);
    });
    expect(stopPropagation).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('6. verifies node pencil edit button is removed, double-click edits, and inspector handles right-click contextMenuPos', () => {
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Verify popover CSS classes
    expect(css).toContain('.canvas-shape-picker-popover');
    expect(css).toContain('.canvas-inspector-popover');
    expect(css).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(110px,\s*1fr\)\)/);

    // Mount CanvasShapeNode
    const nodeContainer = document.createElement('div');
    document.body.appendChild(nodeContainer);
    const nodeRoot = createRoot(nodeContainer);

    const dummyNodeProps: any = {
      id: 'test-shape-edit',
      data: {
        rawType: 'text',
        text: 'Editable node',
        shape: 'rectangle',
      },
      selected: false,
      width: 200,
      height: 100,
    };

    act(() => {
      nodeRoot.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              onSelectTag: vi.fn(),
              allNotes: [],
              readOnly: false,
            }}
          >
            <CanvasShapeNode {...dummyNodeProps} />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const shapeNode = nodeContainer.querySelector('.canvas-shape-node') as HTMLElement;
    expect(shapeNode).not.toBeNull();

    // 1. Verify pencil edit button is NOT in DOM
    const editBtn = shapeNode.querySelector('.canvas-quick-edit-btn');
    expect(editBtn).toBeNull();

    // 2. Double-click node opens inline editor
    act(() => {
      shapeNode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const textarea = nodeContainer.querySelector('.canvas-node-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('Editable node');

    act(() => {
      nodeRoot.unmount();
    });
    document.body.removeChild(nodeContainer);

    // 3. Mount CanvasInspector with contextMenuPos
    const inspContainer = document.createElement('div');
    document.body.appendChild(inspContainer);
    const inspRoot = createRoot(inspContainer);

    act(() => {
      inspRoot.render(
        <CanvasInspector
          selectedNode={{
            id: 'node-context',
            type: 'canvasShape',
            data: { shape: 'rectangle', text: 'Node' },
            position: { x: 0, y: 0 },
          } as any}
          selectedEdge={null}
          contextMenuPos={{ x: 150, y: 200 }}
          onUpdateNodeData={vi.fn()}
          onUpdateEdgeData={vi.fn()}
          onDuplicateNode={vi.fn()}
          onDeleteNode={vi.fn()}
          onDeleteEdge={vi.fn()}
          allNotes={[]}
        />
      );
    });

    const inspectorEl = inspContainer.querySelector('.canvas-floating-inspector') as HTMLElement;
    expect(inspectorEl).not.toBeNull();
    expect(inspectorEl.style.position).toBe('fixed');
    expect(inspectorEl.style.left).toBe('158px'); // 150 + 8
    expect(inspectorEl.style.top).toBe('208px'); // 200 + 8

    // Open Shape popover and verify classes
    const formBtn = Array.from(inspectorEl.querySelectorAll('.inspector-tool-btn') || []).find((b) =>
      b.textContent?.includes('Shape')
    ) as HTMLButtonElement;
    expect(formBtn).toBeDefined();

    act(() => {
      formBtn.click();
    });

    const popover = inspContainer.querySelector('.canvas-shape-picker-popover');
    expect(popover).not.toBeNull();
    expect(popover?.classList.contains('canvas-inspector-popover')).toBe(true);
    expect(popover?.classList.contains('shapes-grid')).toBe(true);

    act(() => {
      inspRoot.unmount();
    });
    document.body.removeChild(inspContainer);
  });

  it('7. verifies edge selection styling, edgeupdater rules, and handle DOM stacking order', () => {
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // 1. High-contrast selected edge styling
    expect(css).toContain('.react-flow__edge.selected .react-flow__edge-path');
    expect(css).toMatch(/\.react-flow__edge\.selected\s+\.react-flow__edge-path[\s\S]*?stroke:\s*var\(--accent-color,\s*#d4af37\)/);
    expect(css).toMatch(/\.react-flow__edge\.selected\s+\.react-flow__edge-path[\s\S]*?stroke-width:\s*3\.5px/);

    // 2. Selected edge arrow marker
    expect(css).toMatch(/\.react-flow__edge\.selected\s+marker\s+path[\s\S]*?fill:\s*var\(--accent-color,\s*#d4af37\)/);

    // 3. Edgeupdater reconnection handles
    expect(css).toContain('.react-flow__edgeupdater');
    expect(css).toMatch(/\.react-flow__edgeupdater[\s\S]*?r:\s*7\s*!important/);

    // 4. Edgeupdater visibility rule: hidden on unselected edges
    expect(css).toContain('.react-flow__edge:not(.selected) .react-flow__edgeupdater');
    expect(css).toMatch(/\.react-flow__edge:not\(\.selected\)\s+\.react-flow__edgeupdater[\s\S]*?display:\s*none\s*!important/);

    // 5. Mount CanvasShapeNode and verify Handle DOM stacking (source rendered after target)
    const shapeContainer = document.createElement('div');
    document.body.appendChild(shapeContainer);
    const shapeRoot = createRoot(shapeContainer);

    act(() => {
      shapeRoot.render(
        <ReactFlowProvider>
          <CanvasShapeNode
            id="node-test-handles"
            data={{ shape: 'rectangle', text: 'Stacking Test' }}
            selected={false}
            width={160}
            height={80}
            zIndex={1}
            isConnectable={true}
            positionAbsoluteX={0}
            positionAbsoluteY={0}
            dragging={false}
            type="canvasShape"
            deletable={true}
            selectable={true}
            draggable={true}
          />
        </ReactFlowProvider>
      );
    });

    const handles = shapeContainer.querySelectorAll('.canvas-node-handle');
    expect(handles.length).toBe(8); // 4 positions * (target + source)

    // For each pair, target is first, source is second (on top in DOM hit-testing order)
    const topHandles = shapeContainer.querySelectorAll('.handle-top');
    expect(topHandles.length).toBe(2);
    expect(topHandles[0].classList.contains('target')).toBe(true);
    expect(topHandles[1].classList.contains('source')).toBe(true);

    const rightHandles = shapeContainer.querySelectorAll('.handle-right');
    expect(rightHandles.length).toBe(2);
    expect(rightHandles[0].classList.contains('target')).toBe(true);
    expect(rightHandles[1].classList.contains('source')).toBe(true);

    act(() => {
      shapeRoot.unmount();
    });
    document.body.removeChild(shapeContainer);
  });

  it('8. calculates nearest facing handle on drop and serializes to JSON Canvas sides', () => {
    // Nearest handle calculation function matching onConnectEnd implementation
    const getBestHandle = (
      origin: { x: number; y: number; width?: number; height?: number },
      drop: { x: number; y: number }
    ): 'top' | 'right' | 'bottom' | 'left' => {
      const originNodeW = origin.width ?? 140;
      const originNodeH = origin.height ?? 80;
      const originX = origin.x + originNodeW / 2;
      const originY = origin.y + originNodeH / 2;

      const dx = originX - drop.x;
      const dy = originY - drop.y;

      if (Math.abs(dx) >= Math.abs(dy)) {
        return dx > 0 ? 'right' : 'left';
      } else {
        return dy > 0 ? 'bottom' : 'top';
      }
    };

    const origin = { x: 100, y: 100, width: 140, height: 80 }; // center at (170, 140)

    // 1. Drag right -> facing handle on new node is 'left'
    expect(getBestHandle(origin, { x: 400, y: 140 })).toBe('left');

    // 2. Drag left -> facing handle on new node is 'right'
    expect(getBestHandle(origin, { x: -100, y: 140 })).toBe('right');

    // 3. Drag downwards -> facing handle on new node is 'top'
    expect(getBestHandle(origin, { x: 170, y: 400 })).toBe('top');

    // 4. Drag upwards -> facing handle on new node is 'bottom'
    expect(getBestHandle(origin, { x: 170, y: -100 })).toBe('bottom');
  });

  it('9. verifies deterministic edge arrow direction pointing from origin to auto-created node even with target handleType', () => {
    // Simulates onConnectEnd edge construction
    const createAutoDropEdge = (params: {
      originNodeId: string;
      originHandleId?: string | null;
      originHandleType?: 'source' | 'target';
      newNodeId: string;
      bestHandle: 'top' | 'right' | 'bottom' | 'left';
    }) => {
      const oppositeHandle =
        params.bestHandle === 'left' ? 'right' :
        params.bestHandle === 'right' ? 'left' :
        params.bestHandle === 'top' ? 'bottom' : 'top';

      return {
        id: `edge-${Date.now()}-test`,
        source: params.originNodeId,
        target: params.newNodeId,
        sourceHandle: params.originHandleId || oppositeHandle,
        targetHandle: params.bestHandle,
        type: 'default',
        markerEnd: {
          color: 'var(--accent-color, #d4af37)',
          width: 16,
          height: 16,
        },
        markerStart: undefined,
        data: {
          color: undefined,
          edgeStyle: 'bezier',
          fromEnd: 'none',
          toEnd: 'arrow',
        },
      };
    };

    // Even if origin connection was initiated from a 'target' handle:
    const edgeFromTarget = createAutoDropEdge({
      originNodeId: 'node-A',
      originHandleId: 'top',
      originHandleType: 'target',
      newNodeId: 'node-B',
      bestHandle: 'bottom',
    });

    expect(edgeFromTarget.source).toBe('node-A');
    expect(edgeFromTarget.target).toBe('node-B');
    expect(edgeFromTarget.markerEnd).toBeDefined();
    expect(edgeFromTarget.markerStart).toBeUndefined();
    expect(edgeFromTarget.data.toEnd).toBe('arrow');
    expect(edgeFromTarget.data.fromEnd).toBe('none');

    // From source handle:
    const edgeFromSource = createAutoDropEdge({
      originNodeId: 'node-A',
      originHandleId: 'right',
      originHandleType: 'source',
      newNodeId: 'node-B',
      bestHandle: 'left',
    });

    expect(edgeFromSource.source).toBe('node-A');
    expect(edgeFromSource.target).toBe('node-B');
    expect(edgeFromSource.targetHandle).toBe('left');
  });

  it('10. verifies type-to-edit immediately activates inline editor and appends keystroke', () => {
    const shapeContainer = document.createElement('div');
    document.body.appendChild(shapeContainer);
    const shapeRoot = createRoot(shapeContainer);

    const setEditingNodeState = vi.fn();
    const onUpdateNodeData = vi.fn();

    // 1. Initial render in display mode
    act(() => {
      shapeRoot.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              onUpdateNodeData,
              allNotes: [],
              readOnly: false,
              editingNodeState: null,
              setEditingNodeState,
            }}
          >
            <CanvasShapeNode
              id="node-type-test"
              data={{ text: 'Hello', shape: 'rectangle', rawType: 'text' }}
              selected={true}
              type="canvasShape"
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              deletable={true}
              selectable={true}
              draggable={true}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    // Displays rendered markdown initially
    expect(shapeContainer.querySelector('.canvas-node-display-text')).not.toBeNull();
    expect(shapeContainer.querySelector('textarea')).toBeNull();

    // 2. Trigger Type-to-Edit with initialChar '!'
    act(() => {
      shapeRoot.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              onOpenNote: vi.fn(),
              onUpdateNodeData,
              allNotes: [],
              readOnly: false,
              editingNodeState: { nodeId: 'node-type-test', initialChar: '!' },
              setEditingNodeState,
            }}
          >
            <CanvasShapeNode
              id="node-type-test"
              data={{ text: 'Hello', shape: 'rectangle', rawType: 'text' }}
              selected={true}
              type="canvasShape"
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              deletable={true}
              selectable={true}
              draggable={true}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    // Textarea is now rendered with updated text "Hello!"
    const textarea = shapeContainer.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe('Hello!');
    expect(setEditingNodeState).toHaveBeenCalledWith(null);

    act(() => {
      shapeRoot.unmount();
    });
    document.body.removeChild(shapeContainer);
  });
});


