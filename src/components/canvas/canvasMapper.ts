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
        zIndex: n.zIndex ?? (n.type === 'group' ? 0 : 20),
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

    const toEnd = e.toEnd ?? 'arrow';
    const fromEnd = e.fromEnd ?? 'none';

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
        fromEnd: fromEnd,
        toEnd: toEnd,
      },
    };

    if (toEnd === 'arrow') {
      rfEdge.markerEnd = {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 16,
        height: 16,
      };
    } else {
      rfEdge.markerEnd = undefined;
    }

    if (fromEnd === 'arrow') {
      rfEdge.markerStart = {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 16,
        height: 16,
      };
    } else {
      rfEdge.markerStart = undefined;
    }

    return rfEdge;
  });

  return { nodes, edges, viewport: doc.viewport };
}

/**
 * Calculates which child nodes are enclosed inside a group node's bounding box.
 * A node is enclosed if its center point (pos.x + width/2, pos.y + height/2) lies within the group bounds.
 */
export function getChildNodesInGroup(groupNode: Node, allNodes: Node[]): string[] {
  const isGroup =
    groupNode.type === 'canvasGroup' ||
    groupNode.type === 'group' ||
    groupNode.data?.rawType === 'group';
  if (!isGroup) return [];

  const styleGroupW =
    typeof groupNode.style?.width === 'number'
      ? groupNode.style.width
      : parseFloat(String(groupNode.style?.width || '400'));
  const groupW =
    groupNode.measured?.width ??
    groupNode.width ??
    (Number.isFinite(styleGroupW) ? styleGroupW : 400);

  const styleGroupH =
    typeof groupNode.style?.height === 'number'
      ? groupNode.style.height
      : parseFloat(String(groupNode.style?.height || '300'));
  const groupH =
    groupNode.measured?.height ??
    groupNode.height ??
    (Number.isFinite(styleGroupH) ? styleGroupH : 300);

  const groupLeft = groupNode.position.x;
  const groupTop = groupNode.position.y;
  const groupRight = groupLeft + groupW;
  const groupBottom = groupTop + groupH;

  const childIds: string[] = [];

  for (const node of allNodes) {
    if (node.id === groupNode.id) continue;
    const isOtherGroup =
      node.type === 'canvasGroup' ||
      node.type === 'group' ||
      node.data?.rawType === 'group';
    if (isOtherGroup) continue;

    const styleNodeW =
      typeof node.style?.width === 'number'
        ? node.style.width
        : parseFloat(String(node.style?.width || '260'));
    const nodeW =
      node.measured?.width ??
      node.width ??
      (Number.isFinite(styleNodeW) ? styleNodeW : 260);

    const styleNodeH =
      typeof node.style?.height === 'number'
        ? node.style.height
        : parseFloat(String(node.style?.height || '160'));
    const nodeH =
      node.measured?.height ??
      node.height ??
      (Number.isFinite(styleNodeH) ? styleNodeH : 160);

    const centerX = node.position.x + nodeW / 2;
    const centerY = node.position.y + nodeH / 2;

    if (
      centerX >= groupLeft &&
      centerX <= groupRight &&
      centerY >= groupTop &&
      centerY <= groupBottom
    ) {
      childIds.push(node.id);
    }
  }

  return childIds;
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

    // Arrows (strictly preserve toEnd on target and fromEnd on source)
    const toEnd = edge.markerEnd ? 'arrow' : (data.toEnd === 'arrow' ? 'arrow' : 'none');
    const fromEnd = edge.markerStart ? 'arrow' : (data.fromEnd === 'arrow' ? 'arrow' : 'none');

    jsonEdge.toEnd = toEnd;
    jsonEdge.fromEnd = fromEnd;

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
