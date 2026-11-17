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
  useViewport,
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
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import type {
  CanvasShape,
  CanvasEdgeStyle,
  CanvasPresentation,
  CanvasPresentationConfig,
  CanvasPresentationSlide,
} from '../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../shared/canvasTypes';
import { CanvasContext } from './CanvasContext';
import {
  parseCanvasJson,
  jsonCanvasToReactFlow,
  reactFlowToJsonCanvas,
  getChildNodesInGroup,
  DEFAULT_PRESENTATION_CONFIG,
  prunePresentationNodeIds,
} from './canvasMapper';
import {
  captureViewportBounds,
  boundsToViewport,
  animateViewportTo,
  getVisibleNodeIdsForSlide,
  isEdgeVisibleForNodes,
  computeSlideTransitionVisibility,
} from './canvasPresentationUtils';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasGroupNode } from './nodes/CanvasGroupNode';
import { CanvasLinkNode } from './nodes/CanvasLinkNode';
import { CanvasToolbar, type CanvasGridConfig } from './CanvasToolbar';
import { CanvasInspector } from './CanvasInspector';
import { CanvasPresentationPanel } from './CanvasPresentationPanel';
import { useTranslation } from '../../i18n';
import { clientLogger } from '../../utils/logger';

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

const SlideBoundsOverlay: React.FC<{
  slide: CanvasPresentationSlide;
  slideIndex: number;
}> = ({ slide, slideIndex }) => {
  const { x, y, zoom } = useViewport();
  const left = slide.bounds.x * zoom + x;
  const top = slide.bounds.y * zoom + y;
  const width = slide.bounds.width * zoom;
  const height = slide.bounds.height * zoom;

  return (
    <div
      className="canvas-pres-bounds-frame"
      style={{
        transform: `translate(${left}px, ${top}px)`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      aria-hidden="true"
    >
      <span className="canvas-pres-bounds-label">
        {slideIndex + 1}. {slide.title}
      </span>
    </div>
  );
};

function createEmptyPresentation(): CanvasPresentation {
  return {
    config: { ...DEFAULT_PRESENTATION_CONFIG },
    slides: [],
  };
}

function shouldPersistPresentation(pres: CanvasPresentation): boolean {
  if (pres.slides.length > 0) return true;
  const c = pres.config;
  const d = DEFAULT_PRESENTATION_CONFIG;
  return (
    c.zoomDuration !== d.zoomDuration ||
    c.zoomArc !== d.zoomArc ||
    c.revealDuration !== d.revealDuration ||
    c.revealDelay !== d.revealDelay ||
    c.staggerDelay !== d.staggerDelay
  );
}

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
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Presentation state
  const [presentation, setPresentation] = useState<CanvasPresentation>(createEmptyPresentation);
  const presentationRef = useRef<CanvasPresentation>(presentation);
  const [isPresentationPanelOpen, setIsPresentationPanelOpen] = useState(false);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentingSlideIndex, setPresentingSlideIndex] = useState(0);
  const [revealPhase, setRevealPhase] = useState<'idle' | 'moving' | 'revealing'>('idle');
  const [endIndicatorVisible, setEndIndicatorVisible] = useState(false);
  const [isHudIdle, setIsHudIdle] = useState(false);
  const [visibleNodeIdsInPresentation, setVisibleNodeIdsInPresentation] = useState<Set<string>>(new Set());
  const [revealingDelayMap, setRevealingDelayMap] = useState<Map<string, number>>(new Map());
  const [activeRevealDuration, setActiveRevealDuration] = useState<number>(DEFAULT_PRESENTATION_CONFIG.revealDuration);

  const cancelAnimationRef = useRef<(() => void) | null>(null);
  const revealDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Configurable Grid and Snap settings
  const [gridConfig, setGridConfig] = useState<CanvasGridConfig>(() => {
    try {
      const stored = localStorage.getItem('zuber_canvas_grid') || localStorage.getItem('knowmesh_canvas_grid');
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
      localStorage.setItem('zuber_canvas_grid', JSON.stringify(gridConfig));
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
      const presToSave = shouldPersistPresentation(presentationRef.current)
        ? presentationRef.current
        : undefined;
      const jsonStr = reactFlowToJsonCanvas(
        latestNodesRef.current,
        latestEdgesRef.current,
        vp,
        presToSave
      );
      if (jsonStr !== lastEmittedJsonRef.current) {
        lastEmittedJsonRef.current = jsonStr;
        clientLogger.debug('canvas', `flushSave emitting update for "${filePath}"`, {
          nodes: latestNodesRef.current.length,
          edges: latestEdgesRef.current.length,
          bytes: jsonStr.length,
        });
        onChange(jsonStr);
      }
    }
  }, [filePath, getViewport, onChange, readOnly]);

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
    clientLogger.debug('canvas', `Syncing canvas "${filePath}"`, {
      pathChanged,
      externalChange,
      nodes: rf.nodes.length,
      edges: rf.edges.length,
      bytes: rawContent.length,
    });
    setNodes(rf.nodes);
    setEdges(rf.edges);
    latestNodesRef.current = rf.nodes;
    latestEdgesRef.current = rf.edges;

    const loadedPresentation = rf.presentation ?? createEmptyPresentation();
    presentationRef.current = loadedPresentation;
    setPresentation(loadedPresentation);
    setSelectedSlideId((prev) =>
      prev && loadedPresentation.slides.some((s) => s.id === prev)
        ? prev
        : loadedPresentation.slides[0]?.id ?? null
    );
    if (pathChanged) {
      setIsPresenting(false);
    }

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
    (currentNodes: Node[], currentEdges: Edge[], currentPresentation?: CanvasPresentation) => {
      if (readOnly || isInitialLoadRef.current) return;
      latestNodesRef.current = currentNodes;
      latestEdgesRef.current = currentEdges;
      if (currentPresentation) {
        presentationRef.current = currentPresentation;
      }
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
        const pres = presentationRef.current;
        const presToSave = shouldPersistPresentation(pres) ? pres : undefined;
        const jsonStr = reactFlowToJsonCanvas(currentNodes, currentEdges, vp, presToSave);
        lastEmittedJsonRef.current = jsonStr;
        clientLogger.debug('canvas', `triggerAutoSave emitting update for "${filePath}"`, {
          nodes: currentNodes.length,
          edges: currentEdges.length,
          bytes: jsonStr.length,
        });
        onChange(jsonStr);
      }, 600);
    },
    [filePath, onChange, readOnly, getViewport]
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
      clientLogger.debug('canvas', `Node drag start: ${node.id}`, { type: node.type });
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
    (_event, node) => {
      clientLogger.debug('canvas', `Node drag stop: ${node.id}`, {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
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
        const validIds = new Set(nextNodes.map((n) => n.id));
        const prunedPres = prunePresentationNodeIds(presentationRef.current, validIds);
        presentationRef.current = prunedPres;
        setPresentation(prunedPres);

        setEdges((eds) => {
          const nextEdges = eds.filter(
            (e) => !idsToDelete.has(e.source) && !idsToDelete.has(e.target)
          );
          pushHistory(nextNodes, nextEdges);
          triggerAutoSave(nextNodes, nextEdges, prunedPres);
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

  // ============================================================================
  // Presentation Management & Playback
  // ============================================================================
  const getContainerDimensions = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : window.innerWidth || 1280,
      height: rect && rect.height > 0 ? rect.height : window.innerHeight || 720,
    };
  }, []);

  const updatePresentation = useCallback(
    (updater: (prev: CanvasPresentation) => CanvasPresentation) => {
      const next = updater(presentationRef.current);
      presentationRef.current = next;
      setPresentation(next);
      triggerAutoSave(latestNodesRef.current, latestEdgesRef.current, next);
    },
    [triggerAutoSave]
  );

  const selectedSlideIndex = useMemo(
    () => presentation.slides.findIndex((s) => s.id === selectedSlideId),
    [presentation.slides, selectedSlideId]
  );
  const selectedSlide = selectedSlideIndex >= 0 ? presentation.slides[selectedSlideIndex] : null;
  const hiddenNodeIdsOnSelectedSlide = useMemo(
    () => new Set(selectedSlide?.hiddenNodeIds || []),
    [selectedSlide]
  );

  const handleCaptureNewSlide = useCallback(() => {
    const { width, height } = getContainerDimensions();
    let vp: Viewport = { x: 0, y: 0, zoom: 1 };
    try {
      vp = getViewport();
    } catch {}
    const bounds = captureViewportBounds(vp, width, height);
    const prevSlides = presentationRef.current.slides;
    const prevSlide = prevSlides[prevSlides.length - 1];
    const newId = `slide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSlide: CanvasPresentationSlide = {
      id: newId,
      title: t('canvas.presentation.slideDefaultTitle', { num: prevSlides.length + 1 }),
      bounds,
      hiddenNodeIds: prevSlide ? [...prevSlide.hiddenNodeIds] : [],
    };
    updatePresentation((prev) => ({
      ...prev,
      slides: [...prev.slides, newSlide],
    }));
    setSelectedSlideId(newId);
  }, [getContainerDimensions, getViewport, t, updatePresentation]);

  const handleUpdateSlideView = useCallback(
    (slideId: string) => {
      const { width, height } = getContainerDimensions();
      let vp: Viewport = { x: 0, y: 0, zoom: 1 };
      try {
        vp = getViewport();
      } catch {}
      const bounds = captureViewportBounds(vp, width, height);
      updatePresentation((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => (s.id === slideId ? { ...s, bounds } : s)),
      }));
    },
    [getContainerDimensions, getViewport, updatePresentation]
  );

  const handleUpdateSlideTitle = useCallback(
    (slideId: string, title: string) => {
      updatePresentation((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => (s.id === slideId ? { ...s, title } : s)),
      }));
    },
    [updatePresentation]
  );

  const handleUpdateSlideOverrides = useCallback(
    (slideId: string, overrides: { zoomDuration?: number; revealDuration?: number }) => {
      updatePresentation((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => {
          if (s.id !== slideId) return s;
          const updated: CanvasPresentationSlide = { ...s };
          if (overrides.zoomDuration !== undefined) updated.zoomDuration = overrides.zoomDuration;
          else delete updated.zoomDuration;
          if (overrides.revealDuration !== undefined) updated.revealDuration = overrides.revealDuration;
          else delete updated.revealDuration;
          return updated;
        }),
      }));
    },
    [updatePresentation]
  );

  const handleReorderSlides = useCallback(
    (fromIndex: number, toIndex: number) => {
      updatePresentation((prev) => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.slides.length ||
          toIndex >= prev.slides.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }
        const nextSlides = [...prev.slides];
        const [moved] = nextSlides.splice(fromIndex, 1);
        nextSlides.splice(toIndex, 0, moved);
        return { ...prev, slides: nextSlides };
      });
    },
    [updatePresentation]
  );

  const handleDeleteSlide = useCallback(
    (slideId: string) => {
      updatePresentation((prev) => {
        const nextSlides = prev.slides.filter((s) => s.id !== slideId);
        if (selectedSlideId === slideId) {
          setSelectedSlideId(nextSlides[0]?.id ?? null);
        }
        return { ...prev, slides: nextSlides };
      });
    },
    [selectedSlideId, updatePresentation]
  );

  const handleUpdatePresentationConfig = useCallback(
    (partial: Partial<CanvasPresentationConfig>) => {
      updatePresentation((prev) => ({
        ...prev,
        config: { ...prev.config, ...partial },
      }));
    },
    [updatePresentation]
  );

  const handleSelectSlide = useCallback(
    (slideId: string) => {
      setSelectedSlideId(slideId);
      const slide = presentationRef.current.slides.find((s) => s.id === slideId);
      if (slide) {
        const { width, height } = getContainerDimensions();
        const targetVp = boundsToViewport(slide.bounds, width, height);
        try {
          setViewport(targetVp, { duration: 400 });
        } catch {
          try {
            setViewport(targetVp);
          } catch {}
        }
      }
    },
    [getContainerDimensions, setViewport]
  );

  const handleToggleNodeHiddenOnSlide = useCallback(
    (nodeId: string) => {
      if (!selectedSlideId) return;
      updatePresentation((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => {
          if (s.id !== selectedSlideId) return s;
          const exists = s.hiddenNodeIds.includes(nodeId);
          return {
            ...s,
            hiddenNodeIds: exists
              ? s.hiddenNodeIds.filter((id) => id !== nodeId)
              : [...s.hiddenNodeIds, nodeId],
          };
        }),
      }));
    },
    [selectedSlideId, updatePresentation]
  );

  const handleToggleSelectedNodesHiddenOnSlide = useCallback(() => {
    if (!selectedSlideId || selectedNodes.length === 0) return;
    const selectedIds = selectedNodes.map((n) => n.id);
    updatePresentation((prev) => ({
      ...prev,
      slides: prev.slides.map((s) => {
        if (s.id !== selectedSlideId) return s;
        const hiddenSet = new Set(s.hiddenNodeIds);
        const allAlreadyHidden = selectedIds.every((id) => hiddenSet.has(id));
        if (allAlreadyHidden) {
          for (const id of selectedIds) hiddenSet.delete(id);
        } else {
          for (const id of selectedIds) hiddenSet.add(id);
        }
        return { ...s, hiddenNodeIds: Array.from(hiddenSet) };
      }),
    }));
  }, [selectedSlideId, selectedNodes, updatePresentation]);

  const clearPresentationTimers = useCallback(() => {
    if (cancelAnimationRef.current) {
      cancelAnimationRef.current();
      cancelAnimationRef.current = null;
    }
    if (revealDelayTimerRef.current) {
      clearTimeout(revealDelayTimerRef.current);
      revealDelayTimerRef.current = null;
    }
    if (revealFinishTimerRef.current) {
      clearTimeout(revealFinishTimerRef.current);
      revealFinishTimerRef.current = null;
    }
  }, []);

  const resetHudIdleTimer = useCallback(() => {
    setIsHudIdle(false);
    if (hudIdleTimerRef.current) clearTimeout(hudIdleTimerRef.current);
    hudIdleTimerRef.current = setTimeout(() => {
      setIsHudIdle(true);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      clearPresentationTimers();
      if (hudIdleTimerRef.current) clearTimeout(hudIdleTimerRef.current);
    };
  }, [clearPresentationTimers]);

  const startPresentation = useCallback(
    (fromIndex = 0) => {
      const slides = presentationRef.current.slides;
      if (slides.length === 0) return;
      const safeIndex = Math.max(0, Math.min(slides.length - 1, fromIndex));
      const targetSlide = slides[safeIndex];
      const allNodeIds = latestNodesRef.current.map((n) => n.id);

      clearPresentationTimers();
      setContextMenuPos(null);
      setEditingNodeState(null);
      setIsPresenting(true);
      setPresentingSlideIndex(safeIndex);
      setEndIndicatorVisible(false);
      setRevealPhase('idle');
      setRevealingDelayMap(new Map());
      setVisibleNodeIdsInPresentation(getVisibleNodeIdsForSlide(targetSlide, allNodeIds));
      resetHudIdleTimer();

      requestAnimationFrame(() => {
        const { width, height } = getContainerDimensions();
        const targetVp = boundsToViewport(targetSlide.bounds, width, height);
        try {
          setViewport(targetVp);
        } catch {}
      });
    },
    [clearPresentationTimers, getContainerDimensions, resetHudIdleTimer, setViewport]
  );

  const goToSlide = useCallback(
    (targetIndex: number, direction: 'forward' | 'backward') => {
      const { config, slides } = presentationRef.current;
      if (targetIndex < 0 || targetIndex >= slides.length) return;
      const targetSlide = slides[targetIndex];
      const allNodeIds = latestNodesRef.current.map((n) => n.id);

      clearPresentationTimers();
      resetHudIdleTimer();
      setEndIndicatorVisible(false);
      setPresentingSlideIndex(targetIndex);

      const { width, height } = getContainerDimensions();
      const targetVp = boundsToViewport(targetSlide.bounds, width, height);
      let startVp: Viewport = targetVp;
      try {
        startVp = getViewport();
      } catch {}

      const zoomDuration = targetSlide.zoomDuration ?? config.zoomDuration;
      const revealDuration = targetSlide.revealDuration ?? config.revealDuration;

      if (direction === 'backward') {
        setRevealPhase('moving');
        setRevealingDelayMap(new Map());
        setVisibleNodeIdsInPresentation(getVisibleNodeIdsForSlide(targetSlide, allNodeIds));

        cancelAnimationRef.current = animateViewportTo({
          startViewport: startVp,
          targetViewport: targetVp,
          duration: zoomDuration,
          containerWidth: width,
          containerHeight: height,
          zoomArc: config.zoomArc,
          onUpdate: (vp) => {
            try {
              setViewport(vp);
            } catch {}
          },
          onComplete: () => {
            cancelAnimationRef.current = null;
            setRevealPhase('idle');
          },
        });
        return;
      }

      // Forward transition with progressive reveal
      const prevSlide = slides[presentingSlideIndex];
      const prevVisibleIds = prevSlide
        ? getVisibleNodeIdsForSlide(prevSlide, allNodeIds)
        : visibleNodeIdsInPresentation;
      const transition = computeSlideTransitionVisibility(prevVisibleIds, targetSlide, allNodeIds);

      setRevealPhase('moving');
      setRevealingDelayMap(new Map());
      setVisibleNodeIdsInPresentation(transition.immediateVisibleIds);

      cancelAnimationRef.current = animateViewportTo({
        startViewport: startVp,
        targetViewport: targetVp,
        duration: zoomDuration,
        containerWidth: width,
        containerHeight: height,
        zoomArc: config.zoomArc,
        onUpdate: (vp) => {
          try {
            setViewport(vp);
          } catch {}
        },
        onComplete: () => {
          cancelAnimationRef.current = null;
          if (transition.newlyRevealedIds.length === 0) {
            setRevealPhase('idle');
            return;
          }

          setRevealPhase('revealing');
          revealDelayTimerRef.current = setTimeout(() => {
            const delayMap = new Map<string, number>();
            transition.newlyRevealedIds.forEach((id, idx) => {
              delayMap.set(id, idx * config.staggerDelay);
            });
            setActiveRevealDuration(revealDuration);
            setRevealingDelayMap(delayMap);
            setVisibleNodeIdsInPresentation(transition.targetVisibleIds);

            const totalRevealMs =
              revealDuration + Math.max(0, transition.newlyRevealedIds.length - 1) * config.staggerDelay + 40;
            revealFinishTimerRef.current = setTimeout(() => {
              setRevealingDelayMap(new Map());
              setRevealPhase('idle');
            }, totalRevealMs);
          }, config.revealDelay);
        },
      });
    },
    [
      clearPresentationTimers,
      getContainerDimensions,
      getViewport,
      presentingSlideIndex,
      resetHudIdleTimer,
      setViewport,
      visibleNodeIdsInPresentation,
    ]
  );

  const fastForwardReveal = useCallback(() => {
    const slides = presentationRef.current.slides;
    const currentSlide = slides[presentingSlideIndex];
    if (!currentSlide) return;

    clearPresentationTimers();
    const { width, height } = getContainerDimensions();
    try {
      setViewport(boundsToViewport(currentSlide.bounds, width, height));
    } catch {}
    const allNodeIds = latestNodesRef.current.map((n) => n.id);
    setRevealingDelayMap(new Map());
    setVisibleNodeIdsInPresentation(getVisibleNodeIdsForSlide(currentSlide, allNodeIds));
    setRevealPhase('idle');
  }, [clearPresentationTimers, getContainerDimensions, presentingSlideIndex, setViewport]);

  const exitPresentation = useCallback(() => {
    clearPresentationTimers();
    if (hudIdleTimerRef.current) clearTimeout(hudIdleTimerRef.current);
    setIsPresenting(false);
    setEndIndicatorVisible(false);
    setRevealPhase('idle');
    setRevealingDelayMap(new Map());
  }, [clearPresentationTimers]);

  const handleAdvancePresentation = useCallback(() => {
    if (revealPhase !== 'idle') {
      fastForwardReveal();
      return;
    }
    const slides = presentationRef.current.slides;
    if (presentingSlideIndex < slides.length - 1) {
      goToSlide(presentingSlideIndex + 1, 'forward');
    } else if (!endIndicatorVisible) {
      setEndIndicatorVisible(true);
      resetHudIdleTimer();
    } else {
      exitPresentation();
    }
  }, [
    endIndicatorVisible,
    exitPresentation,
    fastForwardReveal,
    goToSlide,
    presentingSlideIndex,
    resetHudIdleTimer,
    revealPhase,
  ]);

  const handlePrevPresentation = useCallback(() => {
    if (presentingSlideIndex > 0) {
      goToSlide(presentingSlideIndex - 1, 'backward');
    }
  }, [goToSlide, presentingSlideIndex]);

  // Keyboard shortcut listener (Presentation navigation, Ctrl+Z, Ctrl+Y, Delete, Type-to-Edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPresenting) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          exitPresentation();
          return;
        }
        if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleAdvancePresentation();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          e.stopPropagation();
          handlePrevPresentation();
          return;
        }
        return;
      }

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

    window.addEventListener('keydown', handleKeyDown, { capture: isPresenting });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: isPresenting });
  }, [
    isPresenting,
    exitPresentation,
    handleAdvancePresentation,
    handlePrevPresentation,
    handleUndo,
    handleRedo,
    selectedNodes,
    selectedEdges,
    handleDeleteNode,
    handleDeleteEdge,
    readOnly,
  ]);

  // Decorate nodes & edges for presentation playback or edit-mode ghosting
  const renderedNodes = useMemo(() => {
    if (isPresenting) {
      return nodes.map((n) => {
        const isVisible = visibleNodeIdsInPresentation.has(n.id);
        const staggerMs = revealingDelayMap.get(n.id);
        const presClass = !isVisible
          ? 'canvas-pres-hidden'
          : staggerMs !== undefined
            ? 'canvas-pres-visible canvas-pres-revealing'
            : 'canvas-pres-visible';
        const extraStyle: Record<string, any> = {};
        if (staggerMs !== undefined) {
          extraStyle['--pres-reveal-duration'] = `${activeRevealDuration}ms`;
          extraStyle['--pres-reveal-delay'] = `${staggerMs}ms`;
        }
        return {
          ...n,
          selected: false,
          className: [n.className, presClass].filter(Boolean).join(' '),
          style: { ...(n.style || {}), ...extraStyle },
        };
      });
    }
    if (isPresentationPanelOpen && selectedSlide && hiddenNodeIdsOnSelectedSlide.size > 0) {
      return nodes.map((n) => {
        if (!hiddenNodeIdsOnSelectedSlide.has(n.id)) return n;
        return {
          ...n,
          className: [n.className, 'canvas-pres-ghosted'].filter(Boolean).join(' '),
        };
      });
    }
    return nodes;
  }, [
    activeRevealDuration,
    hiddenNodeIdsOnSelectedSlide,
    isPresentationPanelOpen,
    isPresenting,
    nodes,
    revealingDelayMap,
    selectedSlide,
    visibleNodeIdsInPresentation,
  ]);

  const renderedEdges = useMemo(() => {
    if (isPresenting) {
      return edges.map((e) => {
        const isVisible = isEdgeVisibleForNodes(e, visibleNodeIdsInPresentation);
        const srcDelay = revealingDelayMap.get(e.source);
        const tgtDelay = revealingDelayMap.get(e.target);
        const isRevealing = isVisible && (srcDelay !== undefined || tgtDelay !== undefined);
        const edgeDelay = Math.max(srcDelay ?? 0, tgtDelay ?? 0);
        const presClass = !isVisible
          ? 'canvas-pres-edge-hidden'
          : isRevealing
            ? 'canvas-pres-edge-visible canvas-pres-edge-revealing'
            : 'canvas-pres-edge-visible';
        const extraStyle: Record<string, any> = {};
        if (isRevealing) {
          extraStyle['--pres-reveal-duration'] = `${activeRevealDuration}ms`;
          extraStyle['--pres-reveal-delay'] = `${edgeDelay}ms`;
        }
        return {
          ...e,
          selected: false,
          className: [e.className, presClass].filter(Boolean).join(' '),
          style: { ...(e.style || {}), ...extraStyle },
        };
      });
    }
    if (isPresentationPanelOpen && selectedSlide && hiddenNodeIdsOnSelectedSlide.size > 0) {
      return edges.map((e) => {
        if (
          !hiddenNodeIdsOnSelectedSlide.has(e.source) &&
          !hiddenNodeIdsOnSelectedSlide.has(e.target)
        ) {
          return e;
        }
        return {
          ...e,
          className: [e.className, 'canvas-pres-edge-ghosted'].filter(Boolean).join(' '),
        };
      });
    }
    return edges;
  }, [
    activeRevealDuration,
    edges,
    hiddenNodeIdsOnSelectedSlide,
    isPresentationPanelOpen,
    isPresenting,
    revealingDelayMap,
    selectedSlide,
    visibleNodeIdsInPresentation,
  ]);

  const activePresentingSlide = presentation.slides[presentingSlideIndex] || null;
  const effectiveReadOnly = readOnly || isPresenting;
  const isSelectedNodeHidden = Boolean(
    selectedNode && hiddenNodeIdsOnSelectedSlide.has(selectedNode.id)
  );

  return (
    <CanvasContext.Provider
      value={{
        onOpenNote,
        onSelectTag,
        onUpdateNodeData: handleUpdateNodeData,
        allNotes,
        readOnly: effectiveReadOnly,
        editingNodeState,
        setEditingNodeState,
        hiddenNodeIdsOnSelectedSlide,
        hasSelectedSlide: Boolean(isPresentationPanelOpen && selectedSlide),
        onToggleNodeHiddenOnSlide: handleToggleNodeHiddenOnSlide,
      }}
    >
      <div
        className={`canvas-editor-wrapper ${selectedNode || selectedEdge ? 'has-selection' : ''} ${
          isPresenting ? 'is-presenting' : ''
        }`}
        ref={containerRef}
        onMouseMove={isPresenting ? resetHudIdleTimer : undefined}
      >
        {/* Top dock toolbar */}
        {!effectiveReadOnly && (
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
            isPresentationPanelOpen={isPresentationPanelOpen}
            onTogglePresentationPanel={() => setIsPresentationPanelOpen((prev) => !prev)}
            presentationSlideCount={presentation.slides.length}
          />
        )}

        {/* Floating Context Inspector for selected Node or Edge (mutually exclusive) */}
        {!effectiveReadOnly && (
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
            hasSelectedSlide={Boolean(isPresentationPanelOpen && selectedSlide)}
            isSelectedNodeHiddenOnSlide={isSelectedNodeHidden}
            onToggleSelectedNodesHiddenOnSlide={handleToggleSelectedNodesHiddenOnSlide}
          />
        )}

        {/* Presentation Slide Drawer / Panel in Edit Mode */}
        {!effectiveReadOnly && isPresentationPanelOpen && (
          <CanvasPresentationPanel
            presentation={presentation}
            selectedSlideId={selectedSlideId}
            onSelectSlide={handleSelectSlide}
            onCaptureNewSlide={handleCaptureNewSlide}
            onUpdateSlideView={handleUpdateSlideView}
            onUpdateSlideTitle={handleUpdateSlideTitle}
            onUpdateSlideOverrides={handleUpdateSlideOverrides}
            onReorderSlides={handleReorderSlides}
            onDeleteSlide={handleDeleteSlide}
            onUpdateConfig={handleUpdatePresentationConfig}
            onStartPresentation={startPresentation}
            onClose={() => setIsPresentationPanelOpen(false)}
          />
        )}

        {/* Full-size ReactFlow Container */}
        <div className="canvas-reactflow-container" style={{ width: '100%', height: '100%' }}>
          <ReactFlow
            style={{ width: '100%', height: '100%' }}
            nodes={renderedNodes}
            edges={renderedEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            edgesReconnectable={!effectiveReadOnly}
            nodesDraggable={!effectiveReadOnly}
            nodesConnectable={!effectiveReadOnly}
            elementsSelectable={!effectiveReadOnly}
            elevateEdgesOnSelect={false}
            elevateNodesOnSelect={true}
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
            {!isPresenting && gridConfig.showGrid && gridConfig.gridVariant !== 'off' && (
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
            {!isPresenting && isPresentationPanelOpen && selectedSlide && (
              <SlideBoundsOverlay slide={selectedSlide} slideIndex={selectedSlideIndex} />
            )}
            {!isPresenting && <Controls showInteractive={false} className="canvas-rf-controls" />}
            {!isPresenting && (
              <MiniMap
                nodeColor={(n) => {
                  if (n.data?.color) return resolveCanvasColor(n.data.color as string) || 'var(--accent-color, #d4af37)';
                  return 'var(--text-muted, #888888)';
                }}
                maskColor="var(--border-subtle, rgba(0, 0, 0, 0.45))"
                className="canvas-rf-minimap"
              />
            )}
          </ReactFlow>
        </div>

        {/* Fullscreen Presentation Player HUD */}
        {isPresenting && activePresentingSlide && (
          <div
            className={`canvas-pres-hud ${isHudIdle ? 'is-idle' : ''}`}
            onMouseEnter={() => {
              if (hudIdleTimerRef.current) clearTimeout(hudIdleTimerRef.current);
              setIsHudIdle(false);
            }}
            onMouseLeave={resetHudIdleTimer}
          >
            <button
              type="button"
              className="canvas-pres-hud-btn"
              disabled={presentingSlideIndex === 0}
              onClick={handlePrevPresentation}
              title={t('canvas.presentation.prevSlide')}
              aria-label={t('canvas.presentation.prevSlide')}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="canvas-pres-hud-status">
              <span className="canvas-pres-hud-counter">
                {t('canvas.presentation.slideCounter', {
                  current: presentingSlideIndex + 1,
                  total: presentation.slides.length,
                })}
              </span>
              <span className="canvas-pres-hud-sep">–</span>
              <span className="canvas-pres-hud-title">{activePresentingSlide.title}</span>
              {endIndicatorVisible && (
                <span className="canvas-pres-hud-end-badge">
                  {t('canvas.presentation.endOfPresentation')}
                </span>
              )}
            </div>
            <button
              type="button"
              className="canvas-pres-hud-btn"
              onClick={handleAdvancePresentation}
              title={t('canvas.presentation.nextSlide')}
              aria-label={t('canvas.presentation.nextSlide')}
            >
              <ChevronRight size={16} />
            </button>
            <div className="canvas-pres-hud-divider" />
            <button
              type="button"
              className="canvas-pres-hud-btn danger"
              onClick={exitPresentation}
              title={t('canvas.presentation.exitPresentation')}
              aria-label={t('canvas.presentation.exitPresentation')}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </CanvasContext.Provider>
  );
};

export const CanvasEditor: React.FC<CanvasEditorProps> = (props) => (
  <ReactFlowProvider>
    <CanvasEditorInner {...props} />
  </ReactFlowProvider>
);
