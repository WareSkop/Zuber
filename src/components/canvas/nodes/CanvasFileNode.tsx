import React, { useState, useEffect } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { FileText, Image as ImageIcon, ExternalLink, File } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../../../api';
import { resolveCanvasColor } from '../../../../shared/canvasTypes';
import { useCanvasContext } from '../CanvasContext';
import { CanvasNodeHiddenBadge } from './CanvasNodeHiddenBadge';

export const CanvasFileNode: React.FC<NodeProps> = ({ id, data, selected, width, height }) => {
  const { onOpenNote, readOnly } = useCanvasContext();
  const filePath = (data.file as string) || '';
  const customColor = resolveCanvasColor(data.color as string);

  const [noteContent, setNoteContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const isMarkdown = filePath.toLowerCase().endsWith('.md');
  const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(filePath);
  const fileName = filePath.split('/').pop() || filePath || 'Unbenannte Datei';

  useEffect(() => {
    let cancelled = false;
    if (isMarkdown && filePath) {
      setLoading(true);
      api
        .getNote(filePath)
        .then((note) => {
          if (!cancelled) {
            setNoteContent(note.body || '');
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNoteContent('*Notiz konnte nicht geladen werden.*');
            setLoading(false);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [filePath, isMarkdown]);

  const renderedMarkdown = React.useMemo(() => {
    if (!noteContent) return '';
    // Transform [[Wiki-Links]] in preview
    const processed = noteContent.replace(
      /\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_, target, alias) => {
        const cleanTarget = (target || '').trim();
        const displayLabel = (alias || target || '').trim();
        return `<a href="#" class="cm-wikilink-widget canvas-wikilink nodrag" data-wiki-target="${encodeURIComponent(
          cleanTarget
        )}" title="Notiz öffnen: ${cleanTarget}">${displayLabel}</a>`;
      }
    );
    const raw = marked.parse(processed, { async: false, gfm: true }) as string;
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ['data-wiki-target', 'data-wikilink', 'data-tag', 'target', 'href'],
    });
  }, [noteContent]);

  const handleMarkdownClick = (e: React.MouseEvent) => {
    const targetEl = (e.target as HTMLElement).closest('[data-wiki-target], [data-wikilink], a');
    if (targetEl) {
      e.preventDefault();
      e.stopPropagation();
      const target =
        targetEl.getAttribute('data-wiki-target') ||
        targetEl.getAttribute('data-wikilink') ||
        targetEl.getAttribute('href');
      if (target && target !== '#') {
        onOpenNote(decodeURIComponent(target));
      }
    }
  };

  const strokeColor = customColor || (selected ? 'var(--accent-color, #7852ee)' : 'var(--border-color, #444)');

  return (
    <div
      className={`canvas-custom-node canvas-file-node ${selected ? 'selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        borderColor: strokeColor,
      }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={120}
        minHeight={80}
        lineClassName="canvas-resizer-line"
        handleClassName="canvas-resizer-handle"
      />
      <CanvasNodeHiddenBadge nodeId={id} />

      <Handle type="target" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="source" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="target" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="source" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="target" position={Position.Left} id="left" className="canvas-node-handle handle-left" />
      <Handle type="source" position={Position.Left} id="left" className="canvas-node-handle handle-left" />

      {/* File Header */}
      <div className="canvas-file-header">
        <div className="canvas-file-title-group" title={filePath}>
          {isImage ? <ImageIcon size={14} /> : isMarkdown ? <FileText size={14} /> : <File size={14} />}
          <span className="canvas-file-name">{fileName}</span>
        </div>
        <button
          type="button"
          className="canvas-file-open-btn nodrag"
          onClick={() => onOpenNote(filePath)}
          title="Datei öffnen ↗"
          aria-label="Datei öffnen"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {/* File Body Content */}
      <div className="canvas-file-body nowheel nodrag scroller">
        {isMarkdown ? (
          loading ? (
            <div className="canvas-file-loading">Lädt Notiz...</div>
          ) : (
            <div
              className="canvas-file-markdown markdown-rendered"
              onClick={handleMarkdownClick}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('a, [data-wiki-target], [data-wikilink]')) {
                  e.stopPropagation();
                }
              }}
              dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            />
          )
        ) : isImage ? (
          <div className="canvas-file-image-container">
            <img
              src={`/api/vault/attachment?path=${encodeURIComponent(filePath)}`}
              alt={fileName}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="canvas-file-fallback">
            <File size={32} />
            <p>{filePath}</p>
          </div>
        )}
      </div>
    </div>
  );
};
