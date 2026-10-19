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
  reconnectEdge,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  SelectionMode,
  type Connection,
  type Edge,
  type Node,
  type Viewport,
  MarkerType,
  type OnNodeDrag,
  type OnConnectStart,
  type OnConnectEnd,
  type OnReconnect,
} from '@xyflow/react';

import type { CanvasShape, CanvasEdgeStyle } from '../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../shared/canvasTypes';
import { CanvasContext } from './CanvasContext';
import {
  parseCanvasJson,
  jsonCanvasToReactFlow,
  reactFlowToJsonCanvas,
  getChildNodesInGroup,
} from './canvasMapper';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasGroupNode } from './nodes/CanvasGroupNode';
import { CanvasLinkNode } from './nodes/CanvasLinkNode';
import { CanvasToolbar, type CanvasGridConfig } from './CanvasToolbar';
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
  const { fitView, getViewport, setViewport, screenToFlowPosition } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Configurable Grid and Snap settings
  const [gridConfig, setGridConfig] = useState<CanvasGridConfig>(() => {
    try {
      const stored = localStorage.getItem('knowmesh_canvas_grid');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          snapToGrid: parsed.snapToGrid ?? true,
          gridSize: [10, 15, 20, 25].includes(parsed.gridSize) ? parsed.gridSize : 15,
          showGrid: parsed.showGrid ?? true,
          gridVariant: ['dots', 'lines', 'off'].includes(parsed.gridVariant) ? parsed.gridVariant : 'dots',
        };
      }
    } catch {}
    return {
      snapToGrid: true,
      gridSize: 15,
      showGrid: true,
      gridVariant: 'dots',
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem('knowmesh_canvas_grid', JSON.stringify(gridConfig));
    } catch {}
  }, [gridConfig]);

  // Multi-selection tool mode toggle (Marquee Box Selection)
  const [isSelectionToolActive, setIsSelectionToolActive] = useState<boolean>(false);

  // Floating context menu position for right-click inspector
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Type-to-edit state for single selected node
  const [editingNodeState, setEditingNodeState] = useState<{ nodeId: string; initialChar: string } | null>(null);

  // Group dragging tracking refs (moving a group moves enclosed elements)
  const draggingChildNodeIdsRef = useRef<Set<string>>(new Set());
  const dragStartGroupPosRef = useRef<{ x: number; y: number } | null>(null);

  // Connection dragging refs for drop-to-create node
  const connectingRef = useRef<{
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
  } | null>(null);
  const didConnectRef = useRef<boolean>(false);

  // Edge reconnection tracking ref
  const edgeReconnectSuccessful = useRef<boolean>(true);

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

  // Group dragging: moving a group node moves all enclosed child nodes
  const onNodeDragStart: OnNodeDrag = useCallback(
    (_event, node) => {
      const isGroup =
        node.type === 'canvasGroup' ||
        node.type === 'group' ||
        node.data?.rawType === 'group';
      if (isGroup) {
        const childIds = getChildNodesInGroup(node, latestNodesRef.current);
        draggingChildNodeIdsRef.current = new Set(childIds);
        dragStartGroupPosRef.current = { x: node.position.x, y: node.position.y };
      } else {
        draggingChildNodeIdsRef.current.clear();
        dragStartGroupPosRef.current = null;
      }
    },
    []
  );

  const onNodeDrag: OnNodeDrag = useCallback(
    (_event, node) => {
      if (
        dragStartGroupPosRef.current &&
        draggingChildNodeIdsRef.current.size > 0
      ) {
        const dx = node.position.x - dragStartGroupPosRef.current.x;
        const dy = node.position.y - dragStartGroupPosRef.current.y;
        if (dx !== 0 || dy !== 0) {
          setNodes((nds) =>
            nds.map((n) => {
              if (draggingChildNodeIdsRef.current.has(n.id)) {
                return {
                  ...n,
                  position: {
                    x: n.position.x + dx,
                    y: n.position.y + dy,
                  },
                };
              }
              return n;
            })
          );
          dragStartGroupPosRef.current = { x: node.position.x, y: node.position.y };
        }
      }
    },
    [setNodes]
  );

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, _node) => {
      draggingChildNodeIdsRef.current.clear();
      dragStartGroupPosRef.current = null;
      setNodes((nds) => {
        pushHistory(nds, edges);
        triggerAutoSave(nds, edges);
        return nds;
      });
    },
    [setNodes, pushHistory, triggerAutoSave, edges]
  );

  // Connection line handlers:
  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    if (params.nodeId && params.handleType) {
      connectingRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId || null,
        handleType: params.handleType,
      };
      didConnectRef.current = false;
    }
  }, []);

  // Connections handler: strictly places the arrow marker on the target side
  const onConnect = useCallback(
    (params: Connection) => {
      if (readOnly) return;
      didConnectRef.current = true;

      let sourceId = params.source;
      let targetId = params.target;
      let sourceHandle = params.sourceHandle;
      let targetHandle = params.targetHandle;

      // React Flow can sometimes flip source and target if connection was initiated from a handle classified as target
      if (connectingRef.current?.nodeId === targetId && connectingRef.current.nodeId !== sourceId) {
        sourceId = params.target;
        targetId = params.source;
        sourceHandle = params.targetHandle;
        targetHandle = params.sourceHandle;
      }

      const newEdgeId = `edge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const strokeColor = 'var(--border-strong, #888)';

      const newEdge: Edge = {
        ...params,
        id: newEdgeId,
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: 'default',
        style: { stroke: strokeColor, strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
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

      setEdges((eds) => {
        const next = addEdge(newEdge, eds);
        pushHistory(latestNodesRef.current, next);
        triggerAutoSave(latestNodesRef.current, next);
        return next;
      });
    },
    [setEdges, pushHistory, triggerAutoSave, readOnly]
  );

  // Auto-create rectangle node when dropping a connection line onto empty canvas space
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (readOnly) {
        connectingRef.current = null;
        return;
      }
      if (didConnectRef.current || connectionState?.isValid) {
        connectingRef.current = null;
        return;
      }
      if (!connectingRef.current) return;

      const targetEl = event.target as HTMLElement | null;
      const isNodeOrHandle = Boolean(targetEl?.closest('.react-flow__node, .react-flow__handle'));
      const isPane = targetEl?.classList?.contains('react-flow__pane') || Boolean(targetEl?.closest('.react-flow__pane'));

      if (isPane || !isNodeOrHandle) {
        const clientX =
          'changedTouches' in event && event.changedTouches?.[0]
            ? event.changedTouches[0].clientX
            : 'clientX' in event
            ? event.clientX
            : undefined;
        const clientY =
          'changedTouches' in event && event.changedTouches?.[0]
            ? event.changedTouches[0].clientY
            : 'clientY' in event
            ? event.clientY
            : undefined;

        if (clientX !== undefined && clientY !== undefined) {
          const dropPos = screenToFlowPosition({ x: clientX, y: clientY });
          const nodeWidth = 140;
          const nodeHeight = 80;
          const newNodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const strokeColor = 'var(--border-strong, #888)';

          const newNode: Node = {
            id: newNodeId,
            type: 'canvasShape',
            position: {
              x: Math.round(dropPos.x - nodeWidth / 2),
              y: Math.round(dropPos.y - nodeHeight / 2),
            },
            width: nodeWidth,
            height: nodeHeight,
            style: { width: `${nodeWidth}px`, height: `${nodeHeight}px`, zIndex: 1 },
            selected: true,
            data: {
              rawType: 'text',
              text: '',
              shape: 'rectangle',
              color: undefined,
            },
          };

          const originNodeId = connectingRef.current.nodeId;
          const originHandleId = connectingRef.current.handleId;

          // Retrieve origin node center to determine the closest facing handle on the new node
          const originNode =
            latestNodesRef.current.find((n) => n.id === originNodeId) ||
            nodes.find((n) => n.id === originNodeId);
          const originNodeW = originNode?.measured?.width ?? originNode?.width ?? 140;
          const originNodeH = originNode?.measured?.height ?? originNode?.height ?? 80;
          const originX = originNode ? originNode.position.x + originNodeW / 2 : dropPos.x;
          const originY = originNode ? originNode.position.y + originNodeH / 2 : dropPos.y;

          const dx = originX - dropPos.x;
          const dy = originY - dropPos.y;

          let bestHandle: 'top' | 'right' | 'bottom' | 'left' = 'left';
          if (Math.abs(dx) >= Math.abs(dy)) {
            bestHandle = dx > 0 ? 'right' : 'left';
          } else {
            bestHandle = dy > 0 ? 'bottom' : 'top';
          }

          const oppositeHandle =
            bestHandle === 'left' ? 'right' :
            bestHandle === 'right' ? 'left' :
            bestHandle === 'top' ? 'bottom' : 'top';

          // Strictly connect origin node as source and newly created node as target:
          const newEdgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newEdge: Edge = {
            id: newEdgeId,
            source: originNodeId,
            target: newNodeId,
            sourceHandle: originHandleId || oppositeHandle,
            targetHandle: bestHandle,
            type: 'default',
            style: { stroke: strokeColor, strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
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

          setNodes((nds) => {
            const unselected = nds.map((n) => ({ ...n, selected: false }));
            const nextNodes = [...unselected, newNode];
            setEdges((eds) => {
              const nextEdges = [...eds, newEdge];
              pushHistory(nextNodes, nextEdges);
              triggerAutoSave(nextNodes, nextEdges);
              return nextEdges;
            });
            return nextNodes;
          });
        }
      }

      connectingRef.current = null;
    },
    [readOnly, screenToFlowPosition, setNodes, setEdges, pushHistory, triggerAutoSave]
  );

  // Edge Reconnection Handlers
  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (readOnly) return;
      edgeReconnectSuccessful.current = true;
      const strokeColor =
        (oldEdge.markerEnd as any)?.color ||
        (oldEdge.style?.stroke as string) ||
        'var(--border-strong, #888)';

      setEdges((eds) => {
        const reconnected = reconnectEdge(oldEdge, newConnection, eds);
        const next = reconnected.map((e) => {
          if (e.source === newConnection.source && e.target === newConnection.target) {
            return {
              ...e,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: strokeColor,
                width: 16,
                height: 16,
              },
              markerStart: undefined,
              data: {
                ...(e.data || {}),
                toEnd: 'arrow',
                fromEnd: 'none',
              },
            };
          }
          return e;
        });
        pushHistory(latestNodesRef.current, next);
        triggerAutoSave(latestNodesRef.current, next);
        return next;
      });
    },
    [readOnly, setEdges, pushHistory, triggerAutoSave]
  );

  const onReconnectEnd = useCallback((_event: MouseEvent | TouchEvent, _edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      // User dropped reconnection handle onto empty canvas: maintain old edge stability
    }
    edgeReconnectSuccessful.current = true;
  }, []);

  // Right-click context menu event handlers for Node and Edge
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      // 1. Select the right-clicked node exclusively:
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
      setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));

      // 2. Set cursor position for the context inspector:
      setContextMenuPos({ x: event.clientX, y: event.clientY });
    },
    [setNodes, setEdges]
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      // 1. Select the right-clicked edge exclusively:
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edge.id })));
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));

      // 2. Set cursor position for the context inspector:
      setContextMenuPos({ x: event.clientX, y: event.clientY });
    },
    [setNodes, setEdges]
  );

  const handlePaneClick = useCallback(() => {
    setContextMenuPos(null);
  }, []);

  const handleNodeClick = useCallback(() => {
    setContextMenuPos(null);
  }, []);

  const handleEdgeClick = useCallback(() => {
    setContextMenuPos(null);
  }, []);

  const handleMoveStart = useCallback(() => {
    setContextMenuPos(null);
  }, []);

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

  // Selected item tracking for Floating Inspector & Multi-Selection
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const selectedNode = selectedNodes[0] || null;
  const selectedEdge = selectedEdges[0] || null;

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
              width: 16,
              height: 16,
            };
          } else {
            updated.markerEnd = undefined;
          }

          if (mergedData.fromEnd === 'arrow') {
            updated.markerStart = {
              type: MarkerType.ArrowClosed,
              color: strokeColor,
              width: 16,
              height: 16,
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
      const isMulti = selectedNodes.some((n) => n.id === nodeId) && selectedNodes.length > 1;
      const targets = isMulti ? selectedNodes : nodes.filter((n) => n.id === nodeId);
      if (targets.length === 0) return;

      const clonedNodes: Node[] = targets.map((t) => ({
        ...t,
        id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        position: { x: t.position.x + 40, y: t.position.y + 40 },
        selected: true,
      }));

      setNodes((current) => {
        const targetIds = new Set(targets.map((t) => t.id));
        const unselected = current.map((n) => (targetIds.has(n.id) ? { ...n, selected: false } : n));
        const next = unselected.concat(clonedNodes);
        pushHistory(next, edges);
        triggerAutoSave(next, edges);
        return next;
      });
    },
    [selectedNodes, nodes, setNodes, pushHistory, triggerAutoSave, edges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const isMulti = selectedNodes.some((n) => n.id === nodeId) && selectedNodes.length > 1;
      const idsToDelete = isMulti ? new Set(selectedNodes.map((n) => n.id)) : new Set([nodeId]);

      setNodes((nds) => {
        const nextNodes = nds.filter((n) => !idsToDelete.has(n.id));
        setEdges((eds) => {
          const nextEdges = eds.filter(
            (e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
          );
          pushHistory(nextNodes, nextEdges);
          triggerAutoSave(nextNodes, nextEdges);
          return nextEdges;
        });
        return nextNodes;
      });
    },
    [selectedNodes, setNodes, setEdges, pushHistory, triggerAutoSave]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      const isMulti = selectedEdges.some((e) => e.id === edgeId) && selectedEdges.length > 1;
      const idsToDelete = isMulti ? new Set(selectedEdges.map((e) => e.id)) : new Set([edgeId]);

      setEdges((eds) => {
        const next = eds.filter((e) => !idsToDelete.has(e.id));
        pushHistory(nodes, next);
        triggerAutoSave(nodes, next);
        return next;
      });
    },
    [selectedEdges, setEdges, pushHistory, triggerAutoSave, nodes]
  );

  // Keyboard shortcut listener (Ctrl+Z, Ctrl+Y, Delete, Type-to-Edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard 1: Ignore if already inside an active input or textarea or contenteditable element
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') {
        return;
      }

      // Ignore when a modal or palette dialog is open
      if (document.querySelector('.modal-overlay, .modal-backdrop, .command-palette-modal, .version-history-modal-backdrop')) {
        return;
      }

      if (e.key === 'Escape') {
        setContextMenuPos(null);
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodes.length > 0) {
          e.preventDefault();
          handleDeleteNode(selectedNodes[0].id);
        } else if (selectedEdges.length > 0) {
          e.preventDefault();
          handleDeleteEdge(selectedEdges[0].id);
        }
        return;
      }

      // Guard 2: Ignore modifier shortcuts (Ctrl, Meta, Alt)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Guard 3: Only trigger on single printable characters (Space is reserved for canvas panning)
      if (e.key.length !== 1 || e.key === ' ') return;

      // Guard 4: Type-to-Edit: Only trigger if not readOnly and exactly one editable node is selected
      if (readOnly) return;
      if (selectedNodes.length !== 1) return;

      const targetNode = selectedNodes[0];
      const isEditable =
        targetNode.type === 'canvasShape' ||
        targetNode.type === 'shape' ||
        targetNode.type === 'text' ||
        targetNode.data?.rawType === 'text';

      if (!isEditable) return;

      // Prevent default so browser does not duplicate the keystroke in native events
      e.preventDefault();
      setEditingNodeState({
        nodeId: targetNode.id,
        initialChar: e.key,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selectedNodes,
    selectedEdges,
    handleDeleteNode,
    handleDeleteEdge,
    readOnly,
  ]);

  return (
    <CanvasContext.Provider
      value={{
        onOpenNote,
        onSelectTag,
        onUpdateNodeData: handleUpdateNodeData,
        allNotes,
        readOnly,
        editingNodeState,
        setEditingNodeState,
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
            gridConfig={gridConfig}
            onChangeGridConfig={setGridConfig}
            isSelectionToolActive={isSelectionToolActive}
            onToggleSelectionTool={() => setIsSelectionToolActive((prev) => !prev)}
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
            contextMenuPos={contextMenuPos}
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
            edgesReconnectable={!readOnly}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onReconnectEnd={onReconnectEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeContextMenu={handleNodeContextMenu}
            onEdgeContextMenu={handleEdgeContextMenu}
            onPaneClick={handlePaneClick}
            onPaneContextMenu={handlePaneClick}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onMoveStart={handleMoveStart}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            selectionMode={SelectionMode.Partial}
            selectionKeyCode="Shift"
            multiSelectionKeyCode="Shift"
            selectionOnDrag={isSelectionToolActive}
            panOnDrag={isSelectionToolActive ? [2] : [1, 2]}
            zoomOnPinch={true}
            snapToGrid={gridConfig.snapToGrid}
            snapGrid={[gridConfig.gridSize, gridConfig.gridSize]}
            proOptions={{ hideAttribution: true }}
            minZoom={0.15}
            maxZoom={2.5}
          >
            {gridConfig.showGrid && gridConfig.gridVariant !== 'off' && (
              <Background
                variant={
                  gridConfig.gridVariant === 'lines'
                    ? BackgroundVariant.Lines
                    : BackgroundVariant.Dots
                }
                gap={gridConfig.gridSize * (gridConfig.gridSize <= 15 ? 2 : 1)}
                size={gridConfig.gridVariant === 'lines' ? 1 : 1.5}
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
