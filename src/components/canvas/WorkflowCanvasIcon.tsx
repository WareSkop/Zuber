import React from 'react';

export interface WorkflowCanvasIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Dedicated Mindmap / Workflow icon for Canvas (.canvas) representations.
 * Shows a root rounded rectangle branching to two child workflow nodes.
 */
export const WorkflowCanvasIcon: React.FC<WorkflowCanvasIconProps> = ({
  size = 15,
  className = '',
  style,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {/* Root node on the left */}
      <rect x="3" y="8" width="6" height="8" rx="1.5" />
      {/* Top right child node */}
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      {/* Bottom right child node */}
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      {/* Smooth branching workflow connectors */}
      <path d="M9 12c3 0 3-6 6-6" />
      <path d="M9 12c3 0 3 6 6 6" />
    </svg>
  );
};
