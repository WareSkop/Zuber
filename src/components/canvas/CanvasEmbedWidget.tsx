import React, { useState, useEffect, useCallback } from 'react';
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
  allNotes?: { path: string; name: string; basename: string }[];
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getNote(canvasPath)
      .then((note) => {
        if (!cancelled) {
          const raw = note.rawContent || note.body || '{}';
          const doc = parseCanvasJson(raw);
          const rf = jsonCanvasToReactFlow(doc);
          setNodes(rf.nodes);
          setEdges(rf.edges);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Canvas-Datei konnte nicht geladen werden (${canvasPath})`);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasPath]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    // Nach kurzem Timeout zentrieren, wenn das DOM steht:
    setTimeout(() => {
      instance.fitView({ padding: 0.25, duration: 250 });
    }, 60);
  }, []);

  const fileName = canvasPath.split('/').pop() || canvasPath;

  return (
    <div className="canvas-embed-container embedded-canvas-container nodrag">
      <div className="canvas-embed-header">
        <div className="canvas-embed-title-cluster" title={canvasPath}>
          <WorkflowCanvasIcon size={14} className="canvas-embed-icon" />
          <span className="canvas-embed-title">{fileName}</span>
        </div>
        <button
          type="button"
          className="canvas-embed-open-btn"
          onClick={() => onOpenNote(canvasPath)}
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
