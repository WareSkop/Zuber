import React, { useState, useEffect } from 'react';
import '@xyflow/react/dist/style.css';
import { ExternalLink } from 'lucide-react';
import { api } from '../../api';
import { CanvasEditor } from './CanvasEditor';
import { WorkflowCanvasIcon } from './WorkflowCanvasIcon';

export interface CanvasEmbedWidgetProps {
  canvasPath: string;
  onOpenNote: (path: string) => void;
  allNotes?: { path: string; name: string; basename: string }[];
}

export const CanvasEmbedWidget: React.FC<CanvasEmbedWidgetProps> = ({
  canvasPath,
  onOpenNote,
  allNotes = [],
}) => {
  const [content, setContent] = useState<string>('');
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
          setContent(note.rawContent || note.body || '{}');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Canvas-Datei konnte nicht geladen werden (${canvasPath})`);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasPath]);

  const fileName = canvasPath.split('/').pop() || canvasPath;

  return (
    <div className="canvas-embed-container nodrag">
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

      <div className="canvas-embed-body">
        {loading ? (
          <div className="canvas-embed-loading">Lädt Canvas-Vorschau...</div>
        ) : error ? (
          <div className="canvas-embed-error">{error}</div>
        ) : (
          <CanvasEditor
            filePath={canvasPath}
            rawContent={content}
            onChange={() => {}}
            onOpenNote={onOpenNote}
            allNotes={allNotes}
            readOnly={true}
          />
        )}
      </div>
    </div>
  );
};
