/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let capturedReactFlowProps: any = null;

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<any>('@xyflow/react');
  return {
    ...actual,
    ReactFlowProvider: ({ children }: any) => <>{children}</>,
    useReactFlow: () => ({
      fitView: vi.fn(),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: vi.fn(),
      screenToFlowPosition: ({ x, y }: any) => ({ x, y }),
    }),
    useNodesState: (initial: any) => {
      const [nodes, setNodes] = React.useState(initial);
      const onNodesChange = vi.fn();
      return [nodes, setNodes, onNodesChange];
    },
    useEdgesState: (initial: any) => {
      const [edges, setEdges] = React.useState(initial);
      const onEdgesChange = vi.fn();
      return [edges, setEdges, onEdgesChange];
    },
    ReactFlow: (props: any) => {
      capturedReactFlowProps = props;
      return <div data-testid="mock-reactflow">{props.children}</div>;
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  };
});

import { CanvasEditor } from './CanvasEditor';
import { I18nProvider } from '../../i18n';

describe('CanvasEditor sync stability (no premature flush or noisy select saves)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedReactFlowProps = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const sampleCanvas = JSON.stringify({
    nodes: [{ id: 'n1', type: 'text', text: 'Hello', x: 10, y: 20, width: 200, height: 100 }],
    edges: [],
  });

  it('does not flush pending save when parent re-renders with a new onChange callback', () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();

    act(() => {
      root.render(
        <I18nProvider>
          <CanvasEditor
            filePath="test.canvas"
            rawContent={sampleCanvas}
            onChange={onChange1}
            onOpenNote={vi.fn()}
            onSelectTag={vi.fn()}
            allNotes={[]}
          />
        </I18nProvider>
      );
    });

    // Clear initial load guard (300ms)
    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Trigger node drag stop -> schedules 600ms debounced save
    act(() => {
      capturedReactFlowProps.onNodeDragStop(
        {} as any,
        { id: 'n1', position: { x: 120, y: 240 }, data: {} } as any,
        []
      );
    });

    expect(onChange1).not.toHaveBeenCalled();

    // Parent re-renders with a fresh inline onChange callback at t=200ms
    act(() => {
      vi.advanceTimersByTime(200);
      root.render(
        <I18nProvider>
          <CanvasEditor
            filePath="test.canvas"
            rawContent={sampleCanvas}
            onChange={onChange2}
            onOpenNote={vi.fn()}
            onSelectTag={vi.fn()}
            allNotes={[]}
          />
        </I18nProvider>
      );
    });

    // Must NOT have flushed early during re-render!
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).not.toHaveBeenCalled();

    // After remaining debounce finishes (400ms+), latest callback receives the single save
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).toHaveBeenCalledTimes(1);
  });

  it('ignores select, dimensions, and mid-drag position changes without scheduling saves', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <I18nProvider>
          <CanvasEditor
            filePath="test.canvas"
            rawContent={sampleCanvas}
            onChange={onChange}
            onOpenNote={vi.fn()}
            onSelectTag={vi.fn()}
            allNotes={[]}
          />
        </I18nProvider>
      );
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    act(() => {
      capturedReactFlowProps.onNodesChange([
        { id: 'n1', type: 'select', selected: true },
        { id: 'n1', type: 'dimensions', dimensions: { width: 200, height: 100 } },
        { id: 'n1', type: 'position', position: { x: 50, y: 60 }, dragging: true },
      ]);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('flushes pending save on actual unmount', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <I18nProvider>
          <CanvasEditor
            filePath="test.canvas"
            rawContent={sampleCanvas}
            onChange={onChange}
            onOpenNote={vi.fn()}
            onSelectTag={vi.fn()}
            allNotes={[]}
          />
        </I18nProvider>
      );
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Trigger a remove change (persisted change) and unmount before 600ms debounce expires
    act(() => {
      capturedReactFlowProps.onNodesChange([{ id: 'n1', type: 'remove' }]);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
