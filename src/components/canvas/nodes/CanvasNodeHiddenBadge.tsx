import React from 'react';
import { EyeOff } from 'lucide-react';
import { useCanvasContext } from '../CanvasContext';
import { useTranslation } from '../../../i18n';

export const CanvasNodeHiddenBadge: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const {
    readOnly,
    hasSelectedSlide,
    hiddenNodeIdsOnSelectedSlide,
    onToggleNodeHiddenOnSlide,
  } = useCanvasContext();
  const { t } = useTranslation();

  if (readOnly || !hasSelectedSlide || !hiddenNodeIdsOnSelectedSlide?.has(nodeId)) {
    return null;
  }

  return (
    <button
      type="button"
      className="canvas-node-hidden-badge nodrag nopan"
      onClick={(e) => {
        e.stopPropagation();
        onToggleNodeHiddenOnSlide?.(nodeId);
      }}
      title={t('canvas.presentation.hiddenBadgeTooltip')}
      aria-label={t('canvas.presentation.hiddenBadgeTooltip')}
    >
      <EyeOff size={12} />
    </button>
  );
};
