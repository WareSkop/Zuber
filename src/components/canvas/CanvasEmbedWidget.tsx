import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { CanvasContext, useCanvasContext, isCanvasAncestorCycle, normalizeCanvasCyclePath } from './CanvasContext';
import { CanvasShapeNode } from './nodes/CanvasShapeNode';
import { CanvasFileNode } from './nodes/CanvasFileNode';
import { CanvasGroupNode } from './nodes/CanvasGroupNode';
import { CanvasLinkNode } from './nodes/CanvasLinkNode';
import { parseCanvasJson, jsonCanvasToReactFlow } from './canvasMapper';
import { useTranslation } from '../../i18n';

export interface CanvasEmbedWidgetProps {
  canvasPath: string;
  onOpenNote: (path: string) => void;
  allNotes?: any[];
  currentNotePath?: string;
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
  currentNotePath,
  height,
  fullSize = false,
}) => {
  const { t } = useTranslation();
  const parentCanvasCtx = useCanvasContext();
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

    // Check same folder as current note if provided
    if (currentNotePath && currentNotePath.includes('/')) {
      const folder = currentNotePath.substring(0, currentNotePath.lastIndexOf('/')).toLowerCase();
      const targetInFolder = `${folder}/${lowerWithCanvas}`;
      const sameFolderMatch = pool.find((n: any) => (n.path || '').toLowerCase() === targetInFolder);
      if (sameFolderMatch) {
        return sameFolderMatch.path;
      }
    }

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

    return foundNote ? foundNote.path : (canvasPath.toLowerCase().endsWith('.canvas') ? canvasPath : `${canvasPath}.canvas`);
  }, [canvasPath, currentNotePath, internalNotes, allNotes]);

  const effectiveHeight = useMemo(() => {
    if (fullSize) return undefined;
    if (!height) return 380;
    const str = String(height).trim().replace(/px$/i, '');
    const parsed = parseInt(str, 10);
    return !isNaN(parsed) && parsed > 50 ? parsed : 380;
  }, [height, fullSize]);

  const parsedContainerHeight = useMemo(() => {
    if (fullSize) return '100%';
    return `${effectiveHeight}px`;
  }, [fullSize, effectiveHeight]);

  const parsedViewportHeight = useMemo(() => {
    return 'calc(100% - 38px)';
  }, []);

  const ancestorChain = useMemo(() => {
    const rawList = [
      ...(parentCanvasCtx.ancestorPaths || []),
      ...(currentNotePath ? [currentNotePath] : []),
    ];
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of rawList) {
      const norm = normalizeCanvasCyclePath(item);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        unique.push(item);
      }
    }
    return unique;
  }, [parentCanvasCtx.ancestorPaths, currentNotePath]);

  const isCircularEmbed = useMemo(
    () => isCanvasAncestorCycle(resolvedFullPath, ancestorChain),
    [resolvedFullPath, ancestorChain]
  );

  const nextAncestorPaths = useMemo(() => {
    const normResolved = normalizeCanvasCyclePath(resolvedFullPath);
    if (!normResolved || ancestorChain.some((a) => normalizeCanvasCyclePath(a) === normResolved)) {
      return ancestorChain;
    }
    return [...ancestorChain, resolvedFullPath];
  }, [ancestorChain, resolvedFullPath]);

  useEffect(() => {
    if (isCircularEmbed) {
      setLoading(false);
      setError(null);
      return;
    }

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
  }, [resolvedFullPath, canvasPath, isCircularEmbed]);

  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (fitTimerRef.current) {
        clearTimeout(fitTimerRef.current);
        fitTimerRef.current = null;
      }
    };
  }, []);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    // Center after short delay once DOM layout settles
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      fitTimerRef.current = null;
      if (typeof window !== 'undefined') {
        instance.fitView({ padding: 0.25, duration: 250 });
      }
    }, 60);
  }, []);

  const fileName = resolvedFullPath.split('/').pop() || resolvedFullPath;

  return (
    <div
      className={`canvas-embed-container canvas-embed-widget embedded-canvas-container cm-lp-canvas-embed nodrag ${fullSize ? 'full-size' : ''}`}
      style={{
        width: '100%',
        height: parsedContainerHeight,
        minHeight: fullSize ? '400px' : `${effectiveHeight}px`,
      }}
    >
      <div className="canvas-embed-header">
        <div
          className="canvas-embed-title-cluster"
          onClick={() => onOpenNote(resolvedFullPath)}
          title={t('canvas.openNoteTooltip', { target: resolvedFullPath })}
          style={{ cursor: 'pointer' }}
        >
          <WorkflowCanvasIcon size={14} className="canvas-embed-icon" />
          <span
            className="canvas-embed-title clickable"
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(resolvedFullPath);
            }}
            title={t('canvas.openNoteTooltip', { target: resolvedFullPath })}
            style={{ cursor: 'pointer' }}
          >
            {fileName}
          </span>
        </div>
        <button
          type="button"
          className="canvas-embed-open-btn"
          onClick={() => onOpenNote(resolvedFullPath)}
          title={`${t('canvas.openInEditor')} ↗`}
          aria-label={t('canvas.openInEditor')}
        >
          <span>{t('canvas.openInEditor')}</span>
          <ExternalLink size={13} />
        </button>
      </div>

      <div
        className="canvas-embed-body canvas-embed-viewport"
        style={{
          width: '100%',
          height: parsedViewportHeight,
          minHeight: fullSize ? '360px' : `${Math.max(100, (effectiveHeight ?? 380) - 38)}px`,
          position: 'relative',
        }}
      >
        {isCircularEmbed ? (
          <div className="canvas-embed-error canvas-embed-cycle-guard">
            {t('canvas.circularEmbedNotice', { target: fileName })}
          </div>
        ) : loading ? (
          <div className="canvas-embed-loading">{t('canvas.loadingPreview')}</div>
        ) : error ? (
          <div className="canvas-embed-error">{error}</div>
        ) : (
          <CanvasContext.Provider
            value={{
              onOpenNote,
              allNotes,
              readOnly: true,
              currentCanvasPath: resolvedFullPath,
              ancestorPaths: nextAncestorPaths,
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
