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
  Circle,
  Diamond,
  Database,
  Server,
  Network,
  Cloud,
  Monitor,
} from 'lucide-react';
import type { CanvasShape, CanvasEdgeStyle } from '../../../shared/canvasTypes';
import { OBSIDIAN_CANVAS_COLORS } from '../../../shared/canvasTypes';

interface CanvasInspectorProps {
  selectedNode: Node | null;
  selectedEdge: Edge | null;
  onUpdateNodeData: (nodeId: string, partialData: Record<string, any>) => void;
  onUpdateEdgeData: (edgeId: string, partialData: Record<string, any>, label?: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  allNotes: { path: string; name: string; basename: string }[];
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  selectedNode,
  selectedEdge,
  onUpdateNodeData,
  onUpdateEdgeData,
  onDuplicateNode,
  onDeleteNode,
  onDeleteEdge,
  allNotes,
}) => {
  const [edgeLabel, setEdgeLabel] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  useEffect(() => {
    if (selectedEdge) {
      setEdgeLabel((selectedEdge.label as string) || '');
    }
  }, [selectedEdge]);

  if (!selectedNode && !selectedEdge) return null;

  // Obsidian colors list: "1" to "6" + null (neutral)
  const colorPresets = [
    { key: '', label: 'Standard', hex: 'var(--border-color, #555)' },
    { key: '1', label: 'Rot', hex: OBSIDIAN_CANVAS_COLORS['1'].hex },
    { key: '2', label: 'Orange', hex: OBSIDIAN_CANVAS_COLORS['2'].hex },
    { key: '3', label: 'Gelb', hex: OBSIDIAN_CANVAS_COLORS['3'].hex },
    { key: '4', label: 'Grün', hex: OBSIDIAN_CANVAS_COLORS['4'].hex },
    { key: '5', label: 'Cyan', hex: OBSIDIAN_CANVAS_COLORS['5'].hex },
    { key: '6', label: 'Violett', hex: OBSIDIAN_CANVAS_COLORS['6'].hex },
  ];

  const shapesList: { shape: CanvasShape; label: string; icon: React.ReactNode }[] = [
    { shape: 'rectangle', label: 'Rechteck', icon: <Square size={14} /> },
    { shape: 'rounded', label: 'Abgerundet', icon: <div className="palette-icon-rounded mini" /> },
    { shape: 'circle', label: 'Kreis', icon: <Circle size={14} /> },
    { shape: 'diamond', label: 'Raute', icon: <Diamond size={14} /> },
    { shape: 'parallelogram', label: 'Parallelogramm', icon: <div className="palette-icon-parallel mini" /> },
    { shape: 'hexagon', label: 'Hexagon', icon: <div className="palette-icon-hexagon mini" /> },
    { shape: 'cylinder', label: 'Datenbank', icon: <Database size={14} /> },
    { shape: 'cloud', label: 'Cloud', icon: <Cloud size={14} /> },
    { shape: 'server', label: 'Server', icon: <Server size={14} /> },
    { shape: 'router', label: 'Router', icon: <Network size={14} /> },
    { shape: 'workstation', label: 'Client', icon: <Monitor size={14} /> },
  ];

  return (
    <div className="canvas-floating-inspector nodrag nowheel">
      {/* --- NODE INSPECTOR --- */}
      {selectedNode && (
        <div className="inspector-content-row">
          {/* Shape Switcher (only for text/shape nodes) */}
          {selectedNode.type === 'canvasShape' && (
            <div className="inspector-popover-anchor">
              <button
                type="button"
                className="inspector-tool-btn"
                onClick={() => setShowShapePicker((v) => !v)}
                title="Form ändern"
              >
                <Square size={15} />
                <span className="inspector-btn-label">Form</span>
              </button>
              {showShapePicker && (
                <div className="inspector-dropdown-menu shapes-grid">
                  {shapesList.map((s) => (
                    <button
                      key={s.shape}
                      type="button"
                      className={`inspector-grid-item ${selectedNode.data?.shape === s.shape ? 'active' : ''}`}
                      onClick={() => {
                        onUpdateNodeData(selectedNode.id, { shape: s.shape });
                        setShowShapePicker(false);
                      }}
                      title={s.label}
                    >
                      {s.icon}
                      <span>{s.label}</span>
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
              className="inspector-tool-btn"
              onClick={() => setShowColorPicker((v) => !v)}
              title="Farbe ändern"
            >
              <Palette size={15} />
              <span className="inspector-btn-label">Farbe</span>
            </button>
            {showColorPicker && (
              <div className="inspector-dropdown-menu colors-row">
                {colorPresets.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="inspector-color-dot"
                    style={{ backgroundColor: c.hex }}
                    onClick={() => {
                      onUpdateNodeData(selectedNode.id, { color: c.key || undefined });
                      setShowColorPicker(false);
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Insert WikiLink */}
          {selectedNode.type === 'canvasShape' && (
            <div className="inspector-popover-anchor">
              <button
                type="button"
                className="inspector-tool-btn"
                onClick={() => setShowLinkPicker((v) => !v)}
                title="[[Wiki-Link]] einfügen"
              >
                <Link2 size={15} />
                <span className="inspector-btn-label">Link</span>
              </button>
              {showLinkPicker && (
                <div className="inspector-dropdown-menu link-picker scroller">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Notiz wählen..."
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
                        className="inspector-link-item"
                        onClick={() => {
                          const currentText = (selectedNode.data?.text as string) || '';
                          const append = ` [[${n.basename || n.name}]]`;
                          onUpdateNodeData(selectedNode.id, { text: currentText ? `${currentText}${append}` : `[[${n.basename || n.name}]]` });
                          setShowLinkPicker(false);
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

          {/* Duplicate Node */}
          <button
            type="button"
            className="inspector-tool-btn"
            onClick={() => onDuplicateNode(selectedNode.id)}
            title="Knoten duplizieren"
          >
            <Copy size={15} />
          </button>

          {/* Delete Node */}
          <button
            type="button"
            className="inspector-tool-btn danger"
            onClick={() => onDeleteNode(selectedNode.id)}
            title="Knoten löschen (Entf)"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}

      {/* --- EDGE INSPECTOR --- */}
      {selectedEdge && (
        <div className="inspector-content-row">
          {/* Edge Label Input */}
          <div className="inspector-input-group">
            <input
              type="text"
              className="inspector-edge-input"
              value={edgeLabel}
              placeholder="Kanten-Beschriftung..."
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
              title="Geschwungen (Bezier)"
            >
              <Spline size={14} />
            </button>
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.edgeStyle === 'straight' ? 'active' : ''}`}
              onClick={() => onUpdateEdgeData(selectedEdge.id, { edgeStyle: 'straight' }, edgeLabel)}
              title="Gerade (Straight)"
            >
              <GitCommit size={14} />
            </button>
            <button
              type="button"
              className={`inspector-toggle-btn ${selectedEdge.data?.edgeStyle === 'step' ? 'active' : ''}`}
              onClick={() => onUpdateEdgeData(selectedEdge.id, { edgeStyle: 'step' }, edgeLabel)}
              title="Orthogonal / Eckig (Step)"
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
              title="Pfeil am Anfang umschalten"
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
              title="Pfeil am Ende umschalten"
            >
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Color Picker for Edge */}
          <div className="inspector-popover-anchor">
            <button
              type="button"
              className="inspector-tool-btn"
              onClick={() => setShowColorPicker((v) => !v)}
              title="Kantenfarbe"
            >
              <Palette size={15} />
            </button>
            {showColorPicker && (
              <div className="inspector-dropdown-menu colors-row">
                {colorPresets.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="inspector-color-dot"
                    style={{ backgroundColor: c.hex }}
                    onClick={() => {
                      onUpdateEdgeData(selectedEdge.id, { color: c.key || undefined }, edgeLabel);
                      setShowColorPicker(false);
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
            className="inspector-tool-btn danger"
            onClick={() => onDeleteEdge(selectedEdge.id)}
            title="Verbindung löschen (Entf)"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
};
