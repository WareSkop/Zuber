import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowInstance,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink } from 'lucide-react';
import { api } from '../../api';
import { syncEngine } from '../../sync/syncEngine';
import { WorkflowCanvasIcon } from './WorkflowCanvasIcon';
import { CanvasContext } from './CanvasContext';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasGroupNode } from './nodes/CanvasGroupNode';
import { CanvasLinkNode } from './nodes/CanvasLinkNode';
import { parseCanvasJson, jsonCanvasToReactFlow } from './canvasMapper';

export interface CanvasEmbedWidgetProps {
  canvasPath: string;
  onOpenNote: (path: string) => void;
  allNotes?: any[];
  height?: string | number;
  fullSize?: boolean;
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

export const CanvasEmbedWidget: React.FC<CanvasEmbedWidgetProps> = ({
  canvasPath,
  onOpenNote,
  allNotes = [],
  height,
  fullSize = false,
}) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalNotes, setInternalNotes] = useState<any[]>(allNotes);

  useEffect(() => {
    if (allNotes && allNotes.length > 0) {
      setInternalNotes(allNotes);
      return;
    }
    let cancelled = false;
    syncEngine
      .getLocalDb()
      .getAllNotes()
      .then((notes) => {
        if (!cancelled && notes && notes.length > 0) {
          setInternalNotes(notes);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [allNotes]);

  const resolvedFullPath = useMemo(() => {
    const raw = canvasPath.trim().replace(/^\.?\/+/, '');
    const pool = internalNotes.length > 0 ? internalNotes : allNotes;
    const lowerRaw = raw.toLowerCase();
    const lowerWithCanvas = lowerRaw.endsWith('.canvas') ? lowerRaw : `${lowerRaw}.canvas`;
    const lowerWithoutCanvas = lowerRaw.replace(/\.canvas$/i, '');
    const baseNameRaw = lowerWithoutCanvas.split('/').pop() || lowerWithoutCanvas;

    const foundNote = pool.find((n: any) => {
      const p = (n.path || '').toLowerCase();
      const name = (n.name || '').toLowerCase();
      const base = (n.basename || name.replace(/\.canvas$/i, '')).toLowerCase();

      return (
        p === lowerRaw ||
        p === lowerWithCanvas ||
        p.endsWith(`/${lowerWithCanvas}`) ||
        p.endsWith(`/${lowerRaw}`) ||
        name === lowerRaw ||
        name === lowerWithCanvas ||
        base === baseNameRaw ||
        base === lowerWithoutCanvas
      );
    });

    return foundNote ? foundNote.path : canvasPath;
  }, [canvasPath, internalNotes, allNotes]);

  const parsedHeight = useMemo(() => {
    if (fullSize) return '100%';
    if (!height) return undefined;
    if (typeof height === 'number') return `${height}px`;
    const str = String(height).trim();
    return /^\d+$/.test(str) ? `${str}px` : str;
  }, [height, fullSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        let note: any;
        try {
          note = await syncEngine.getNote(resolvedFullPath);
        } catch {
          note = await api.getNote(resolvedFullPath);
        }
        if (cancelled) return;

        let raw: any = note?.rawContent ?? note?.body ?? note?.content ?? note;
        if (typeof raw === 'object' && raw !== null) {
          if (typeof raw.body === 'string') raw = raw.body;
          else if (typeof raw.rawContent === 'string') raw = raw.rawContent;
          else raw = JSON.stringify(raw);
        }
        const doc = parseCanvasJson(typeof raw === 'string' ? raw : '{}');
        const rf = jsonCanvasToReactFlow(doc);
        if (!cancelled) {
          setNodes(rf.nodes);
          setEdges(rf.edges);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(`Canvas-Datei konnte nicht geladen werden (${canvasPath})`);
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [resolvedFullPath, canvasPath]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    // Nach kurzem Timeout zentrieren, wenn das DOM steht:
    setTimeout(() => {
      instance.fitView({ padding: 0.25, duration: 250 });
    }, 60);
  }, []);

  const fileName = resolvedFullPath.split('/').pop() || resolvedFullPath;

  return (
    <div
      className="canvas-embed-container canvas-embed-widget embedded-canvas-container cm-lp-canvas-embed nodrag"
      style={parsedHeight ? { height: parsedHeight } : undefined}
    >
      <div className="canvas-embed-header">
        <div className="canvas-embed-title-cluster" title={resolvedFullPath}>
          <WorkflowCanvasIcon size={14} className="canvas-embed-icon" />
          <span className="canvas-embed-title">{fileName}</span>
        </div>
        <button
          type="button"
          className="canvas-embed-open-btn"
          onClick={() => onOpenNote(resolvedFullPath)}
          title="Im Editor öffnen ↗"
          aria-label="Im Editor öffnen"
        >
          <span>Im Editor öffnen</span>
          <ExternalLink size={13} />
        </button>
      </div>

      <div className="canvas-embed-body" style={{ width: '100%', height: 'calc(100% - 37px)', position: 'relative' }}>
        {loading ? (
          <div className="canvas-embed-loading">Lädt Canvas-Vorschau...</div>
        ) : error ? (
          <div className="canvas-embed-error">{error}</div>
        ) : (
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes,
              readOnly: true,
            }}
          >
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.25, includeHiddenNodes: false }}
                minZoom={0.1}
                maxZoom={2.0}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                panOnDrag={true}
                zoomOnScroll={true}
                onInit={onInit}
                proOptions={{ hideAttribution: true }}
                style={{ width: '100%', height: '100%' }}
              />
            </ReactFlowProvider>
          </CanvasContext.Provider>
        )}
      </div>
    </div>
  );
};
