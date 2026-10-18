import React, { useState, useEffect } from 'react';
import { Handle, Position, NodeResizer, type NodeProps, useReactFlow } from '@xyflow/react';
import { resolveCanvasColor } from '../../../../shared/canvasTypes';
import { useCanvasContext } from '../CanvasContext';

export const CanvasGroupNode: React.FC<NodeProps> = ({ id, data, selected, width, height }) => {
  const { onUpdateNodeData, readOnly } = useCanvasContext();
  const { setNodes } = useReactFlow();

  const [label, setLabel] = useState<string>((data.label as string) || '');
  const [isEditingLabel, setIsEditingLabel] = useState(false);

  useEffect(() => {
    setLabel((data.label as string) || '');
  }, [data.label]);

  const handleFinishLabel = () => {
    setIsEditingLabel(false);
    if (onUpdateNodeData) {
      onUpdateNodeData(id, { label });
    } else {
      setNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n))
      );
    }
  };

  const customColor = resolveCanvasColor(data.color as string);
  const strokeColor = customColor || (selected ? 'var(--accent-color, #7852ee)' : 'var(--border-color, #444)');
  const fillColor = customColor ? `${customColor}0d` : 'rgba(255, 255, 255, 0.02)';

  return (
    <div
      className={`canvas-custom-node canvas-group-node ${selected ? 'selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        borderColor: strokeColor,
        backgroundColor: fillColor,
      }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={150}
        minHeight={100}
        lineClassName="canvas-resizer-line"
        handleClassName="canvas-resizer-handle"
      />

      <Handle type="target" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="source" position={Position.Top} id="top" className="canvas-node-handle handle-top" />
      <Handle type="target" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="source" position={Position.Right} id="right" className="canvas-node-handle handle-right" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="canvas-node-handle handle-bottom" />
      <Handle type="target" position={Position.Left} id="left" className="canvas-node-handle handle-left" />
      <Handle type="source" position={Position.Left} id="left" className="canvas-node-handle handle-left" />

      {/* Group Header Label */}
      <div className="canvas-group-header nodrag">
        {isEditingLabel ? (
          <input
            type="text"
            className="canvas-group-title-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') handleFinishLabel();
            }}
            onBlur={handleFinishLabel}
            autoFocus
            placeholder="Gruppenname..."
          />
        ) : (
          <span
            className="canvas-group-title"
            onDoubleClick={() => !readOnly && setIsEditingLabel(true)}
            title="Doppelklick zum Umbenennen"
          >
            {label || <span className="canvas-empty-hint">Gruppe (Doppelklick)</span>}
          </span>
        )}
      </div>
    </div>
  );
};
