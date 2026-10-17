import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Compass,
  Filter,
  Hash,
  Maximize2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
  Sliders,
  Plus,
  Trash2,
  ExternalLink,
  X,
  FileQuestion,
  CircleDot,
  Radio,
} from 'lucide-react';
import type { GraphData, GraphNode } from '../../shared/types';
import { useTranslation } from '../i18n';

export interface GraphGroup {
  id: string;
  query: string;
  color: string;
}

export interface GraphSettings {
  filterQuery: string;
  showTags: boolean;
  showUnresolved: boolean;
  showOrphans: boolean;
  groups: GraphGroup[];
  nodeSizeMultiplier: number;
  textFadeThreshold: number;
  centerStrength: number;
  repelStrength: number;
  linkDistance: number;
}

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  filterQuery: '',
  showTags: false,
  showUnresolved: false,
  showOrphans: true,
  groups: [
    { id: '1', query: 'path:attachments', color: '#f59e0b' },
  ],
  nodeSizeMultiplier: 1.0,
  textFadeThreshold: 0.55,
  centerStrength: 0.018,
  repelStrength: 2400,
  linkDistance: 110,
};

const STORAGE_KEY = 'knowmesh_graph_settings';

function loadGraphSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('basalt_graph_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_GRAPH_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore error
  }
  return DEFAULT_GRAPH_SETTINGS;
}

function saveGraphSettings(settings: GraphSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore error
  }
}

export function matchNodeGroup(node: GraphNode, groups: GraphGroup[]): string | null {
  for (const g of groups) {
    const q = g.query.trim();
    if (!q) continue;

    if (q.toLowerCase().startsWith('path:')) {
      const sub = q.slice(5).trim().toLowerCase();
      const nodePath = (node.path || node.id).toLowerCase();
      if (nodePath.includes(sub)) return g.color;
    } else if (q.startsWith('#') || q.toLowerCase().startsWith('tag:')) {
      const tagSub = (q.startsWith('#') ? q.slice(1) : q.slice(4)).trim().toLowerCase();
      if (
        node.tags &&
        node.tags.some(
          (t) => t.toLowerCase() === tagSub || t.toLowerCase() === `#${tagSub}`
        )
      ) {
        return g.color;
      }
      if (
        node.type === 'tag' &&
        node.label.toLowerCase().replace(/^#+/, '') === tagSub
      ) {
        return g.color;
      }
    } else {
      if (node.label.toLowerCase().includes(q.toLowerCase())) {
        return g.color;
      }
    }
  }
  return null;
}

interface GraphViewProps {
  graphData: GraphData;
  activeNotePath: string | null;
  isLocalGraph?: boolean;
  onSelectNote: (pathOrTitle: string, isUnresolved?: boolean) => void;
  onSelectTag?: (tag: string) => void;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
  screenX?: number;
  screenY?: number;
  drawRadius?: number;
}

const GraphViewImpl: React.FC<GraphViewProps> = ({
  graphData,
  activeNotePath,
  isLocalGraph = false,
  onSelectNote,
  onSelectTag,
}) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settings, setSettings] = useState<GraphSettings>(() => {
    const init = loadGraphSettings();
    if (isLocalGraph) {
      init.showTags = true;
    }
    return init;
  });

  const [localMode, setLocalMode] = useState(isLocalGraph);
  const [showControls, setShowControls] = useState(false);
  const [controlsTab, setControlsTab] = useState<'filter' | 'groups' | 'physics'>('filter');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [touchSelectedNode, setTouchSelectedNode] = useState<SimNode | null>(null);

  const alphaRef = useRef(1.0);
  const wakeUpRef = useRef<() => void>(() => {});
  const transformRef = useRef({ x: 0, y: 0, scale: isLocalGraph ? 0.95 : 0.75 });

  // Update settings with persistence
  const updateSettings = useCallback((updater: (prev: GraphSettings) => GraphSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      saveGraphSettings(next);
      return next;
    });
    alphaRef.current = Math.max(alphaRef.current, 0.4);
    wakeUpRef.current();
  }, []);

  // Sync prop changes for local graph
  useEffect(() => {
    setLocalMode(isLocalGraph);
    if (isLocalGraph) {
      transformRef.current.scale = 0.95;
    }
    alphaRef.current = 1.0;
    wakeUpRef.current();
  }, [isLocalGraph]);

  // Filter nodes & edges based on settings and local/global mode
  const filteredGraph = useMemo(() => {
    let nodes = graphData.nodes.filter((n) => {
      if (!settings.showTags && n.type === 'tag') return false;
      if (!settings.showUnresolved && n.type === 'unresolved') return false;
      if (!settings.showOrphans && n.degree === 0) return false;

      if (settings.filterQuery.trim()) {
        const q = settings.filterQuery.trim().toLowerCase();
        if (q.startsWith('path:')) {
          const sub = q.slice(5).trim();
          if (!(n.path || n.id).toLowerCase().includes(sub)) return false;
        } else if (q.startsWith('#') || q.startsWith('tag:')) {
          const tagSub = (q.startsWith('#') ? q.slice(1) : q.slice(4)).trim();
          const matchTag =
            n.tags?.some((t) => t.toLowerCase().includes(tagSub)) ||
            (n.type === 'tag' && n.label.toLowerCase().includes(tagSub));
          if (!matchTag) return false;
        } else {
          if (!n.label.toLowerCase().includes(q)) return false;
        }
      }
      return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    let edges = graphData.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    if (localMode && activeNotePath) {
      const neighborIds = new Set<string>([activeNotePath]);
      for (const e of edges) {
        if (e.source === activeNotePath) neighborIds.add(e.target);
        if (e.target === activeNotePath) neighborIds.add(e.source);
      }
      nodes = nodes.filter((n) => neighborIds.has(n.id));
      const allowed = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => allowed.has(e.source) && allowed.has(e.target));
    }

    return { nodes, edges };
  }, [graphData, settings, localMode, activeNotePath]);

  const simNodesRef = useRef<SimNode[]>([]);
  const dragStateRef = useRef<{
    type: 'none' | 'pan' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    moved: boolean;
    startTime: number;
  }>({ type: 'none', startX: 0, startY: 0, moved: false, startTime: 0 });

  // Pinch-to-zoom state
  const touchStateRef = useRef<{
    initialDist: number;
    initialScale: number;
    centerScreenX: number;
    centerScreenY: number;
  } | null>(null);

  // Initialize nodes with Vogel-Spirale (Golden-Angle sunflower distribution)
  useEffect(() => {
    const prevMap = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const count = filteredGraph.nodes.length || 1;
    const radius = Math.min(520, 60 + Math.sqrt(count) * 26);

    simNodesRef.current = filteredGraph.nodes.map((n, idx) => {
      const existing = prevMap.get(n.id);
      if (existing) {
        return {
          ...existing,
          ...n,
        };
      }
      const goldenAngle = idx * 2.399963229728653; // Golden angle in radians
      const r = Math.sqrt((idx + 0.5) / count) * radius;
      const isCenter = n.id === activeNotePath;
      return {
        ...n,
        x: isCenter ? 0 : Math.cos(goldenAngle) * r,
        y: isCenter ? 0 : Math.sin(goldenAngle) * r,
        vx: 0,
        vy: 0,
      };
    });

    alphaRef.current = 1.0;
    wakeUpRef.current();
  }, [filteredGraph, activeNotePath]);

  // Main Render & Simulation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let needsDraw = true;

    const scheduleFrame = () => {
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(renderLoop);
      }
    };

    wakeUpRef.current = () => {
      needsDraw = true;
      scheduleFrame();
    };

    const renderLoop = () => {
      animationFrameId = null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(rect.width * dpr) ||
        canvas.height !== Math.floor(rect.height * dpr)
      ) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      const width = rect.width;
      const height = rect.height;
      const nodes = simNodesRef.current;
      const edges = filteredGraph.edges;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const alpha = alphaRef.current;

      // -------------------------------------------------------------
      // 1. Physics Step (Coulomb Repulsion via Spatial Hash + Springs)
      // -------------------------------------------------------------
      if (alpha > 0.008) {
        // 1.1 Weak radial centripetal force
        const cStrength = settings.centerStrength;
        for (const n of nodes) {
          if (n.pinned) continue;
          const gravity =
            n.id === activeNotePath && localMode ? cStrength * 2.8 : cStrength;
          n.vx -= n.x * gravity * alpha;
          n.vy -= n.y * gravity * alpha;
        }

        // 1.2 Spatial Hashing Grid for O(N) Coulomb Repulsion
        const cellSize = 180;
        const grid = new Map<number, number[]>();
        const hash = (cx: number, cy: number) =>
          ((cx & 0xffff) << 16) | (cy & 0xffff);

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const cx = Math.floor(n.x / cellSize);
          const cy = Math.floor(n.y / cellSize);
          const key = hash(cx, cy);
          const list = grid.get(key);
          if (list) list.push(i);
          else grid.set(key, [i]);
        }

        const rep = settings.repelStrength * alpha;
        const cutoffSq = 380 * 380;

        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          const acx = Math.floor(a.x / cellSize);
          const acy = Math.floor(a.y / cellSize);

          for (let cx = acx - 1; cx <= acx + 1; cx++) {
            for (let cy = acy - 1; cy <= acy + 1; cy++) {
              const cell = grid.get(hash(cx, cy));
              if (!cell) continue;
              for (const j of cell) {
                if (j <= i) continue; // Only once per pair
                const b = nodes[j];
                const dx = b.x - a.x;
                if (dx > 380 || dx < -380) continue;
                const dy = b.y - a.y;
                if (dy > 380 || dy < -380) continue;
                const distSq = dx * dx + dy * dy + 80;
                if (distSq > cutoffSq) continue;

                const force = rep / distSq;
                const invDist = 1 / Math.sqrt(distSq);
                const fx = dx * invDist * force;
                const fy = dy * invDist * force;

                if (!a.pinned) {
                  a.vx -= fx;
                  a.vy -= fy;
                }
                if (!b.pinned) {
                  b.vx += fx;
                  b.vy += fy;
                }
              }
            }
          }
        }

        // 1.3 Degree-weighted Spring Force along edges
        const baseLinkDist = settings.linkDistance;
        for (const edge of edges) {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) continue;

          const degA = src.degree || 1;
          const degB = tgt.degree || 1;
          let targetDist = baseLinkDist;

          // Leaf node hanging off a hub is pulled closer
          if (degA === 1 || degB === 1) {
            targetDist = baseLinkDist * 0.55;
          } else if (degA > 5 && degB > 5) {
            // Two major hubs keep a larger distance to prevent cluster collision
            targetDist = baseLinkDist * 1.8;
          }

          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = dist - targetDist;
          const springK = (edge.type === 'tag' ? 0.022 : 0.04) * alpha;
          const fx = (dx / dist) * displacement * springK;
          const fy = (dy / dist) * displacement * springK;

          if (!src.pinned) {
            src.vx += fx;
            src.vy += fy;
          }
          if (!tgt.pinned) {
            tgt.vx -= fx;
            tgt.vy -= fy;
          }
        }

        // 1.4 Velocity integration & damping
        for (const n of nodes) {
          if (n.pinned) continue;
          n.vx *= 0.78;
          n.vy *= 0.78;
          n.x += Math.max(-16, Math.min(16, n.vx));
          n.y += Math.max(-16, Math.min(16, n.vy));
        }

        alphaRef.current *= nodes.length > 300 ? 0.93 : 0.95;
        needsDraw = true;
      }

      if (!needsDraw) return;
      needsDraw = false;

      // -------------------------------------------------------------
      // 2. Screen-Space Rendering (Semantic Zoom)
      // -------------------------------------------------------------
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const scale = transformRef.current.scale;
      const panX = transformRef.current.x;
      const panY = transformRef.current.y;

      const toScreenX = (wx: number) => wx * scale + width / 2 + panX;
      const toScreenY = (wy: number) => wy * scale + height / 2 + panY;

      // Calculate screen positions and radii for each node
      for (const n of nodes) {
        n.screenX = toScreenX(n.x);
        n.screenY = toScreenY(n.y);
        const baseRadius = 2.8 + Math.log(1 + (n.degree || 0)) * 1.6;
        n.drawRadius = Math.min(
          14,
          Math.max(
            2.0,
            baseRadius * Math.pow(scale, 0.35) * settings.nodeSizeMultiplier
          )
        );
      }

      // Highlight / spotlight calculations
      const spotlightId = hoveredNodeId || touchSelectedNode?.id || null;
      const highlightedSet = new Set<string>();
      if (spotlightId) {
        highlightedSet.add(spotlightId);
        for (const e of edges) {
          if (e.source === spotlightId) highlightedSet.add(e.target);
          if (e.target === spotlightId) highlightedSet.add(e.source);
        }
      }

      const computedStyle = getComputedStyle(canvas);
      const activeColor =
        computedStyle.getPropertyValue('--accent-color').trim() || '#d4af37';
      const secondaryColor =
        computedStyle.getPropertyValue('--accent-secondary').trim() || '#29b6c8';
      const textColor =
        computedStyle.getPropertyValue('--text-primary').trim() || '#e6edf3';
      const mutedColor =
        computedStyle.getPropertyValue('--text-muted').trim() || '#8b949e';
      const edgeBaseColor = 'rgba(145, 155, 175, 0.22)';

      // 2.1 Draw edges (fine lines)
      for (const edge of edges) {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (!src || !tgt || src.screenX == null || tgt.screenX == null) continue;

        const isHighlighted =
          spotlightId &&
          (edge.source === spotlightId || edge.target === spotlightId);
        const isDimmed = spotlightId && !isHighlighted;

        ctx.beginPath();
        ctx.moveTo(src.screenX, src.screenY!);
        ctx.lineTo(tgt.screenX, tgt.screenY!);

        if (isHighlighted) {
          ctx.strokeStyle = edge.type === 'tag' ? secondaryColor : activeColor;
          ctx.lineWidth = 1.6;
          ctx.globalAlpha = 1.0;
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(145, 155, 175, 0.06)';
          ctx.lineWidth = 0.6;
          ctx.globalAlpha = 0.15;
        } else {
          ctx.strokeStyle = edge.type === 'tag' ? `${secondaryColor}55` : edgeBaseColor;
          ctx.lineWidth = 0.8;
          ctx.globalAlpha = 0.85;
        }

        ctx.stroke();
      }

      // 2.2 Draw nodes
      for (const n of nodes) {
        if (n.screenX == null || n.screenY == null || n.drawRadius == null) continue;

        const isSpecial = n.id === activeNotePath || n.id === spotlightId;
        const isConnected = highlightedSet.has(n.id);
        const isDimmed = spotlightId && !isConnected;

        // Determine node color
        let nodeColor = '#9ca3af'; // default subtle grey/slate
        const groupColor = matchNodeGroup(n, settings.groups);

        if (groupColor) {
          nodeColor = groupColor;
        } else if (n.type === 'tag') {
          nodeColor = secondaryColor;
        } else if (n.type === 'unresolved') {
          nodeColor = mutedColor;
        } else if (n.id === activeNotePath) {
          nodeColor = activeColor;
        }

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.15 : n.type === 'unresolved' ? 0.45 : 1.0;

        // Outer glow/ring for active or spotlighted node
        if (isSpecial) {
          ctx.beginPath();
          ctx.arc(n.screenX, n.screenY, n.drawRadius + 4, 0, Math.PI * 2);
          ctx.fillStyle = `${nodeColor}38`;
          ctx.fill();
        }

        // Inner solid circle
        ctx.beginPath();
        ctx.arc(n.screenX, n.screenY, n.drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();
        ctx.restore();
      }

      // -------------------------------------------------------------
      // 2.3 Intelligent Anti-Collision Label Rendering
      // -------------------------------------------------------------
      const textThreshold = settings.textFadeThreshold;
      const candidateNodes = nodes.filter((n) => {
        if (n.screenX == null || n.screenY == null) return false;
        // Cull outside canvas bounds with margin
        if (
          n.screenX < -100 ||
          n.screenX > width + 100 ||
          n.screenY < -100 ||
          n.screenY > height + 100
        ) {
          return false;
        }

        const isHover = n.id === spotlightId;
        const isConnected = highlightedSet.has(n.id);
        const isMajorHub = (n.degree || 0) >= 12;

        if (scale < textThreshold) {
          // When zoomed out, only show spotlighted, connected or major hubs
          return isHover || isConnected || isMajorHub;
        }
        return true;
      });

      // Priority sort: Spotlighted -> Active Note -> Degree descending
      candidateNodes.sort((a, b) => {
        if (a.id === spotlightId) return -1;
        if (b.id === spotlightId) return 1;
        if (highlightedSet.has(a.id) && !highlightedSet.has(b.id)) return -1;
        if (highlightedSet.has(b.id) && !highlightedSet.has(a.id)) return 1;
        if (a.id === activeNotePath) return -1;
        if (b.id === activeNotePath) return 1;
        return (b.degree || 0) - (a.degree || 0);
      });

      const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      const globalTextAlpha =
        scale < textThreshold
          ? 0.8
          : Math.min(1.0, (scale - textThreshold) / 0.4);

      for (const n of candidateNodes) {
        if (n.screenX == null || n.screenY == null || n.drawRadius == null) continue;

        const isSpotlight = n.id === spotlightId;
        const isConnected = highlightedSet.has(n.id);
        const isDimmed = spotlightId && !isConnected;
        if (isDimmed) continue;

        const label = n.label;
        const approxWidth = label.length * 6.2;
        const box = {
          x1: n.screenX - approxWidth / 2 - 4,
          y1: n.screenY + n.drawRadius + 2,
          x2: n.screenX + approxWidth / 2 + 4,
          y2: n.screenY + n.drawRadius + 18,
        };

        // Anti-overlap check
        let collides = false;
        for (const pb of placedBoxes) {
          if (box.x1 < pb.x2 && box.x2 > pb.x1 && box.y1 < pb.y2 && box.y2 > pb.y1) {
            collides = true;
            break;
          }
        }

        if (collides && !isSpotlight) {
          continue;
        }

        placedBoxes.push(box);

        ctx.save();
        const fontAlpha = isSpotlight || isConnected ? 1.0 : globalTextAlpha;
        ctx.globalAlpha = fontAlpha;
        ctx.font = `${
          isSpotlight || n.id === activeNotePath ? '600 ' : '400 '
        }11.5px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Draw pill background for spotlighted text to guarantee 100% legibility
        if (isSpotlight) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.beginPath();
          ctx.roundRect(
            box.x1 - 2,
            box.y1 - 1,
            box.x2 - box.x1 + 4,
            box.y2 - box.y1 + 2,
            4
          );
          ctx.fill();
        }

        ctx.fillStyle =
          isSpotlight || n.id === activeNotePath ? activeColor : textColor;
        ctx.fillText(label, n.screenX, n.screenY + n.drawRadius + 4);
        ctx.restore();
      }

      ctx.restore();

      if (alphaRef.current > 0.008) {
        scheduleFrame();
      }
    };

    scheduleFrame();
    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    };
  }, [
    filteredGraph,
    activeNotePath,
    hoveredNodeId,
    touchSelectedNode,
    settings,
    localMode,
  ]);

  // Screen to world coordinates converter
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = transformRef.current.scale;
    const sx = clientX - rect.left - rect.width / 2 - transformRef.current.x;
    const sy = clientY - rect.top - rect.height / 2 - transformRef.current.y;
    return {
      x: sx / scale,
      y: sy / scale,
    };
  }, []);

  const findNodeAt = useCallback(
    (clientX: number, clientY: number): SimNode | null => {
      const { x: wx, y: wy } = screenToWorld(clientX, clientY);
      const scale = transformRef.current.scale;

      // Hit test using screen-space distance for precision on all zoom levels
      for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
        const n = simNodesRef.current[i];
        const dx = wx - n.x;
        const dy = wy - n.y;
        const distWorld = Math.sqrt(dx * dx + dy * dy);
        const distScreen = distWorld * scale;
        const hitRadius = Math.max(16, (n.drawRadius || 8) + 8);
        if (distScreen <= hitRadius) {
          return n;
        }
      }
      return null;
    },
    [screenToWorld]
  );

  // Pointer / Mouse Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // If two or more touches are active, pinch handler takes over
    if (e.pointerType === 'touch' && touchStateRef.current) return;

    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit) {
      hit.pinned = true;
      dragStateRef.current = {
        type: 'node',
        nodeId: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        startTime: Date.now(),
      };
    } else {
      dragStateRef.current = {
        type: 'pan',
        startX: e.clientX - transformRef.current.x,
        startY: e.clientY - transformRef.current.y,
        moved: false,
        startTime: Date.now(),
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = dragStateRef.current;

    if (state.type === 'node' && state.nodeId) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx > 4 || dy > 4) state.moved = true;

      const { x, y } = screenToWorld(e.clientX, e.clientY);
      const node = simNodesRef.current.find((n) => n.id === state.nodeId);
      if (node) {
        node.x = x;
        node.y = y;
        node.vx = 0;
        node.vy = 0;
      }
      alphaRef.current = Math.max(alphaRef.current, 0.25);
      wakeUpRef.current();
      return;
    }

    if (state.type === 'pan') {
      transformRef.current.x = e.clientX - state.startX;
      transformRef.current.y = e.clientY - state.startY;
      state.moved = true;
      wakeUpRef.current();
      return;
    }

    // Hover detection for mouse pointers
    if (e.pointerType === 'mouse') {
      const hit = findNodeAt(e.clientX, e.clientY);
      const nextHover = hit ? hit.id : null;
      if (nextHover !== hoveredNodeId) {
        setHoveredNodeId(nextHover);
        wakeUpRef.current();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = dragStateRef.current;
    if (state.type === 'node' && state.nodeId) {
      const node = simNodesRef.current.find((n) => n.id === state.nodeId);
      if (node) {
        node.pinned = false;
        if (!state.moved) {
          // Tap / Click action
          if (e.pointerType === 'touch') {
            // Touch device: select node and show floating action pill
            setTouchSelectedNode(node);
            wakeUpRef.current();
          } else {
            // Desktop mouse click: open note directly
            navigateToNode(node);
          }
        }
      }
    } else if (state.type === 'pan' && !state.moved) {
      // Tap on empty space: clear touch selection
      if (touchSelectedNode) {
        setTouchSelectedNode(null);
        wakeUpRef.current();
      }
    }

    dragStateRef.current = {
      type: 'none',
      startX: 0,
      startY: 0,
      moved: false,
      startTime: 0,
    };
  };

  const navigateToNode = (node: SimNode) => {
    if (node.type === 'note' && node.path) {
      onSelectNote(node.path, false);
    } else if (node.type === 'unresolved') {
      onSelectNote(node.label, true);
    } else if (node.type === 'tag' && onSelectTag) {
      onSelectTag(node.label.replace(/^#+/, ''));
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextScale = Math.max(0.08, Math.min(6.0, transformRef.current.scale * factor));
    transformRef.current.scale = nextScale;
    wakeUpRef.current();
  };

  // Touch handlers for 2-finger pinch-to-zoom
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStateRef.current = {
        initialDist: dist,
        initialScale: transformRef.current.scale,
        centerScreenX: (t1.clientX + t2.clientX) / 2,
        centerScreenY: (t1.clientY + t2.clientY) / 2,
      };
      dragStateRef.current = {
        type: 'none',
        startX: 0,
        startY: 0,
        moved: false,
        startTime: 0,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && touchStateRef.current) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY
      );
      if (touchStateRef.current.initialDist > 0) {
        const ratio = currentDist / touchStateRef.current.initialDist;
        const newScale = Math.max(
          0.08,
          Math.min(6.0, touchStateRef.current.initialScale * ratio)
        );
        transformRef.current.scale = newScale;
        wakeUpRef.current();
      }
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current = null;
  };

  const resetCamera = () => {
    transformRef.current = { x: 0, y: 0, scale: isLocalGraph ? 0.95 : 0.75 };
    alphaRef.current = 0.6;
    wakeUpRef.current();
  };

  const addGroup = () => {
    const colors = ['#f59e0b', '#38bdf8', '#a855f7', '#ec4899', '#22c55e', '#ef4444'];
    const randomColor = colors[settings.groups.length % colors.length];
    const newGroup: GraphGroup = {
      id: String(Date.now()),
      query: '',
      color: randomColor,
    };
    updateSettings((prev) => ({
      ...prev,
      groups: [...prev.groups, newGroup],
    }));
  };

  const updateGroup = (id: string, partial: Partial<GraphGroup>) => {
    updateSettings((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === id ? { ...g, ...partial } : g)),
    }));
  };

  const removeGroup = (id: string) => {
    updateSettings((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== id),
    }));
  };

  return (
    <div
      className={`graph-view-container ${isLocalGraph ? 'local-graph' : 'global-graph'}`}
    >
      {/* Top Toolbar */}
      <div className="graph-toolbar">
        <div className="graph-toolbar-left">
          <button
            type="button"
            className={`graph-pill-btn ${!localMode ? 'active' : ''}`}
            onClick={() => setLocalMode(false)}
            title="Global"
          >
            <Compass size={14} />
            <span>Global</span>
          </button>
          <button
            type="button"
            className={`graph-pill-btn ${localMode ? 'active' : ''}`}
            onClick={() => setLocalMode(true)}
            disabled={!activeNotePath}
            title="Lokal"
          >
            <Maximize2 size={14} />
            <span>Lokal</span>
          </button>
          <button
            type="button"
            className={`graph-pill-btn ${settings.showTags ? 'active' : ''}`}
            onClick={() =>
              updateSettings((s) => ({ ...s, showTags: !s.showTags }))
            }
            title={t('graph.showTags')}
          >
            <Hash size={14} />
            <span>Tags</span>
          </button>
        </div>

        <div className="graph-toolbar-right">
          <button
            type="button"
            className="graph-icon-btn"
            onClick={() => {
              transformRef.current.scale = Math.min(
                6.0,
                transformRef.current.scale * 1.25
              );
              wakeUpRef.current();
            }}
            title={t('graph.zoomIn')}
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="graph-icon-btn"
            onClick={() => {
              transformRef.current.scale = Math.max(
                0.08,
                transformRef.current.scale * 0.8
              );
              wakeUpRef.current();
            }}
            title={t('graph.zoomOut')}
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            className="graph-icon-btn"
            onClick={resetCamera}
            title={t('graph.resetZoom')}
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className={`graph-icon-btn ${showControls ? 'active' : ''}`}
            onClick={() => setShowControls((s) => !s)}
            title={t('graph.filters')}
          >
            <Sliders size={15} />
          </button>
        </div>
      </div>

      {/* Collapsible Graph Settings Panel */}
      {showControls && (
        <div className="graph-controls-popover">
          <div className="graph-controls-tabs">
            <button
              type="button"
              className={`graph-tab-btn ${controlsTab === 'filter' ? 'active' : ''}`}
              onClick={() => setControlsTab('filter')}
            >
              {t('common.search')} / Filter
            </button>
            <button
              type="button"
              className={`graph-tab-btn ${controlsTab === 'groups' ? 'active' : ''}`}
              onClick={() => setControlsTab('groups')}
            >
              {t('graph.groups')} ({settings.groups.length})
            </button>
            <button
              type="button"
              className={`graph-tab-btn ${controlsTab === 'physics' ? 'active' : ''}`}
              onClick={() => setControlsTab('physics')}
            >
              {t('graph.physics')}
            </button>
            <button
              type="button"
              className="graph-tab-close"
              onClick={() => setShowControls(false)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="graph-controls-body">
            {controlsTab === 'filter' && (
              <div className="graph-panel-section">
                <div className="graph-control-row">
                  <Search size={13} />
                  <input
                    type="text"
                    placeholder={t('graph.searchPlaceholder')}
                    value={settings.filterQuery}
                    onChange={(e) =>
                      updateSettings((s) => ({ ...s, filterQuery: e.target.value }))
                    }
                  />
                  {settings.filterQuery && (
                    <button
                      type="button"
                      className="graph-clear-btn"
                      onClick={() =>
                        updateSettings((s) => ({ ...s, filterQuery: '' }))
                      }
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <label className="graph-control-checkbox">
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    checked={settings.showOrphans}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        showOrphans: e.target.checked,
                      }))
                    }
                  />
                  <span>{t('graph.showOrphans')}</span>
                </label>

                <label className="graph-control-checkbox">
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    checked={settings.showTags}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        showTags: e.target.checked,
                      }))
                    }
                  />
                  <span>{t('graph.showTags')}</span>
                </label>

                <label className="graph-control-checkbox">
                  <input
                    type="checkbox"
                    className="checkbox-custom"
                    checked={settings.showUnresolved}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        showUnresolved: e.target.checked,
                      }))
                    }
                  />
                  <span>{t('graph.showUnresolved')}</span>
                </label>
              </div>
            )}

            {controlsTab === 'groups' && (
              <div className="graph-panel-section">
                <div className="graph-groups-header">
                  <span>Farb-Gruppen ({settings.groups.length})</span>
                  <button
                    type="button"
                    className="btn-add-group"
                    onClick={addGroup}
                    title="Neue Gruppe hinzufügen"
                  >
                    <Plus size={12} /> Gruppe
                  </button>
                </div>
                <div className="graph-groups-list">
                  {settings.groups.length === 0 ? (
                    <div className="graph-groups-empty">
                      Keine Gruppen definiert. Klicke auf „+ Gruppe“, um Notizen nach Pfad oder Tag einzufärben.
                    </div>
                  ) : (
                    settings.groups.map((group) => (
                      <div key={group.id} className="graph-group-row">
                        <input
                          type="color"
                          className="graph-group-color"
                          value={group.color}
                          onChange={(e) =>
                            updateGroup(group.id, { color: e.target.value })
                          }
                          title="Farbe wählen"
                        />
                        <input
                          type="text"
                          className="graph-group-query"
                          placeholder="z. B. path:Projekte oder #krypto"
                          value={group.query}
                          onChange={(e) =>
                            updateGroup(group.id, { query: e.target.value })
                          }
                        />
                        <button
                          type="button"
                          className="graph-group-delete"
                          onClick={() => removeGroup(group.id)}
                          title="Gruppe löschen"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {controlsTab === 'physics' && (
              <div className="graph-panel-section">
                <div className="graph-control-slider">
                  <div className="slider-label">
                    <span>Knotengröße</span>
                    <span className="slider-val">{settings.nodeSizeMultiplier.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.5}
                    step={0.1}
                    value={settings.nodeSizeMultiplier}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        nodeSizeMultiplier: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="graph-control-slider">
                  <div className="slider-label">
                    <span>Text-Schwelle</span>
                    <span className="slider-val">{settings.textFadeThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    value={settings.textFadeThreshold}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        textFadeThreshold: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="graph-control-slider">
                  <div className="slider-label">
                    <span>Zentripetalkraft</span>
                    <span className="slider-val">{Math.round(settings.centerStrength * 1000)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.005}
                    max={0.05}
                    step={0.002}
                    value={settings.centerStrength}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        centerStrength: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="graph-control-slider">
                  <div className="slider-label">
                    <span>Abstoßungskraft</span>
                    <span className="slider-val">{settings.repelStrength}</span>
                  </div>
                  <input
                    type="range"
                    min={600}
                    max={5000}
                    step={200}
                    value={settings.repelStrength}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        repelStrength: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="graph-control-slider">
                  <div className="slider-label">
                    <span>Link-Abstand</span>
                    <span className="slider-val">{settings.linkDistance}px</span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={240}
                    step={10}
                    value={settings.linkDistance}
                    onChange={(e) =>
                      updateSettings((s) => ({
                        ...s,
                        linkDistance: Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <button
                  type="button"
                  className="btn-reset-physics"
                  onClick={() => {
                    updateSettings(() => ({ ...DEFAULT_GRAPH_SETTINGS }));
                    resetCamera();
                  }}
                >
                  <RotateCcw size={13} /> Auf Standard zurücksetzen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HTML5 Canvas with Touch Gestures */}
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        style={{ cursor: hoveredNodeId ? 'pointer' : 'grab', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Touch-Friendly Action Pill for Selected Node */}
      {touchSelectedNode && (
        <div className="graph-touch-action-pill">
          <div className="touch-pill-info">
            <span className="touch-pill-label">{touchSelectedNode.label}</span>
            <span className="touch-pill-meta">
              {touchSelectedNode.degree} {touchSelectedNode.degree === 1 ? 'Link' : 'Links'}
            </span>
          </div>
          <button
            type="button"
            className="touch-pill-btn"
            onClick={() => {
              navigateToNode(touchSelectedNode);
              setTouchSelectedNode(null);
            }}
          >
            <span>Notiz öffnen</span>
            <ExternalLink size={13} />
          </button>
          <button
            type="button"
            className="touch-pill-close"
            onClick={() => setTouchSelectedNode(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="graph-legend">
        <span className="legend-item">
          <span className="legend-dot note-dot" /> Notiz
        </span>
        <span className="legend-item">
          <span className="legend-dot active-dot" /> Aktuell
        </span>
        {settings.showTags && (
          <span className="legend-item">
            <span className="legend-dot tag-dot" /> #Tag
          </span>
        )}
        {settings.showUnresolved && (
          <span className="legend-item">
            <span className="legend-dot unresolved-dot" /> Offen
          </span>
        )}
      </div>
    </div>
  );
};

export const GraphView = React.memo(GraphViewImpl);
