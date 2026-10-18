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
    const groupBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Gruppe')) as HTMLButtonElement;
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

    // Click "Entscheidung (Raute)" in Workflow menu
    const diamondItem = Array.from(dropdownMenu?.querySelectorAll('.canvas-dropdown-item') || []).find((el) =>
      el.textContent?.includes('Entscheidung')
    ) as HTMLButtonElement;
    expect(diamondItem).toBeDefined();
    act(() => {
      diamondItem.click();
    });
    expect(onAddTextNode).toHaveBeenCalledWith('diamond');

    // After click, dropdown menu should be closed
    expect(container.querySelector('.canvas-dropdown-menu')).toBeNull();

    // Network dropdown test
    const networkBtn = Array.from(buttons || []).find((b) => b.textContent?.includes('Netzwerk')) as HTMLButtonElement;
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

    // Verify tool buttons (Form, Farbe, Link, Duplicate, Delete)
    const formBtn = Array.from(inspector?.querySelectorAll('.inspector-tool-btn') || []).find((b) =>
      b.textContent?.includes('Form')
    ) as HTMLButtonElement;
    expect(formBtn).toBeDefined();

    // Click "Form" to open shapes popover
    act(() => {
      formBtn.click();
    });

    const shapesGrid = container.querySelector('.inspector-dropdown-menu.shapes-grid');
    expect(shapesGrid).not.toBeNull();

    // Click "Raute" shape in popover
    const diamondBtn = Array.from(shapesGrid?.querySelectorAll('.inspector-grid-item') || []).find((b) =>
      b.textContent?.includes('Raute')
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
});
