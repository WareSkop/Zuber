import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps, useReactFlow } from '@xyflow/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Check, Link2 } from 'lucide-react';
import type { CanvasShape } from '../../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../../shared/canvasTypes';
import { api } from '../../../api';
import { escapeHtml } from '../../../utils/readingMode';
import { resolveDecryptedAttachmentUrl } from '../../../crypto/encryptedAttachmentUrl';
import { useCanvasContext } from '../CanvasContext';
import { CanvasNodeHiddenBadge } from './CanvasNodeHiddenBadge';
import { renderShapeSvgElements, isImageFilePath } from './canvasShapeGeometry';
import { useTranslation } from '../../../i18n';

export const CanvasShapeNode: React.FC<NodeProps> = ({ id, data, selected, width, height }) => {
  const { t } = useTranslation();
  const {
    onOpenNote,
    onSelectTag,
    onUpdateNodeData,
    allNotes,
    readOnly,
    editingNodeState,
    setEditingNodeState,
    currentCanvasPath,
  } = useCanvasContext();
  const { setNodes } = useReactFlow();

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState<string>((data.text as string) || '');
  const [showWikiDropdown, setShowWikiDropdown] = useState(false);
  const [wikiQuery, setWikiQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);

  const shape: CanvasShape = (data.shape as CanvasShape) || 'rectangle';
  const customColor = resolveCanvasColor(data.color as string);

  useEffect(() => {
    if (!isEditing) {
      setEditText((data.text as string) || '');
    }
  }, [data.text, isEditing]);

  // Type-to-Edit listener: activates inline editor and appends initial keystroke on selected node
  useEffect(() => {
    if (editingNodeState && editingNodeState.nodeId === id && !readOnly) {
      const char = editingNodeState.initialChar;
      const baseText = (data.text as string) || '';
      const updatedText = baseText + char;
      setEditText(updatedText);
      setIsEditing(true);
      setEditingNodeState?.(null);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const len = updatedText.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  }, [editingNodeState, id, data.text, readOnly, setEditingNodeState]);

  // Focus textarea and set cursor at end whenever isEditing transitions to true
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const handleFinishEditing = () => {
    setIsEditing(false);
    setShowWikiDropdown(false);
    if (onUpdateNodeData) {
      onUpdateNodeData(id, { text: editText });
    } else {
      setNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: editText } } : n))
      );
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setEditText(val);

    // Detect [[ trigger for quick wiki-link completion
    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const lastOpenBrackets = textBeforeCursor.lastIndexOf('[[');
    if (lastOpenBrackets !== -1 && !textBeforeCursor.slice(lastOpenBrackets).includes(']]')) {
      const query = textBeforeCursor.slice(lastOpenBrackets + 2);
      setWikiQuery(query);
      setShowWikiDropdown(true);
    } else {
      setShowWikiDropdown(false);
    }
  };

  const handleSelectWikiNote = (notePath: string, noteTitle: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const textBefore = editText.slice(0, cursor);
    const lastOpen = textBefore.lastIndexOf('[[');
    const textAfter = editText.slice(cursor);

    const insertion = noteTitle;
    const newText = editText.slice(0, lastOpen + 2) + insertion + ']]' + textAfter;
    setEditText(newText);
    setShowWikiDropdown(false);

    // Refocus textarea after inserting
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = lastOpen + 2 + insertion.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  const filteredNotes = useMemo(() => {
    if (!wikiQuery) return allNotes.slice(0, 8);
    const q = wikiQuery.toLowerCase();
    return allNotes
      .filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allNotes, wikiQuery]);

  // Render markdown for display mode
  const renderedHtml = useMemo(() => {
    const rawText = (data.text as string) || '';
    if (!rawText.trim()) return '';

    // 1. Transform ![[ImageEmbed]] before [[Wiki-Links]]
    let processed = rawText.replace(
      /!\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_, target, alt) => {
        const cleanTarget = (target || '').trim();
        const altVal = (alt || '').trim();
        if (isImageFilePath(cleanTarget)) {
          const src = escapeHtml(api.getAttachmentUrl(cleanTarget, currentCanvasPath || ''));
          const styleAttr = /^\d+$/.test(altVal) ? ` style="max-width:${altVal}px"` : '';
          const altAttr = escapeHtml(altVal && !/^\d+$/.test(altVal) ? altVal : cleanTarget.split('/').pop() || cleanTarget);
          return `<img src="${src}" alt="${altAttr}" class="canvas-shape-inline-image" loading="lazy"${styleAttr} />`;
        }
        const displayLabel = escapeHtml(altVal || cleanTarget);
        return `<a href="#" class="cm-wikilink-widget canvas-wikilink nodrag" data-wiki-target="${encodeURIComponent(
          cleanTarget
        )}" title="${t('canvas.openNoteTooltip', { target: cleanTarget })}">${displayLabel}</a>`;
      }
    );

    // 2. Transform [[Wiki-Links]] (negative lookbehind so ![[...]] is never matched)
    processed = processed.replace(
      /(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_, target, alias) => {
        const cleanTarget = (target || '').trim();
        const displayLabel = (alias || target || '').trim();
        return `<a href="#" class="cm-wikilink-widget canvas-wikilink nodrag" data-wiki-target="${encodeURIComponent(
          cleanTarget
        )}" title="${t('canvas.openNoteTooltip', { target: cleanTarget })}">${displayLabel}</a>`;
      }
    );

    // Transform #tags
    processed = processed.replace(
      /(^|\s)#([a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)\]])/gm,
      '$1<span class="reading-tag canvas-tag nodrag" data-tag="$2">#$2</span>'
    );

    const rawParsed = marked.parse(processed, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(rawParsed, {
      ADD_ATTR: ['data-wiki-target', 'data-tag', 'target', 'href'],
    });
  }, [data.text, currentCanvasPath, t]);

  useEffect(() => {
    const el = displayRef.current;
    if (!el || isEditing || !renderedHtml) return;
    let cancelled = false;
    const revokedUrls: string[] = [];

    el.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src.includes('/api/vault/attachment')) return;
      try {
        const parsed = new URL(src, window.location.origin);
        const targetParam = parsed.searchParams.get('target');
        if (!targetParam) return;
        resolveDecryptedAttachmentUrl(targetParam, currentCanvasPath)
          .then((res) => {
            if (!res) return;
            if (cancelled) {
              if (res.isObjectUrl) URL.revokeObjectURL(res.url);
              return;
            }
            if (res.isObjectUrl) revokedUrls.push(res.url);
            img.src = res.url;
          })
          .catch(() => {});
      } catch {
        // ignore URL parse error
      }
    });

    return () => {
      cancelled = true;
      for (const u of revokedUrls) {
        URL.revokeObjectURL(u);
      }
    };
  }, [renderedHtml, isEditing, currentCanvasPath]);

  const handleDisplayMouseDown = (e: React.MouseEvent) => {
    const targetEl = (e.target as HTMLElement).closest('[data-wiki-target], [data-tag], a');
    if (targetEl) {
      // Prevent React Flow node drag listener from intercepting link clicks
      e.stopPropagation();
    }
  };

  const handleDisplayClick = (e: React.MouseEvent) => {
    const targetEl = (e.target as HTMLElement).closest('[data-wiki-target], [data-tag], a');
    if (targetEl) {
      e.preventDefault();
      e.stopPropagation();
      const wiki = targetEl.getAttribute('data-wiki-target');
      if (wiki) {
        onOpenNote(decodeURIComponent(wiki));
        return;
      }
      const tag = targetEl.getAttribute('data-tag');
      if (tag && onSelectTag) {
        onSelectTag(tag);
        return;
      }
      const href = targetEl.getAttribute('href');
      if (href && href !== '#') {
        onOpenNote(href);
        return;
      }
    }
  };

  // Shape SVG Geometry & Theme adaptation
  const strokeColor = customColor || (selected ? 'var(--accent-color, #d4af37)' : 'var(--border-strong, #64748b)');
  const strokeWidth = selected ? '2.5' : '2';
  const baseFill = 'var(--bg-secondary, #1e293b)';
  const fillColor = customColor
    ? `${customColor}26` // ~15% opacity tint
    : baseFill;

  return (
    <div
      className={`canvas-custom-node canvas-shape-node shape-${shape} ${selected ? 'selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        minWidth: '120px',
        minHeight: '60px',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: shape === 'rectangle' ? 'var(--bg-secondary, #1e293b)' : undefined,
        borderRadius: shape === 'rectangle' ? '6px' : undefined,
      }}
      onDoubleClick={() => !readOnly && setIsEditing(true)}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={80}
        minHeight={50}
        lineClassName="canvas-resizer-line"
        handleClassName="canvas-resizer-handle"
      />
      <CanvasNodeHiddenBadge nodeId={id} />

      {/* 4 Multi-directional handles (Obsidian-compatible top, right, bottom, left) */}
      <Handle type="target" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="source" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="target" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="source" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="target" position={Position.Left} id="left" className="canvas-node-handle handle-left" />
      <Handle type="source" position={Position.Left} id="left" className="canvas-node-handle handle-left" />

      {/* SVG Background Geometry */}
      <svg
        className="canvas-node-svg-bg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {renderShapeSvgElements(shape, baseFill, fillColor, strokeColor, strokeWidth)}
      </svg>

      {/* Content Container */}
      <div
        className="canvas-node-content-wrapper canvas-shape-content"
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '10px 14px',
          boxSizing: 'border-box',
        }}
      >
        {isEditing ? (
          <div className="canvas-editor-input-box" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <textarea
              ref={textareaRef}
              className="canvas-node-textarea nodrag nowheel"
              style={{ textAlign: 'center', width: '100%' }}
              value={editText}
              onChange={handleTextChange}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleFinishEditing();
                } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  handleFinishEditing();
                }
              }}
              onBlur={() => {
                if (!showWikiDropdown) {
                  handleFinishEditing();
                }
              }}
              autoFocus
              placeholder={t('canvas.shapeTextPlaceholder')}
            />
            {/* Quick Note WikiLink autocomplete popup */}
            {showWikiDropdown && filteredNotes.length > 0 && (
              <div className="canvas-wikilink-dropdown nodrag nowheel">
                <div className="canvas-dropdown-header">
                  <Link2 size={12} /> {t('canvas.linkNoteLabel')}
                </div>
                {filteredNotes.map((note) => (
                  <button
                    key={note.path}
                    type="button"
                    className="canvas-dropdown-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectWikiNote(note.path, note.basename || note.name);
                    }}
                  >
                    <span className="dropdown-item-title">{note.basename || note.name}</span>
                    <span className="dropdown-item-path">{note.path}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="canvas-edit-done-btn"
              onClick={handleFinishEditing}
              title={t('canvas.doneShortcut')}
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <div
            ref={displayRef}
            className="canvas-node-display-text canvas-shape-markdown markdown-rendered"
            style={{ width: '100%', textAlign: 'center' }}
            onMouseDown={handleDisplayMouseDown}
            onClick={handleDisplayClick}
            dangerouslySetInnerHTML={{
              __html: renderedHtml || `<span class="canvas-empty-hint">${t('canvas.doubleClickEdit')}</span>`,
            }}
          />
        )}
      </div>
    </div>
  );
};
