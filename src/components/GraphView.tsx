import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Compass,
  Filter,
  Hash,
  Maximize2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GraphData, GraphNode } from '../../shared/types';

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
}

const GraphViewImpl: React.FC<GraphViewProps> = ({
  graphData,
  activeNotePath,
  isLocalGraph = false,
  onSelectNote,
  onSelectTag,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showTags, setShowTags] = useState(!isLocalGraph ? false : true);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [localMode, setLocalMode] = useState(isLocalGraph);
  const [repulsionStrength, setRepulsionStrength] = useState(isLocalGraph ? 1800 : 2200);
  const [showControls, setShowControls] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const alphaRef = useRef(1.0);
  const wakeUpRef = useRef<() => void>(() => {});

  // Sync prop changes
  useEffect(() => {
    setLocalMode(isLocalGraph);
  }, [isLocalGraph]);

  // Filter nodes & edges based on settings and local/global mode
  const filteredGraph = useMemo(() => {
    let nodes = graphData.nodes.filter((n) => {
      if (!showTags && n.type === 'tag') return false;
      if (!showUnresolved && n.type === 'unresolved') return false;
      if (filterQuery.trim()) {
        return n.label.toLowerCase().includes(filterQuery.trim().toLowerCase());
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
  }, [graphData, showTags, showUnresolved, filterQuery, localMode, activeNotePath]);

  const simNodesRef = useRef<SimNode[]>([]);
  const transformRef = useRef({ x: 0, y: 0, scale: isLocalGraph ? 0.95 : 0.75 });
  const dragStateRef = useRef<{
    type: 'none' | 'pan' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ type: 'none', startX: 0, startY: 0, moved: false });

  // Rebuild simulation nodes preserving existing positions when possible
  useEffect(() => {
    const prevMap = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const count = filteredGraph.nodes.length || 1;
    const radius = Math.min(420, 45 + Math.sqrt(count) * 28);

    simNodesRef.current = filteredGraph.nodes.map((n, idx) => {
      const existing = prevMap.get(n.id);
      if (existing) {
        return {
          ...existing,
          ...n,
        };
      }
      const goldenAngle = idx * 2.399963229728653;
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

      // --- Physics Step (only while alpha > 0.008) ---
      if (alpha > 0.008) {
        // 1. Center gravity
        for (const n of nodes) {
          if (n.pinned) continue;
          const gravity = n.id === activeNotePath && localMode ? 0.05 : 0.015;
          n.vx -= n.x * gravity * alpha;
          n.vy -= n.y * gravity * alpha;
        }

        // 2. Pairwise repulsion with distance cutoff
        const cutoffSq = 360 * 360;
        const rep = repulsionStrength * alpha;
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = b.x - a.x;
            if (dx > 360 || dx < -360) continue;
            const dy = b.y - a.y;
            if (dy > 360 || dy < -360) continue;
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

        // 3. Spring attraction along edges
        const targetLen = isLocalGraph ? 95 : 125;
        for (const edge of edges) {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) continue;
          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = dist - targetLen;
          const springK = (edge.type === 'tag' ? 0.025 : 0.045) * alpha;
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

        // 4. Integrate velocities with damping
        for (const n of nodes) {
          if (n.pinned) continue;
          n.vx *= 0.78;
          n.vy *= 0.78;
          n.x += Math.max(-15, Math.min(15, n.vx));
          n.y += Math.max(-15, Math.min(15, n.vy));
        }

        alphaRef.current *= nodes.length > 300 ? 0.92 : 0.95;
        needsDraw = true;
      }

      if (!needsDraw) return;
      needsDraw = false;

      // --- Drawing Step ---
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const scale = transformRef.current.scale;
      ctx.translate(width / 2 + transformRef.current.x, height / 2 + transformRef.current.y);
      ctx.scale(scale, scale);

      // Determine connected neighbors if a node is hovered
      const highlightedSet = new Set<string>();
      if (hoveredNodeId) {
        highlightedSet.add(hoveredNodeId);
        for (const e of edges) {
          if (e.source === hoveredNodeId) highlightedSet.add(e.target);
          if (e.target === hoveredNodeId) highlightedSet.add(e.source);
        }
      }

      // Draw edges
      for (const edge of edges) {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (!src || !tgt) continue;

        const isHighlighted =
          hoveredNodeId &&
          (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
        const isDimmed = hoveredNodeId && !isHighlighted;

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);

        if (isHighlighted) {
          ctx.strokeStyle = edge.type === 'tag' ? '#a6e3a1' : '#cba6f7';
          ctx.lineWidth = 2.2;
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(147, 153, 178, 0.14)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle =
            edge.type === 'tag'
              ? 'rgba(166, 227, 161, 0.35)'
              : 'rgba(180, 190, 254, 0.38)';
          ctx.lineWidth = 1.3;
        }

        ctx.stroke();
      }

      const manyNodes = nodes.length > 180;

      // Draw nodes
      for (const n of nodes) {
        const isActive = n.id === activeNotePath;
        const isHovered = n.id === hoveredNodeId;
        const isConnected = highlightedSet.has(n.id);
        const isDimmed = hoveredNodeId && !isConnected;
        const radius =
          (n.type === 'tag' ? 5 : 6) +
          Math.min(9, n.degree * 1.2) +
          (isActive ? 2.5 : 0);

        if (isActive || isHovered) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius + 5, 0, Math.PI * 2);
          ctx.fillStyle = isActive
            ? 'rgba(203, 166, 247, 0.28)'
            : 'rgba(137, 180, 250, 0.28)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);

        if (n.type === 'tag') {
          ctx.fillStyle = isDimmed ? 'rgba(166, 227, 161, 0.22)' : '#a6e3a1';
        } else if (n.type === 'unresolved') {
          ctx.fillStyle = isDimmed ? 'rgba(147, 153, 178, 0.18)' : '#6c7086';
        } else if (isActive) {
          ctx.fillStyle = '#cba6f7';
        } else {
          ctx.fillStyle = isDimmed ? 'rgba(137, 180, 250, 0.22)' : '#89b4fa';
        }

        ctx.fill();

        // Draw labels selectively when zoomed out on huge graphs to keep 60fps
        const showLabel =
          isActive ||
          isHovered ||
          isConnected ||
          !manyNodes ||
          scale > 0.95 ||
          (scale > 0.55 && n.degree >= 2);

        if (showLabel && !isDimmed) {
          ctx.font = `${isActive || isHovered ? '600 ' : ''}12px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = isActive || isHovered ? '#ffffff' : '#cdd6f4';
          ctx.fillText(n.label, n.x, n.y + radius + 13);
        }
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
  }, [filteredGraph, activeNotePath, hoveredNodeId, repulsionStrength, localMode, isLocalGraph]);

  // Convert screen coordinates to simulation coordinates
  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left - rect.width / 2 - transformRef.current.x;
    const sy = clientY - rect.top - rect.height / 2 - transformRef.current.y;
    return {
      x: sx / transformRef.current.scale,
      y: sy / transformRef.current.scale,
    };
  };

  const findNodeAt = (wx: number, wy: number): SimNode | null => {
    for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
      const n = simNodesRef.current[i];
      const radius = 8 + Math.min(9, n.degree * 1.2);
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy <= (radius + 5) * (radius + 5)) {
        return n;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const hit = findNodeAt(x, y);
    if (hit) {
      hit.pinned = true;
      dragStateRef.current = {
        type: 'node',
        nodeId: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    } else {
      dragStateRef.current = {
        type: 'pan',
        startX: e.clientX - transformRef.current.x,
        startY: e.clientY - transformRef.current.y,
        moved: false,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = dragStateRef.current;
    if (state.type === 'node' && state.nodeId) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx > 3 || dy > 3) state.moved = true;

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

    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const hit = findNodeAt(x, y);
    const nextHover = hit ? hit.id : null;
    if (nextHover !== hoveredNodeId) {
      setHoveredNodeId(nextHover);
      wakeUpRef.current();
    }
  };

  const handlePointerUp = () => {
    const state = dragStateRef.current;
    if (state.type === 'node' && state.nodeId) {
      const node = simNodesRef.current.find((n) => n.id === state.nodeId);
      if (node) {
        node.pinned = false;
        if (!state.moved) {
          if (node.type === 'note' && node.path) {
            onSelectNote(node.path, false);
          } else if (node.type === 'unresolved') {
            onSelectNote(node.label, true);
          } else if (node.type === 'tag' && onSelectTag) {
            onSelectTag(node.label.replace(/^#+/, ''));
          }
        }
      }
    }
    dragStateRef.current = { type: 'none', startX: 0, startY: 0, moved: false };
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const nextScale = Math.max(0.15, Math.min(3.5, transformRef.current.scale * factor));
    transformRef.current.scale = nextScale;
    wakeUpRef.current();
  };

  const resetCamera = () => {
    transformRef.current = { x: 0, y: 0, scale: isLocalGraph ? 0.95 : 0.75 };
    alphaRef.current = 0.6;
    wakeUpRef.current();
  };

  return (
    <div className={`graph-view-container ${isLocalGraph ? 'local-graph' : 'global-graph'}`}>
      <div className="graph-toolbar">
        <div className="graph-toolbar-left">
          <button
            type="button"
            className={`graph-pill-btn ${!localMode ? 'active' : ''}`}
            onClick={() => setLocalMode(false)}
            title="Alle Notizen im Vault anzeigen"
          >
            <Compass size={14} />
            <span>Global</span>
          </button>
          <button
            type="button"
            className={`graph-pill-btn ${localMode ? 'active' : ''}`}
            onClick={() => setLocalMode(true)}
            disabled={!activeNotePath}
            title="Nur Nachbarn der aktuellen Notiz anzeigen"
          >
            <Maximize2 size={14} />
            <span>Lokal</span>
          </button>
          <button
            type="button"
            className={`graph-pill-btn ${showTags ? 'active' : ''}`}
            onClick={() => setShowTags((v) => !v)}
            title="#Tag-Knoten ein-/ausblenden"
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
              transformRef.current.scale = Math.min(3.5, transformRef.current.scale * 1.2);
              wakeUpRef.current();
            }}
            title="Vergrößern"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="graph-icon-btn"
            onClick={() => {
              transformRef.current.scale = Math.max(0.15, transformRef.current.scale * 0.8);
              wakeUpRef.current();
            }}
            title="Verkleinern"
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            className="graph-icon-btn"
            onClick={resetCamera}
            title="Ansicht zentrieren"
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            className={`graph-icon-btn ${showControls ? 'active' : ''}`}
            onClick={() => setShowControls((s) => !s)}
            title="Graph-Filter & Physik"
          >
            <Filter size={15} />
          </button>
        </div>
      </div>

      {showControls && (
        <div className="graph-controls-popover">
          <div className="graph-control-row">
            <Search size={13} />
            <input
              type="text"
              placeholder="Knoten filtern..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
          <label className="graph-control-checkbox">
            <input
              type="checkbox"
              className="checkbox-custom"
              checked={showTags}
              onChange={(e) => setShowTags(e.target.checked)}
            />
            <span>#Tag-Knoten anzeigen</span>
          </label>
          <label className="graph-control-checkbox">
            <input
              type="checkbox"
              className="checkbox-custom"
              checked={showUnresolved}
              onChange={(e) => setShowUnresolved(e.target.checked)}
            />
            <span>Noch nicht erstellte Links</span>
          </label>
          <div className="graph-control-slider">
            <span>Abstoßung</span>
            <input
              type="range"
              min={600}
              max={5000}
              step={200}
              value={repulsionStrength}
              onChange={(e) => {
                setRepulsionStrength(Number(e.target.value));
                alphaRef.current = 0.6;
                wakeUpRef.current();
              }}
            />
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="graph-canvas"
        style={{ cursor: hoveredNodeId ? 'pointer' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      <div className="graph-legend">
        <span className="legend-item">
          <span className="legend-dot note-dot" /> Notiz
        </span>
        <span className="legend-item">
          <span className="legend-dot active-dot" /> Aktuell
        </span>
        {showTags && (
          <span className="legend-item">
            <span className="legend-dot tag-dot" /> #Tag
          </span>
        )}
        {showUnresolved && (
          <span className="legend-item">
            <span className="legend-dot unresolved-dot" /> Offen
          </span>
        )}
      </div>
    </div>
  );
};

export const GraphView = React.memo(GraphViewImpl);
