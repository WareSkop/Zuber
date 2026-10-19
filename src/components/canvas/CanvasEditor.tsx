import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import '@xyflow/react/dist/style.css';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
  MarkerType,
} from '@xyflow/react';

import type { CanvasShape, CanvasEdgeStyle } from '../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../shared/canvasTypes';
import { CanvasContext } from './CanvasContext';
import { parseCanvasJson, jsonCanvasToReactFlow, reactFlowToJsonCanvas } from './canvasMapper';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasGroupNode } from './nodes/CanvasGroupNode';
import { CanvasLinkNode } from './nodes/CanvasLinkNode';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasInspector } from './CanvasInspector';

export interface CanvasEditorProps {
  filePath: string;
  rawContent: string;
  onChange: (newContent: string) => void;
  onOpenNote: (path: string) => void;
  onSelectTag?: (tag: string) => void;
  allNotes: { path: string; name: string; basename: string }[];
  readOnly?: boolean;
}

const nodeTypes = {
  canvasShape: CanvasShapeNode,
  canvasFile: CanvasFileNode,
  canvasGroup: CanvasGroupNode,
  canvasLink: CanvasLinkNode,
  shape: CanvasShapeNode,
  file: CanvasFileNode,
  group: CanvasGroupNode,
  link: CanvasLinkNode,
  text: CanvasShapeNode,
};

const CanvasEditorInner: React.FC<CanvasEditorProps> = ({
  filePath,
  rawContent,
  onChange,
  onOpenNote,
  onSelectTag,
  allNotes,
  readOnly = false,
}) => {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [gridMode, setGridMode] = useState<'dots' | 'lines' | 'off'>('dots');

  // History stack for Undo / Redo
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoActionRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Save debounce timer and state echo prevention
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const lastEmittedJsonRef = useRef<string>('');
  const lastLoadedPathRef = useRef<string>('');
  const latestNodesRef = useRef<Node[]>([]);
  const latestEdgesRef = useRef<Edge[]>([]);
  const hasPendingSaveRef = useRef<boolean>(false);

  // Immediate save flush for note exit / unmount
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (hasPendingSaveRef.current && !readOnly) {
      hasPendingSaveRef.current = false;
      let vp: Viewport | undefined;
      try {
        vp = getViewport();
      } catch {
        // ignore
      }
      const jsonStr = reactFlowToJsonCanvas(latestNodesRef.current, latestEdgesRef.current, vp);
      if (jsonStr !== lastEmittedJsonRef.current) {
        lastEmittedJsonRef.current = jsonStr;
        onChange(jsonStr);
      }
    }
  }, [getViewport, onChange, readOnly]);

  // Flush pending changes on unmount (e.g. switching notes or closing tab)
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [flushSave]);

  // Initial document parsing and external update synchronization
  useEffect(() => {
    const pathChanged = lastLoadedPathRef.current !== filePath;
    const externalChange = rawContent !== lastEmittedJsonRef.current;

    // Avoid state echo loop when rawContent bounces back from App.tsx after an internal edit
    if (!pathChanged && !externalChange) {
      return;
    }

    // If switching notes, flush any pending edits on the previous canvas first
    if (pathChanged && hasPendingSaveRef.current) {
      flushSave();
    }

    lastLoadedPathRef.current = filePath;
    lastEmittedJsonRef.current = rawContent;

    const doc = parseCanvasJson(rawContent);
    const rf = jsonCanvasToReactFlow(doc);
    setNodes(rf.nodes);
    setEdges(rf.edges);
    latestNodesRef.current = rf.nodes;
    latestEdgesRef.current = rf.edges;

    historyRef.current = [{ nodes: rf.nodes, edges: rf.edges }];
    historyIndexRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);

    if (rf.viewport && rf.viewport.zoom > 0) {
      setTimeout(() => {
        try {
          setViewport(rf.viewport!);
        } catch {}
      }, 50);
    } else {
      setTimeout(() => {
        try {
          fitView({ padding: 0.2 });
        } catch {}
      }, 50);
    }

    isInitialLoadRef.current = true;
    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 300);
  }, [filePath, rawContent, setNodes, setEdges, setViewport, fitView, flushSave]);

  // Push state to undo history
  const pushHistory = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    if (isUndoRedoActionRef.current || isInitialLoadRef.current) return;
    const history = historyRef.current.slice(0, historyIndexRef.current + 1);
    history.push({ nodes: newNodes, edges: newEdges });
    // Limit history to 40 steps
    if (history.length > 40) history.shift();
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  // Debounced auto-save to vault
  const triggerAutoSave = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]) => {
      if (readOnly || isInitialLoadRef.current) return;
      latestNodesRef.current = currentNodes;
      latestEdgesRef.current = currentEdges;
      hasPendingSaveRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        hasPendingSaveRef.current = false;
        saveTimerRef.current = null;
        let vp: Viewport | undefined;
        try {
          vp = getViewport();
        } catch {
          // ignore
        }
        const jsonStr = reactFlowToJsonCanvas(currentNodes, currentEdges, vp);
        lastEmittedJsonRef.current = jsonStr;
        onChange(jsonStr);
      }, 600);
    },
    [onChange, readOnly, getViewport]
  );

  // Notify changes on nodes or edges update
  const handleNodesChange = useCallback(
    (changes: any) => {
      onNodesChange(changes);
      setNodes((currentNodes) => {
        triggerAutoSave(currentNodes, edges);
        return currentNodes;
      });
    },
    [onNodesChange, setNodes, triggerAutoSave, edges]
  );

  const handleEdgesChange = useCallback(
    (changes: any) => {
      onEdgesChange(changes);
      setEdges((currentEdges) => {
        triggerAutoSave(nodes, currentEdges);
        return currentEdges;
      });
    },
    [onEdgesChange, setEdges, triggerAutoSave, nodes]
  );

  // Connections handler
  const onConnect = useCallback(
    (params: Connection) => {
      if (readOnly) return;
      const newEdgeId = `edge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const strokeColor = 'var(--border-strong, #888)';

      const newEdge: Edge = {
        ...params,
        id: newEdgeId,
        type: 'default',
        style: { stroke: strokeColor, strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: 14,
          height: 14,
        },
        data: {
          color: undefined,
          edgeStyle: 'bezier',
          fromEnd: 'none',
          toEnd: 'arrow',
        },
      };

      setEdges((eds) => {
        const next = addEdge(newEdge, eds);
        pushHistory(nodes, next);
        triggerAutoSave(nodes, next);
        return next;
      });
    },
    [setEdges, pushHistory, triggerAutoSave, nodes, readOnly]
  );

  // Undo / Redo actions
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current -= 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
      triggerAutoSave(snapshot.nodes, snapshot.edges);
      setTimeout(() => {
        isUndoRedoActionRef.current = false;
      }, 50);
    }
  }, [setNodes, setEdges, triggerAutoSave]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current += 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setCanUndo(true);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
      triggerAutoSave(snapshot.nodes, snapshot.edges);
      setTimeout(() => {
        isUndoRedoActionRef.current = false;
      }, 50);
    }
  }, [setNodes, setEdges, triggerAutoSave]);

  // Robust center coordinate generator for new nodes
  const getCenterSpawnPosition = useCallback(
    (nodeWidth: number, nodeHeight: number, count: number) => {
      let vp = { x: 0, y: 0, zoom: 1 };
      try {
        vp = getViewport();
      } catch {
        // fallback
      }
      const safeZoom = vp && vp.zoom > 0 ? vp.zoom : 1;
      const rect = containerRef.current?.getBoundingClientRect();
      const containerWidth = rect && rect.width > 0 ? rect.width : 800;
      const containerHeight = rect && rect.height > 0 ? rect.height : 600;

      const centerX = Math.round((-vp.x + containerWidth / 2) / safeZoom - nodeWidth / 2);
      const centerY = Math.round((-vp.y + containerHeight / 2) / safeZoom - nodeHeight / 2);
      const offset = (count % 8) * 24;

      return {
        x: isNaN(centerX) ? 100 + offset : centerX + offset,
        y: isNaN(centerY) ? 100 + offset : centerY + offset,
      };
    },
    [getViewport]
  );

  // Add new nodes
  const handleAddTextNode = useCallback(
    (shape: CanvasShape = 'rectangle') => {
      if (readOnly) return;
      const width = shape === 'circle' ? 140 : shape === 'diamond' ? 180 : 260;
      const height = shape === 'circle' ? 140 : shape === 'diamond' ? 140 : 160;
      const pos = getCenterSpawnPosition(width, height, nodes.length);
      const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newNode: Node = {
        id,
        type: 'canvasShape',
        position: { x: pos.x, y: pos.y },
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, zIndex: 1 },
        selected: true,
        data: {
          rawType: 'text',
          text: '',
          shape,
          color: undefined,
        },
      };

      setNodes((current) => {
        const unselected = current.map((n) => ({ ...n, selected: false }));
        const next = [...unselected, newNode];
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [readOnly, getCenterSpawnPosition, nodes.length, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleAddFileNode = useCallback(
    (targetFilePath: string) => {
      if (readOnly) return;
      const width = 340;
      const height = 280;
      const pos = getCenterSpawnPosition(width, height, nodes.length);
      const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newNode: Node = {
        id,
        type: 'canvasFile',
        position: { x: pos.x, y: pos.y },
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, zIndex: 1 },
        selected: true,
        data: {
          rawType: 'file',
          file: targetFilePath,
          color: undefined,
        },
      };

      setNodes((current) => {
        const unselected = current.map((n) => ({ ...n, selected: false }));
        const next = [...unselected, newNode];
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [readOnly, getCenterSpawnPosition, nodes.length, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleAddGroupNode = useCallback(() => {
    if (readOnly) return;
    const width = 420;
    const height = 320;
    const pos = getCenterSpawnPosition(width, height, nodes.length);
    const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const newNode: Node = {
      id,
      type: 'canvasGroup',
      position: { x: pos.x, y: pos.y },
      width,
      height,
      style: { width: `${width}px`, height: `${height}px`, zIndex: -1 },
      selected: true,
      data: {
        rawType: 'group',
        label: 'Neue Gruppe',
        color: undefined,
      },
    };

    setNodes((current) => {
      const unselected = current.map((n) => ({ ...n, selected: false }));
      const next = [...unselected, newNode];
      pushHistory(next, edges);
      triggerAutoSave(next, edges);
      return next;
    });
  }, [readOnly, getCenterSpawnPosition, nodes.length, setNodes, pushHistory, triggerAutoSave, edges]);

  // Selected item tracking for Floating Inspector
  const selectedNode = useMemo(() => nodes.find((n) => n.selected) || null, [nodes]);
  const selectedEdge = useMemo(() => edges.find((e) => e.selected) || null, [edges]);

  // Inspector action handlers
  const handleUpdateNodeData = useCallback(
    (nodeId: string, partialData: Record<string, any>) => {
      setNodes((nds) => {
        const next = nds.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            data: { ...n.data, ...partialData },
          };
        });
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleUpdateEdgeData = useCallback(
    (edgeId: string, partialData: Record<string, any>, labelText?: string) => {
      setEdges((eds) => {
        const next = eds.map((e) => {
          if (e.id !== edgeId) return e;
          const mergedData = { ...e.data, ...partialData };
          const strokeColor = resolveCanvasColor(mergedData.color) || 'var(--border-strong, #888)';
          const edgeType =
            mergedData.edgeStyle === 'straight'
              ? 'straight'
              : mergedData.edgeStyle === 'step'
                ? 'smoothstep'
                : 'default';

          const updated: Edge = {
            ...e,
            label: typeof labelText === 'string' ? labelText : e.label,
            type: edgeType,
            style: { ...e.style, stroke: strokeColor },
            data: mergedData,
          };

          if (mergedData.toEnd !== 'none') {
            updated.markerEnd = {
              type: MarkerType.ArrowClosed,
              color: strokeColor,
              width: 14,
              height: 14,
            };
          } else {
            updated.markerEnd = undefined;
          }

          if (mergedData.fromEnd === 'arrow') {
            updated.markerStart = {
              type: MarkerType.ArrowClosed,
              color: strokeColor,
              width: 14,
              height: 14,
            };
          } else {
            updated.markerStart = undefined;
          }

          return updated;
        });
        pushHistory(nodes, next);
        triggerAutoSave(nodes, next);
        return next;
      });
    },
    [setEdges, pushHistory, triggerAutoSave, nodes]
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (!target) return;
      const cloneId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const clonedNode: Node = {
        ...target,
        id: cloneId,
        position: { x: target.position.x + 40, y: target.position.y + 40 },
        selected: true,
      };

      setNodes((current) => {
        const next = current.map((n) => (n.id === nodeId ? { ...n, selected: false } : n)).concat(clonedNode);
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [nodes, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const nextNodes = nds.filter((n) => n.id !== nodeId);
        setEdges((eds) => {
          const nextEdges = eds.filter((e) => e.source !== nodeId && e.target !== nodeId);
          pushHistory(nextNodes, nextEdges);
          triggerAutoSave(nextNodes, nextEdges);
          return nextEdges;
        });
        return nextNodes;
      });
    },
    [setNodes, setEdges, pushHistory, triggerAutoSave]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => {
        const next = eds.filter((e) => e.id !== edgeId);
        pushHistory(nodes, next);
        triggerAutoSave(nodes, next);
        return next;
      });
    },
    [setEdges, pushHistory, triggerAutoSave, nodes]
  );

  // Keyboard shortcut listener (Ctrl+Z, Ctrl+Y, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting input fields or textareas
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isInput) {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isInput) {
          if (selectedNode) {
            e.preventDefault();
            handleDeleteNode(selectedNode.id);
          } else if (selectedEdge) {
            e.preventDefault();
            handleDeleteEdge(selectedEdge.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, selectedNode, selectedEdge, handleDeleteNode, handleDeleteEdge]);

  return (
    <CanvasContext.Provider
      value={{
        onOpenNote,
        onSelectTag,
        onUpdateNodeData: handleUpdateNodeData,
        allNotes,
        readOnly,
      }}
    >
      <div className={`canvas-editor-wrapper ${selectedNode || selectedEdge ? 'has-selection' : ''}`} ref={containerRef}>
        {/* Top dock toolbar */}
        {!readOnly && (
          <CanvasToolbar
            onAddTextNode={handleAddTextNode}
            onAddFileNode={handleAddFileNode}
            onAddGroupNode={handleAddGroupNode}
            onFitView={() => fitView({ padding: 0.2 })}
            onToggleGrid={() =>
              setGridMode((m) => (m === 'dots' ? 'lines' : m === 'lines' ? 'off' : 'dots'))
            }
            gridMode={gridMode}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            allNotes={allNotes}
          />
        )}

        {/* Floating Context Inspector for selected Node or Edge (mutually exclusive) */}
        {!readOnly && (
          <CanvasInspector
            selectedNode={selectedNode}
            selectedEdge={selectedNode ? null : selectedEdge}
            onUpdateNodeData={handleUpdateNodeData}
            onUpdateEdgeData={handleUpdateEdgeData}
            onDuplicateNode={handleDuplicateNode}
            onDeleteNode={handleDeleteNode}
            onDeleteEdge={handleDeleteEdge}
            allNotes={allNotes}
          />
        )}

        {/* Full-size ReactFlow Container */}
        <div className="canvas-reactflow-container" style={{ width: '100%', height: '100%' }}>
          <ReactFlow
            style={{ width: '100%', height: '100%' }}
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            panOnDrag={[1, 2]}
            zoomOnPinch={true}
            selectionOnDrag={false}
            proOptions={{ hideAttribution: true }}
            minZoom={0.15}
            maxZoom={2.5}
          >
            {gridMode !== 'off' && (
              <Background
                variant={gridMode === 'dots' ? BackgroundVariant.Dots : BackgroundVariant.Lines}
                gap={gridMode === 'dots' ? 24 : 32}
                size={gridMode === 'dots' ? 1.5 : 1}
                color="var(--border-subtle, rgba(255, 255, 255, 0.15))"
              />
            )}
            <Controls showInteractive={false} className="canvas-rf-controls" />
            <MiniMap
              nodeColor={(n) => {
                if (n.data?.color) return resolveCanvasColor(n.data.color as string) || 'var(--accent-color, #d4af37)';
                return 'var(--text-muted, #888888)';
              }}
              maskColor="var(--border-subtle, rgba(0, 0, 0, 0.45))"
              className="canvas-rf-minimap"
            />
          </ReactFlow>
        </div>
      </div>
    </CanvasContext.Provider>
  );
};

export const CanvasEditor: React.FC<CanvasEditorProps> = (props) => (
  <ReactFlowProvider>
    <CanvasEditorInner {...props} />
  </ReactFlowProvider>
);
