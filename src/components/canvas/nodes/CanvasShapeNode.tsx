import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps, useReactFlow } from '@xyflow/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Edit3, Check, Link2 } from 'lucide-react';
import type { CanvasShape } from '../../../../shared/canvasTypes';
import { resolveCanvasColor } from '../../../../shared/canvasTypes';
import { useCanvasContext } from '../CanvasContext';

export const CanvasShapeNode: React.FC<NodeProps> = ({ id, data, selected, width, height }) => {
  const { onOpenNote, onSelectTag, onUpdateNodeData, allNotes, readOnly } = useCanvasContext();
  const { setNodes } = useReactFlow();

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState<string>((data.text as string) || '');
  const [showWikiDropdown, setShowWikiDropdown] = useState(false);
  const [wikiQuery, setWikiQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const shape: CanvasShape = (data.shape as CanvasShape) || 'rectangle';
  const customColor = resolveCanvasColor(data.color as string);

  useEffect(() => {
    setEditText((data.text as string) || '');
  }, [data.text]);

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

    // Transform [[Wiki-Links]]
    let processed = rawText.replace(
      /\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_, target, alias) => {
        const cleanTarget = (target || '').trim();
        const displayLabel = (alias || target || '').trim();
        return `<span class="cm-lp-wikilink canvas-wikilink" data-wiki-target="${encodeURIComponent(
          cleanTarget
        )}" title="Notiz öffnen: ${cleanTarget}">${displayLabel}</span>`;
      }
    );

    // Transform #tags
    processed = processed.replace(
      /(^|\s)#([a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)\]])/gm,
      '$1<span class="reading-tag" data-tag="$2">#$2</span>'
    );

    const rawParsed = marked.parse(processed, { async: false, gfm: true }) as string;
    return DOMPurify.sanitize(rawParsed, {
      ADD_ATTR: ['data-wiki-target', 'data-tag', 'target'],
    });
  }, [data.text]);

  const handleDisplayClick = (e: React.MouseEvent) => {
    const targetEl = (e.target as HTMLElement).closest('[data-wiki-target], [data-tag]');
    if (targetEl) {
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
    }
  };

  // Shape SVG Geometry & Theme adaptation
  const strokeColor = customColor || (selected ? 'var(--accent-color, #d4af37)' : 'var(--border-strong, #64748b)');
  const strokeWidth = selected ? '2.5' : '2';
  const fillColor = customColor
    ? `${customColor}26` // ~15% opacity tint
    : 'var(--bg-secondary, #1e293b)';

  const renderShapeSvg = () => {
    switch (shape) {
      case 'rounded':
        return (
          <rect
            x="2"
            y="2"
            width="96"
            height="96"
            rx="24"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'circle':
        return (
          <ellipse
            cx="50"
            cy="50"
            rx="48"
            ry="48"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'diamond':
        return (
          <polygon
            points="50,2 98,50 50,98 2,50"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'parallelogram':
        return (
          <polygon
            points="18,2 98,2 82,98 2,98"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'hexagon':
        return (
          <polygon
            points="18,2 82,2 98,50 82,98 18,98 2,50"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'cylinder':
        return (
          <g>
            <path
              d="M 4,16 L 4,84 A 46,14 0 0,0 96,84 L 96,16"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <path
              d="M 4,46 A 46,13 0 0,0 96,46"
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.2"
              strokeDasharray="4 3"
              opacity="0.65"
            />
            <ellipse
              cx="50"
              cy="16"
              rx="46"
              ry="13"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
          </g>
        );
      case 'cloud':
        return (
          <path
            d="M 22,65 C 10,65 5,52 14,42 C 12,28 26,18 38,24 C 45,12 65,12 72,24 C 84,18 96,28 94,42 C 102,52 96,65 86,65 C 90,78 78,88 66,86 C 58,94 42,94 34,86 C 22,88 12,78 22,65 Z"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'server':
        return (
          <g>
            <rect
              x="3"
              y="3"
              width="94"
              height="94"
              rx="8"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1="4" y1="34" x2="96" y2="34" stroke={strokeColor} strokeWidth="1.2" opacity="0.6" />
            <line x1="4" y1="66" x2="96" y2="66" stroke={strokeColor} strokeWidth="1.2" opacity="0.6" />
            <circle cx="14" cy="18" r="3" fill="#3fb950" />
            <circle cx="24" cy="18" r="3" fill="var(--accent-color, #7852ee)" />
            <circle cx="14" cy="50" r="3" fill="#3fb950" />
            <circle cx="24" cy="50" r="3" fill="var(--accent-color, #7852ee)" />
            <circle cx="14" cy="82" r="3" fill="#3fb950" />
            <circle cx="24" cy="82" r="3" fill="var(--accent-color, #7852ee)" />
          </g>
        );
      case 'router':
        return (
          <g>
            <rect
              x="5"
              y="16"
              width="90"
              height="68"
              rx="12"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <path
              d="M 28,50 L 72,50 M 62,42 L 72,50 L 62,58 M 38,42 L 28,50 L 38,58 M 50,28 L 50,72 M 42,38 L 50,28 L 58,38 M 42,62 L 50,72 L 58,62"
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      case 'workstation':
        return (
          <g>
            <rect
              x="5"
              y="6"
              width="90"
              height="64"
              rx="6"
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line x1="50" y1="70" x2="50" y2="86" stroke={strokeColor} strokeWidth="3" />
            <line x1="32" y1="88" x2="68" y2="88" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" />
          </g>
        );
      case 'rectangle':
      default:
        return (
          <rect
            x="2"
            y="2"
            width="96"
            height="96"
            rx="6"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
    }
  };

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

      {/* 4 Multi-directional handles (Obsidian-compatible top, right, bottom, left) */}
      <Handle type="source" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="target" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="source" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="target" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="source" position={Position.Left} id="left" className="canvas-node-handle handle-left" />
      <Handle type="target" position={Position.Left} id="left" className="canvas-node-handle handle-left" />

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
        {renderShapeSvg()}
      </svg>

      {/* Content Container */}
      <div
        className="canvas-node-content-wrapper"
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10px 14px',
          boxSizing: 'border-box',
        }}
      >
        {isEditing ? (
          <div className="canvas-editor-input-box">
            <textarea
              ref={textareaRef}
              className="canvas-node-textarea nodrag nowheel"
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
              placeholder="Text eingeben (Markdown & [[Wiki-Links]] unterstützt)..."
            />
            {/* Quick Note WikiLink autocomplete popup */}
            {showWikiDropdown && filteredNotes.length > 0 && (
              <div className="canvas-wikilink-dropdown nodrag nowheel">
                <div className="canvas-dropdown-header">
                  <Link2 size={12} /> Notiz verlinken:
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
              title="Fertig (Strg+Enter)"
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <div
            className="canvas-node-display-text markdown-rendered"
            onClick={handleDisplayClick}
            dangerouslySetInnerHTML={{
              __html: renderedHtml || '<span class="canvas-empty-hint">Doppelklick zum Bearbeiten...</span>',
            }}
          />
        )}
      </div>

      {/* Hover edit quick action button */}
      {!isEditing && !readOnly && (
        <button
          type="button"
          className="canvas-quick-edit-btn nodrag"
          onClick={() => setIsEditing(true)}
          title="Text bearbeiten"
          aria-label="Text bearbeiten"
        >
          <Edit3 size={13} />
        </button>
      )}
    </div>
  );
};
