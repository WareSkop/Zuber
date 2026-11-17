import React from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { Globe, ExternalLink } from 'lucide-react';
import { resolveCanvasColor } from '../../../../shared/canvasTypes';
import { useCanvasContext } from '../CanvasContext';
import { CanvasNodeHiddenBadge } from './CanvasNodeHiddenBadge';
import { useTranslation } from '../../../i18n';

export const CanvasLinkNode: React.FC<NodeProps> = ({ id, data, selected, width, height }) => {
  const { t } = useTranslation();
  const { readOnly } = useCanvasContext();
  const url = (data.url as string) || '';
  const customColor = resolveCanvasColor(data.color as string);
  const strokeColor = customColor || (selected ? 'var(--accent-color, #7852ee)' : 'var(--border-color, #444)');

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {}

  return (
    <div
      className={`canvas-custom-node canvas-link-node ${selected ? 'selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        borderColor: strokeColor,
      }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={140}
        minHeight={60}
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

      <div className="canvas-link-content">
        <div className="canvas-link-icon">
          <Globe size={18} />
        </div>
        <div className="canvas-link-info">
          <div className="canvas-link-host">{hostname}</div>
          <div className="canvas-link-url" title={url}>
            {url}
          </div>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="canvas-link-btn nodrag"
          title={t('canvas.openInWeb')}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
};
