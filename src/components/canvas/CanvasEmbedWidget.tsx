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
    const normalizedTarget = canvasPath.trim();
    const pool = internalNotes.length > 0 ? internalNotes : allNotes;
    const foundNote = pool.find((n) =>
      n.path === normalizedTarget ||
      n.path === `${normalizedTarget}.canvas` ||
      n.path.toLowerCase() === normalizedTarget.toLowerCase() ||
      n.name === normalizedTarget ||
      n.name === normalizedTarget.replace(/\.canvas$/i, '') ||
      (n as any).basename === normalizedTarget ||
      (n as any).basename === normalizedTarget.replace(/\.canvas$/i, '')
    );
    return foundNote ? foundNote.path : canvasPath;
  }, [canvasPath, internalNotes, allNotes]);

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
    <div className="canvas-embed-container canvas-embed-widget embedded-canvas-container cm-lp-canvas-embed nodrag">
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
                minZoom={0.2}
                maxZoom={1.5}
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
