import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  type Connection,
  type Edge,
  type Node,
  type Viewport,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

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
  const { fitView, screenToFlowPosition, getViewport, setViewport } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [gridMode, setGridMode] = useState<'dots' | 'lines' | 'off'>('dots');

  // History stack for Undo / Redo
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoActionRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Save debounce timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);

  // Initial document parsing
  useEffect(() => {
    const doc = parseCanvasJson(rawContent);
    const rf = jsonCanvasToReactFlow(doc);
    setNodes(rf.nodes);
    setEdges(rf.edges);

    historyRef.current = [{ nodes: rf.nodes, edges: rf.edges }];
    historyIndexRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);

    if (rf.viewport && rf.viewport.zoom > 0) {
      setTimeout(() => {
        setViewport(rf.viewport!);
      }, 50);
    } else {
      setTimeout(() => {
        fitView({ padding: 0.2 });
      }, 50);
    }

    isInitialLoadRef.current = true;
    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 300);
  }, [filePath]);

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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        const vp = getViewport();
        const jsonStr = reactFlowToJsonCanvas(currentNodes, currentEdges, vp);
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

  // Center coordinate generator for new nodes
  const getCenterSpawnPosition = useCallback(() => {
    if (typeof window !== 'undefined') {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      return screenToFlowPosition({ x: centerX, y: centerY });
    }
    return { x: 100, y: 100 };
  }, [screenToFlowPosition]);

  // Add new nodes
  const handleAddTextNode = useCallback(
    (shape: CanvasShape = 'rectangle') => {
      if (readOnly) return;
      const pos = getCenterSpawnPosition();
      const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const width = shape === 'circle' ? 140 : shape === 'diamond' ? 180 : 260;
      const height = shape === 'circle' ? 140 : shape === 'diamond' ? 140 : 160;

      const newNode: Node = {
        id,
        type: 'canvasShape',
        position: { x: pos.x - width / 2, y: pos.y - height / 2 },
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, zIndex: 1 },
        data: {
          rawType: 'text',
          text: '',
          shape,
          color: undefined,
        },
      };

      setNodes((current) => {
        const next = [...current, newNode];
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [readOnly, getCenterSpawnPosition, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleAddFileNode = useCallback(
    (targetFilePath: string) => {
      if (readOnly) return;
      const pos = getCenterSpawnPosition();
      const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const width = 340;
      const height = 280;

      const newNode: Node = {
        id,
        type: 'canvasFile',
        position: { x: pos.x - width / 2, y: pos.y - height / 2 },
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, zIndex: 1 },
        data: {
          rawType: 'file',
          file: targetFilePath,
          color: undefined,
        },
      };

      setNodes((current) => {
        const next = [...current, newNode];
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [readOnly, getCenterSpawnPosition, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleAddGroupNode = useCallback(() => {
    if (readOnly) return;
    const pos = getCenterSpawnPosition();
    const id = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const width = 420;
    const height = 320;

    const newNode: Node = {
      id,
      type: 'canvasGroup',
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      width,
      height,
      style: { width: `${width}px`, height: `${height}px`, zIndex: -1 },
      data: {
        rawType: 'group',
        label: 'Neue Gruppe',
        color: undefined,
      },
    };

    setNodes((current) => {
      const next = [...current, newNode];
      pushHistory(next, edges);
      triggerAutoSave(next, edges);
      return next;
    });
  }, [readOnly, getCenterSpawnPosition, setNodes, pushHistory, triggerAutoSave, edges]);

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
    <CanvasContext.Provider value={{ onOpenNote, onSelectTag, allNotes, readOnly }}>
      <div className="knowmesh-canvas-workspace">
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

        {/* Floating Context Inspector for selected Node or Edge */}
        {!readOnly && (
          <CanvasInspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onUpdateNodeData={handleUpdateNodeData}
            onUpdateEdgeData={handleUpdateEdgeData}
            onDuplicateNode={handleDuplicateNode}
            onDeleteNode={handleDeleteNode}
            onDeleteEdge={handleDeleteEdge}
            allNotes={allNotes}
          />
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
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
              color="var(--border-subtle, rgba(255, 255, 255, 0.1))"
            />
          )}
          <Controls showInteractive={false} className="canvas-rf-controls" />
          <MiniMap
            nodeColor={(n) => {
              if (n.data?.color) return resolveCanvasColor(n.data.color as string) || '#888';
              return '#444';
            }}
            maskColor="rgba(0, 0, 0, 0.55)"
            className="canvas-rf-minimap"
          />
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
};

export const CanvasEditor: React.FC<CanvasEditorProps> = (props) => (
  <ReactFlowProvider>
    <CanvasEditorInner {...props} />
  </ReactFlowProvider>
);
