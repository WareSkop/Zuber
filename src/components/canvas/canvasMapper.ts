import type { Node, Edge, Viewport } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type {
  JsonCanvasDocument,
  JsonCanvasNode,
  JsonCanvasEdge,
  CanvasNodeType,
  CanvasShape,
  CanvasSide,
  CanvasEdgeStyle,
} from '../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../shared/canvasTypes';

export function parseCanvasJson(rawJson: string): JsonCanvasDocument {
  if (!rawJson || !rawJson.trim()) {
    return { nodes: [], edges: [] };
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === 'object') {
      const nodes: JsonCanvasNode[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const edges: JsonCanvasEdge[] = Array.isArray(parsed.edges) ? parsed.edges : [];
      const viewport =
        parsed.viewport && typeof parsed.viewport === 'object'
          ? {
              x: Number(parsed.viewport.x) || 0,
              y: Number(parsed.viewport.y) || 0,
              zoom: Number(parsed.viewport.zoom) || 1,
            }
          : undefined;

      return { nodes, edges, viewport };
    }
  } catch (err) {
    console.warn('[Knowmesh Canvas] Failed to parse .canvas JSON, falling back to empty canvas:', err);
  }
  return { nodes: [], edges: [] };
}

export function jsonCanvasToReactFlow(doc: JsonCanvasDocument): {
  nodes: Node[];
  edges: Edge[];
  viewport?: Viewport;
} {
  const nodes: Node[] = (doc.nodes || []).map((n) => {
    // Map JSON canvas type to ReactFlow node type
    let rfType = 'canvasShape';
    if (n.type === 'file') rfType = 'canvasFile';
    else if (n.type === 'group') rfType = 'canvasGroup';
    else if (n.type === 'link') rfType = 'canvasLink';

    const width = Math.max(40, n.width || (n.type === 'group' ? 400 : 260));
    const height = Math.max(40, n.height || (n.type === 'group' ? 300 : 160));

    return {
      id: n.id,
      type: rfType,
      position: { x: n.x || 0, y: n.y || 0 },
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        zIndex: n.zIndex ?? (n.type === 'group' ? -1 : 1),
      },
      data: {
        rawType: n.type,
        text: n.text || '',
        file: n.file || '',
        subpath: n.subpath || '',
        url: n.url || '',
        label: n.label || '',
        color: n.color,
        shape: (n.shape as CanvasShape) || 'rectangle',
        icon: n.icon,
      },
    };
  });

  const edges: Edge[] = (doc.edges || []).map((e) => {
    const strokeColor = resolveCanvasColor(e.color) || 'var(--border-strong, #888)';
    const edgeType =
      e.edgeStyle === 'straight'
        ? 'straight'
        : e.edgeStyle === 'step'
          ? 'smoothstep'
          : 'default';

    const rfEdge: Edge = {
      id: e.id,
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: e.fromSide || undefined,
      targetHandle: e.toSide || undefined,
      label: e.label || undefined,
      type: edgeType,
      style: {
        stroke: strokeColor,
        strokeWidth: 2,
      },
      data: {
        color: e.color,
        edgeStyle: e.edgeStyle || 'bezier',
        fromEnd: e.fromEnd,
        toEnd: e.toEnd ?? 'arrow',
      },
    };

    if (e.toEnd !== 'none') {
      rfEdge.markerEnd = {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 14,
        height: 14,
      };
    }

    if (e.fromEnd === 'arrow') {
      rfEdge.markerStart = {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 14,
        height: 14,
      };
    }

    return rfEdge;
  });

  return { nodes, edges, viewport: doc.viewport };
}

export function reactFlowToJsonCanvas(
  nodes: Node[],
  edges: Edge[],
  viewport?: Viewport
): string {
  const jsonNodes: JsonCanvasNode[] = nodes.map((node) => {
    const data = (node.data || {}) as Record<string, any>;
    let nodeType: CanvasNodeType = (data.rawType as CanvasNodeType) || 'text';
    if (node.type === 'canvasFile') nodeType = 'file';
    else if (node.type === 'canvasGroup') nodeType = 'group';
    else if (node.type === 'canvasLink') nodeType = 'link';

    // Width & height calculation
    let w = node.measured?.width ?? node.width;
    if (typeof w !== 'number' && typeof node.style?.width === 'string') {
      w = parseFloat(node.style.width);
    }
    let h = node.measured?.height ?? node.height;
    if (typeof h !== 'number' && typeof node.style?.height === 'string') {
      h = parseFloat(node.style.height);
    }
    const finalW = Math.round(w && !isNaN(w) ? w : nodeType === 'group' ? 400 : 260);
    const finalH = Math.round(h && !isNaN(h) ? h : nodeType === 'group' ? 300 : 160);

    const jsonNode: JsonCanvasNode = {
      id: String(node.id),
      type: nodeType,
      x: Math.round(node.position.x || 0),
      y: Math.round(node.position.y || 0),
      width: finalW,
      height: finalH,
    };

    if (data.color) jsonNode.color = data.color;
    if (data.shape && data.shape !== 'rectangle') jsonNode.shape = data.shape;
    if (data.icon) jsonNode.icon = data.icon;
    if (typeof node.style?.zIndex === 'number') jsonNode.zIndex = node.style.zIndex;

    if (nodeType === 'text') {
      jsonNode.text = typeof data.text === 'string' ? data.text : '';
    } else if (nodeType === 'file') {
      jsonNode.file = typeof data.file === 'string' ? data.file : '';
      if (data.subpath) jsonNode.subpath = data.subpath;
    } else if (nodeType === 'group') {
      jsonNode.label = typeof data.label === 'string' ? data.label : '';
    } else if (nodeType === 'link') {
      jsonNode.url = typeof data.url === 'string' ? data.url : '';
    }

    return jsonNode;
  });

  const jsonEdges: JsonCanvasEdge[] = edges.map((edge) => {
    const data = (edge.data || {}) as Record<string, any>;
    const jsonEdge: JsonCanvasEdge = {
      id: String(edge.id),
      fromNode: String(edge.source),
      toNode: String(edge.target),
    };

    if (edge.sourceHandle) {
      jsonEdge.fromSide = edge.sourceHandle as CanvasSide;
    }
    if (edge.targetHandle) {
      jsonEdge.toSide = edge.targetHandle as CanvasSide;
    }
    if (typeof edge.label === 'string' && edge.label.trim()) {
      jsonEdge.label = edge.label.trim();
    }
    if (data.color) {
      jsonEdge.color = data.color;
    }

    // Arrows
    if (data.fromEnd === 'arrow') {
      jsonEdge.fromEnd = 'arrow';
    }
    if (data.toEnd === 'none') {
      jsonEdge.toEnd = 'none';
    } else {
      jsonEdge.toEnd = 'arrow';
    }

    // Edge style (Knowmesh extension)
    if (data.edgeStyle && data.edgeStyle !== 'bezier') {
      jsonEdge.edgeStyle = data.edgeStyle as CanvasEdgeStyle;
    }

    return jsonEdge;
  });

  const doc: JsonCanvasDocument = {
    nodes: jsonNodes,
    edges: jsonEdges,
  };

  if (viewport && typeof viewport.x === 'number') {
    doc.viewport = {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      zoom: Number(viewport.zoom.toFixed(2)),
    };
  }

  return JSON.stringify(doc, null, 2);
}
