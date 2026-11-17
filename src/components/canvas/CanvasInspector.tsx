import React, { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
  Trash2,
  Copy,
  Link2,
  Palette,
  ArrowRight,
  ArrowLeft,
  Spline,
  GitCommit,
  CornerDownRight,
  Square,
  Eye,
  EyeOff,
  Check,
  X,
} from 'lucide-react';
import type { CanvasShape, CanvasEdgeStyle } from '../../../shared/canvasTypes';
import { OBSIDIAN_CANVAS_COLORS } from '../../../shared/canvasTypes';
import { isImageFilePath, renderShapeMiniIcon } from './nodes/canvasShapeGeometry';
import { useTranslation } from '../../i18n';

interface CanvasInspectorProps {
  selectedNode: Node | null;
  selectedEdge: Edge | null;
  contextMenuPos?: { x: number; y: number } | null;
  onUpdateNodeData: (nodeId: string, partialData: Record<string, any>) => void;
  onUpdateEdgeData: (edgeId: string, partialData: Record<string, any>, label?: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  allNotes: { path: string; name: string; basename: string }[];
  hasSelectedSlide?: boolean;
  isSelectedNodeHiddenOnSlide?: boolean;
  onToggleSelectedNodesHiddenOnSlide?: () => void;
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  selectedNode,
  selectedEdge,
  contextMenuPos,
  onUpdateNodeData,
  onUpdateEdgeData,
  onDuplicateNode,
  onDeleteNode,
  onDeleteEdge,
  allNotes,
  hasSelectedSlide = false,
  isSelectedNodeHiddenOnSlide = false,
  onToggleSelectedNodesHiddenOnSlide,
}) => {
  const { t } = useTranslation();
  const inspectorRef = React.useRef<HTMLDivElement>(null);
  const [edgeLabel, setEdgeLabel] = useState('');
  const [activePopover, setActivePopover] = useState<'shape' | 'color' | 'link' | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [externalLinkInput, setExternalLinkInput] = useState('');
  const [posStyle, setPosStyle] = useState<React.CSSProperties | undefined>(undefined);

  React.useLayoutEffect(() => {
    if (!contextMenuPos) {
      setPosStyle(undefined);
      return;
    }

    const inspectorEl = inspectorRef.current;
    const inspectorWidth = inspectorEl?.offsetWidth || 320;
    const inspectorHeight = inspectorEl?.offsetHeight || 44;

    const rawX = contextMenuPos.x + 8;
    const rawY = contextMenuPos.y + 8;

    const clampedX = Math.max(12, Math.min(rawX, window.innerWidth - inspectorWidth - 16));
    const clampedY = Math.max(12, Math.min(rawY, window.innerHeight - inspectorHeight - 16));

    setPosStyle({
      position: 'fixed',
      left: `${clampedX}px`,
      top: `${clampedY}px`,
      bottom: 'auto',
      right: 'auto',
      margin: 0,
      transform: 'none',
      zIndex: 100,
    });
  }, [contextMenuPos]);

  useEffect(() => {
    if (selectedEdge) {
      setEdgeLabel((selectedEdge.label as string) || '');
    }
  }, [selectedEdge]);

  useEffect(() => {
    setActivePopover(null);
    const existing = typeof selectedNode?.data?.linkUrl === 'string' ? selectedNode.data.linkUrl : '';
    setExternalLinkInput(existing);
  }, [selectedNode?.id, selectedNode?.data?.linkUrl, selectedEdge?.id]);

  const popoverRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activePopover || !popoverRef.current) return;
    const el = popoverRef.current;
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';

    const clampPopover = () => {
      if (!popoverRef.current) return;
      const target = popoverRef.current;
      const rect = target.getBoundingClientRect();
      const minLeft = 8;
      const maxRight = window.innerWidth - 8;

      // Vertical flip if inspector is near the top of the viewport
      if (rect.top < 10 || (inspectorRef.current && inspectorRef.current.getBoundingClientRect().top < 220)) {
        target.style.bottom = 'auto';
        target.style.top = 'calc(100% + 10px)';
      } else {
        target.style.bottom = 'calc(100% + 10px)';
        target.style.top = 'auto';
      }

      // Horizontal boundary clamping
      if (rect.right > maxRight) {
        const overflow = rect.right - maxRight;
        target.style.transform = `translateX(calc(-50% - ${overflow}px))`;
      } else if (rect.left < minLeft) {
        const underflow = minLeft - rect.left;
        target.style.transform = `translateX(calc(-50% + ${underflow}px))`;
      }
    };

    clampPopover();
    requestAnimationFrame(clampPopover);
  }, [activePopover]);

  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (inspectorRef.current && !inspectorRef.current.contains(e.target as unknown as globalThis.Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, []);

  if (!selectedNode && !selectedEdge) return null;

  // Obsidian colors list: "1" to "6" + null (neutral)
  const colorPresets = [
    { key: '', label: t('canvas.colorDefault'), hex: 'var(--border-color, #555)' },
    { key: '1', label: t('canvas.colorRed'), hex: OBSIDIAN_CANVAS_COLORS['1'].hex },
    { key: '2', label: t('canvas.colorOrange'), hex: OBSIDIAN_CANVAS_COLORS['2'].hex },
    { key: '3', label: t('canvas.colorYellow'), hex: OBSIDIAN_CANVAS_COLORS['3'].hex },
    { key: '4', label: t('canvas.colorGreen'), hex: OBSIDIAN_CANVAS_COLORS['4'].hex },
    { key: '5', label: t('canvas.colorCyan'), hex: OBSIDIAN_CANVAS_COLORS['5'].hex },
    { key: '6', label: t('canvas.colorPurple'), hex: OBSIDIAN_CANVAS_COLORS['6'].hex },
  ];

  const shapesList: { shape: CanvasShape; label: string; icon: React.ReactNode }[] = [
    { shape: 'rectangle', label: t('canvas.shapeProcess'), icon: renderShapeMiniIcon('rectangle', 20) },
    { shape: 'rounded', label: t('canvas.shapeStartEnd'), icon: renderShapeMiniIcon('rounded', 20) },
    { shape: 'circle', label: t('canvas.shapeTerminal'), icon: renderShapeMiniIcon('circle', 20) },
    { shape: 'diamond', label: t('canvas.shapeDecision'), icon: renderShapeMiniIcon('diamond', 20) },
    { shape: 'parallelogram', label: t('canvas.shapeIo'), icon: renderShapeMiniIcon('parallelogram', 20) },
    { shape: 'hexagon', label: t('canvas.shapeConditionFilter'), icon: renderShapeMiniIcon('hexagon', 20) },
    { shape: 'cylinder', label: t('canvas.shapeDatabase'), icon: renderShapeMiniIcon('cylinder', 20) },
    { shape: 'cloud', label: t('canvas.shapeCloud'), icon: renderShapeMiniIcon('cloud', 20) },
    { shape: 'server', label: t('canvas.shapeServer'), icon: renderShapeMiniIcon('server', 20) },
    { shape: 'router', label: t('canvas.shapeRouter'), icon: renderShapeMiniIcon('router', 20) },
    { shape: 'workstation', label: t('canvas.shapeWorkstation'), icon: renderShapeMiniIcon('workstation', 20) },
  ];

  return (
    <div ref={inspectorRef} className="canvas-floating-inspector nodrag nowheel" style={posStyle}>
      {/* --- NODE INSPECTOR --- */}
      {selectedNode ? (
        <div className="inspector-content-row">
          {/* Shape Switcher (text/shape nodes and image file nodes) */}
          {(selectedNode.type === 'canvasShape' ||
            (selectedNode.type === 'canvasFile' && isImageFilePath(selectedNode.data?.file as string))) && (
            <div className="inspector-popover-anchor">
              <button
                type="button"
                className={`inspector-tool-btn ${activePopover === 'shape' ? 'active' : ''}`}
                onClick={() => setActivePopover((v) => (v === 'shape' ? null : 'shape'))}
                title={t('canvas.changeShape')}
              >
                <Square size={15} />
                <span className="inspector-btn-label">{t('canvas.shape')}</span>
              </button>
              {activePopover === 'shape' && (
                <div ref={popoverRef} className="inspector-dropdown-menu shapes-grid canvas-shape-picker-popover canvas-inspector-popover">
                  {shapesList.map((s) => (
                    <button
                      key={s.shape}
                      type="button"
                      className={`inspector-grid-item ${selectedNode.data?.shape === s.shape ? 'active' : ''}`}
                      onClick={() => {
                        onUpdateNodeData(selectedNode.id, { shape: s.shape });
                        setActivePopover(null);
                      }}
                      title={s.label}
                      aria-label={s.label}
                    >
                      {s.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Color Picker */}
          <div className="inspector-popover-anchor">
            <button
              type="button"
              className={`inspector-tool-btn ${activePopover === 'color' ? 'active' : ''}`}
              onClick={() => setActivePopover((v) => (v === 'color' ? null : 'color'))}
              title={t('canvas.changeColor')}
            >
              <Palette size={15} />
              <span className="inspector-btn-label">{t('canvas.color')}</span>
            </button>
            {activePopover === 'color' && (
              <div ref={popoverRef} className="inspector-dropdown-menu colors-row canvas-inspector-popover">
                {colorPresets.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`inspector-color-dot ${selectedNode.data?.color === (c.key || undefined) ? 'active' : ''}`}
                    style={{ backgroundColor: c.hex }}
                    onClick={() => {
                      onUpdateNodeData(selectedNode.id, { color: c.key || undefined });
                      setActivePopover(null);
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Insert WikiLink (text/shape nodes) or Set Clickable Link (file/image nodes) */}
          {(selectedNode.type === 'canvasShape' || selectedNode.type === 'canvasFile') && (
            <div className="inspector-popover-anchor">
              <button
                type="button"
                className={`inspector-tool-btn ${
                  activePopover === 'link' || (selectedNode.type === 'canvasFile' && Boolean(selectedNode.data?.linkUrl))
                    ? 'active'
                    : ''
                }`}
                onClick={() => setActivePopover((v) => (v === 'link' ? null : 'link'))}
                title={selectedNode.type === 'canvasFile' ? t('canvas.setNodeLink') : t('canvas.insertWikiLink')}
              >
                <Link2 size={15} />
                <span className="inspector-btn-label">Link</span>
              </button>
              {activePopover === 'link' && (
                <div ref={popoverRef} className="inspector-dropdown-menu link-picker scroller canvas-inspector-popover">
                  {selectedNode.type === 'canvasFile' && (
                    <div className="inspector-external-link-row">
                      <input
                        type="url"
                        placeholder={t('canvas.externalUrlPlaceholder')}
                        className="inspector-link-search"
                        value={externalLinkInput}
                        onChange={(e) => setExternalLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const trimmed = externalLinkInput.trim();
                            onUpdateNodeData(selectedNode.id, { linkUrl: trimmed || undefined });
                            setActivePopover(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="inspector-link-apply-btn"
                        title={t('canvas.applyLink')}
                        onClick={() => {
                          const trimmed = externalLinkInput.trim();
                          onUpdateNodeData(selectedNode.id, { linkUrl: trimmed || undefined });
                          setActivePopover(null);
                        }}
                      >
                        <Check size={13} />
                      </button>
                      {Boolean(selectedNode.data?.linkUrl) && (
                        <button
                          type="button"
                          className="inspector-link-clear-btn"
                          title={t('canvas.removeLink')}
                          onClick={() => {
                            onUpdateNodeData(selectedNode.id, { linkUrl: undefined });
                            setExternalLinkInput('');
                            setActivePopover(null);
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  <input
                    type="text"
                    autoFocus={selectedNode.type === 'canvasShape'}
                    placeholder={t('canvas.selectNotePlaceholder')}
                    className="inspector-link-search"
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                  />
                  {allNotes
                    .filter((n) => !linkSearch || n.name.toLowerCase().includes(linkSearch.toLowerCase()))
                    .slice(0, 8)
                    .map((n) => (
                      <button
                        key={n.path}
                        type="button"
                        className={`inspector-link-item ${
                          selectedNode.type === 'canvasFile' && selectedNode.data?.linkUrl === n.path ? 'active' : ''
                        }`}
                        onClick={() => {
                          if (selectedNode.type === 'canvasFile') {
                            onUpdateNodeData(selectedNode.id, { linkUrl: n.path });
                          } else {
                            const currentText = (selectedNode.data?.text as string) || '';
                            const append = ` [[${n.basename || n.name}]]`;
                            onUpdateNodeData(selectedNode.id, {
                              text: currentText ? `${currentText}${append}` : `[[${n.basename || n.name}]]`,
                            });
                          }
                          setActivePopover(null);
                        }}
                      >
                        {n.basename || n.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="inspector-separator" />

          {hasSelectedSlide && onToggleSelectedNodesHiddenOnSlide && (
            <button
              type="button"
              className={`inspector-tool-btn icon-only ${isSelectedNodeHiddenOnSlide ? 'active' : ''}`}
              onClick={onToggleSelectedNodesHiddenOnSlide}
              title={
                isSelectedNodeHiddenOnSlide
                  ? t('canvas.presentation.showOnSlide')
                  : t('canvas.presentation.hideOnSlide')
              }
              aria-label={
                isSelectedNodeHiddenOnSlide
                  ? t('canvas.presentation.showOnSlide')
                  : t('canvas.presentation.hideOnSlide')
              }
            >
              {isSelectedNodeHiddenOnSlide ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          )}

          {/* Duplicate Node */}
          <button
            type="button"
            className="inspector-tool-btn icon-only"
            onClick={() => onDuplicateNode(selectedNode.id)}
            title={t('canvas.duplicateNode')}
          >
            <Copy size={15} />
          </button>

          {/* Delete Node */}
          <button
            type="button"
            className="inspector-tool-btn danger icon-only"
            onClick={() => onDeleteNode(selectedNode.id)}
            title={t('canvas.deleteNode')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ) : selectedEdge ? (
        <div className="inspector-content-row">
          {/* Edge Label Input */}
          <div className="inspector-input-group">
            <input
              type="text"
              className="inspector-edge-input"
              value={edgeLabel}
              placeholder={t('canvas.edgeLabel')}
              onChange={(e) => {
                setEdgeLabel(e.target.value);
                onUpdateEdgeData(selectedEdge.id, {}, e.target.value);
              }}
            />
          </div>

          {/* Edge Style (Bezier / Straight / Step) */}
          <div className="inspector-btn-toggle-group">
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.edgeStyle === 'bezier' || !selectedEdge.data?.edgeStyle ? 'active' : ''}`}
              onClick={() => onUpdateEdgeData(selectedEdge.id, { edgeStyle: 'bezier' }, edgeLabel)}
              title={t('canvas.edgeSmooth')}
            >
              <Spline size={14} />
            </button>
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.edgeStyle === 'straight' ? 'active' : ''}`}
              onClick={() => onUpdateEdgeData(selectedEdge.id, { edgeStyle: 'straight' }, edgeLabel)}
              title={t('canvas.edgeStraight')}
            >
              <GitCommit size={14} />
            </button>
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.edgeStyle === 'step' ? 'active' : ''}`}
              onClick={() => onUpdateEdgeData(selectedEdge.id, { edgeStyle: 'step' }, edgeLabel)}
              title={t('canvas.edgeStep')}
            >
              <CornerDownRight size={14} />
            </button>
          </div>

          {/* Arrow Head Controls */}
          <div className="inspector-btn-toggle-group">
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.fromEnd === 'arrow' ? 'active' : ''}`}
              onClick={() => {
                const nextFrom = selectedEdge.data?.fromEnd === 'arrow' ? 'none' : 'arrow';
                onUpdateEdgeData(selectedEdge.id, { fromEnd: nextFrom }, edgeLabel);
              }}
              title={t('canvas.toggleArrowStart')}
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.toEnd !== 'none' ? 'active' : ''}`}
              onClick={() => {
                const nextTo = selectedEdge.data?.toEnd === 'none' ? 'arrow' : 'none';
                onUpdateEdgeData(selectedEdge.id, { toEnd: nextTo }, edgeLabel);
              }}
              title={t('canvas.toggleArrowEnd')}
            >
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Color Picker for Edge */}
          <div className="inspector-popover-anchor">
            <button
              type="button"
              className={`inspector-tool-btn icon-only ${activePopover === 'color' ? 'active' : ''}`}
              onClick={() => setActivePopover((v) => (v === 'color' ? null : 'color'))}
              title={t('canvas.edgeColor')}
            >
              <Palette size={15} />
            </button>
            {activePopover === 'color' && (
              <div ref={popoverRef} className="inspector-dropdown-menu colors-row canvas-inspector-popover">
                {colorPresets.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`inspector-color-dot ${selectedEdge.data?.color === (c.key || undefined) ? 'active' : ''}`}
                    style={{ backgroundColor: c.hex }}
                    onClick={() => {
                      onUpdateEdgeData(selectedEdge.id, { color: c.key || undefined }, edgeLabel);
                      setActivePopover(null);
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="inspector-separator" />

          {/* Delete Edge */}
          <button
            type="button"
            className="inspector-tool-btn danger icon-only"
            onClick={() => onDeleteEdge(selectedEdge.id)}
            title={t('canvas.deleteEdge')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
