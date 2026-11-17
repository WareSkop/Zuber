import React, { useState } from 'react';
import {
  Play,
  PlayCircle,
  Settings,
  X,
  Plus,
  Camera,
  ChevronUp,
  ChevronDown,
  Trash2,
  SlidersHorizontal,
  EyeOff,
  GripVertical,
} from 'lucide-react';
import type {
  CanvasPresentation,
  CanvasPresentationConfig,
  CanvasPresentationSlide,
  CanvasZoomArc,
} from '../../../shared/canvasTypes';
import { useTranslation } from '../../i18n';

interface CanvasPresentationPanelProps {
  presentation: CanvasPresentation;
  selectedSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onCaptureNewSlide: () => void;
  onUpdateSlideView: (slideId: string) => void;
  onUpdateSlideTitle: (slideId: string, title: string) => void;
  onUpdateSlideOverrides: (
    slideId: string,
    overrides: { zoomDuration?: number; revealDuration?: number }
  ) => void;
  onReorderSlides: (fromIndex: number, toIndex: number) => void;
  onDeleteSlide: (slideId: string) => void;
  onUpdateConfig: (partial: Partial<CanvasPresentationConfig>) => void;
  onStartPresentation: (fromSlideIndex: number) => void;
  onClose: () => void;
}

export const CanvasPresentationPanel: React.FC<CanvasPresentationPanelProps> = ({
  presentation,
  selectedSlideId,
  onSelectSlide,
  onCaptureNewSlide,
  onUpdateSlideView,
  onUpdateSlideTitle,
  onUpdateSlideOverrides,
  onReorderSlides,
  onDeleteSlide,
  onUpdateConfig,
  onStartPresentation,
  onClose,
}) => {
  const { t } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [overrideOpenId, setOverrideOpenId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const { config, slides } = presentation;
  const selectedIndex = slides.findIndex((s) => s.id === selectedSlideId);
  const playFromCurrentIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <aside className="canvas-presentation-panel" aria-label={t('canvas.presentation.panelTitle')}>
      <div className="canvas-pres-panel-header">
        <span className="canvas-pres-panel-title">{t('canvas.presentation.panelTitle')}</span>
        <div className="canvas-pres-header-icons">
          <button
            type="button"
            className={`canvas-pres-icon-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            title={t('canvas.presentation.settingsTitle')}
            aria-label={t('canvas.presentation.settingsTitle')}
          >
            <Settings size={15} />
          </button>
          <button
            type="button"
            className="canvas-pres-icon-btn"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Play Actions */}
      <div className="canvas-pres-play-actions">
        <button
          type="button"
          className="canvas-pres-play-btn primary"
          disabled={slides.length === 0}
          onClick={() => onStartPresentation(0)}
          title={t('canvas.presentation.startFromBeginning')}
        >
          <Play size={14} />
          <span>{t('canvas.presentation.startFromBeginning')}</span>
        </button>
        <button
          type="button"
          className="canvas-pres-play-btn"
          disabled={slides.length === 0}
          onClick={() => onStartPresentation(playFromCurrentIndex)}
          title={t('canvas.presentation.playFromCurrent')}
        >
          <PlayCircle size={14} />
          <span>{t('canvas.presentation.playFromCurrent')}</span>
        </button>
      </div>

      {/* Collapsible Global Timing & Animation Settings */}
      {showSettings && (
        <div className="canvas-pres-settings">
          <div className="canvas-pres-setting-row">
            <div className="canvas-pres-setting-label">
              <span>{t('canvas.presentation.zoomDuration')}</span>
              <span>{config.zoomDuration} ms</span>
            </div>
            <input
              type="range"
              min={200}
              max={2500}
              step={50}
              value={config.zoomDuration}
              onChange={(e) => onUpdateConfig({ zoomDuration: Number(e.target.value) })}
            />
          </div>

          <div className="canvas-pres-setting-row">
            <div className="canvas-pres-setting-label">
              <span>{t('canvas.presentation.zoomArc')}</span>
            </div>
            <div className="canvas-pres-arc-pills">
              {(['none', 'subtle', 'medium', 'strong'] as CanvasZoomArc[]).map((arc) => {
                const labelKey =
                  arc === 'none'
                    ? 'canvas.presentation.zoomArcNone'
                    : arc === 'subtle'
                      ? 'canvas.presentation.zoomArcSubtle'
                      : arc === 'medium'
                        ? 'canvas.presentation.zoomArcMedium'
                        : 'canvas.presentation.zoomArcStrong';
                return (
                  <button
                    key={arc}
                    type="button"
                    className={`canvas-pres-arc-pill ${config.zoomArc === arc ? 'active' : ''}`}
                    onClick={() => onUpdateConfig({ zoomArc: arc })}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="canvas-pres-setting-row">
            <div className="canvas-pres-setting-label">
              <span>{t('canvas.presentation.revealDuration')}</span>
              <span>{config.revealDuration} ms</span>
            </div>
            <input
              type="range"
              min={100}
              max={1500}
              step={50}
              value={config.revealDuration}
              onChange={(e) => onUpdateConfig({ revealDuration: Number(e.target.value) })}
            />
          </div>

          <div className="canvas-pres-setting-row">
            <div className="canvas-pres-setting-label">
              <span>{t('canvas.presentation.revealDelay')}</span>
              <span>{config.revealDelay} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              step={25}
              value={config.revealDelay}
              onChange={(e) => onUpdateConfig({ revealDelay: Number(e.target.value) })}
            />
          </div>

          <div className="canvas-pres-setting-row">
            <div className="canvas-pres-setting-label">
              <span>{t('canvas.presentation.staggerDelay')}</span>
              <span>{config.staggerDelay} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={400}
              step={20}
              value={config.staggerDelay}
              onChange={(e) => onUpdateConfig({ staggerDelay: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {/* Capture Current View CTA */}
      <div className="canvas-pres-capture-bar">
        <button
          type="button"
          className="canvas-pres-capture-btn"
          onClick={onCaptureNewSlide}
        >
          <Plus size={14} />
          <span>{t('canvas.presentation.captureView').replace(/^\+\s*/, '')}</span>
        </button>
      </div>

      {/* Slide List */}
      <div className="canvas-pres-slide-list scroller">
        {slides.length === 0 ? (
          <div className="canvas-pres-empty-hint">{t('canvas.presentation.noSlidesHint')}</div>
        ) : (
          slides.map((slide: CanvasPresentationSlide, idx: number) => {
            const isSelected = slide.id === selectedSlideId;
            const isEditing = editingTitleId === slide.id;
            const isOverrideOpen = overrideOpenId === slide.id;
            const hasOverrides =
              slide.zoomDuration !== undefined || slide.revealDuration !== undefined;

            return (
              <div
                key={slide.id}
                className={`canvas-pres-slide-item ${isSelected ? 'selected' : ''} ${
                  dragOverIndex === idx ? 'drag-over' : ''
                }`}
                draggable={!isEditing}
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverIndex !== idx) setDragOverIndex(idx);
                }}
                onDragLeave={() => {
                  if (dragOverIndex === idx) setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) {
                    onReorderSlides(dragIndex, idx);
                  }
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onClick={() => onSelectSlide(slide.id)}
              >
                <div className="canvas-pres-slide-main">
                  <span className="canvas-pres-drag-handle" aria-hidden="true">
                    <GripVertical size={13} />
                  </span>
                  <span className="canvas-pres-slide-num">{idx + 1}</span>
                  <div className="canvas-pres-slide-info">
                    {isEditing ? (
                      <input
                        type="text"
                        className="canvas-pres-slide-title-input"
                        value={slide.title}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onUpdateSlideTitle(slide.id, e.target.value)}
                        onBlur={() => setEditingTitleId(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            e.stopPropagation();
                            setEditingTitleId(null);
                          }
                        }}
                      />
                    ) : (
                      <div
                        className="canvas-pres-slide-title"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingTitleId(slide.id);
                        }}
                        title={slide.title}
                      >
                        {slide.title}
                      </div>
                    )}
                    {slide.hiddenNodeIds.length > 0 && (
                      <div className="canvas-pres-slide-meta">
                        <EyeOff size={11} />
                        <span>
                          {t('canvas.presentation.hiddenCount', {
                            count: slide.hiddenNodeIds.length,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="canvas-pres-slide-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="canvas-pres-icon-btn"
                    onClick={() => onUpdateSlideView(slide.id)}
                    title={t('canvas.presentation.updateView')}
                    aria-label={t('canvas.presentation.updateView')}
                  >
                    <Camera size={13} />
                  </button>
                  <button
                    type="button"
                    className={`canvas-pres-icon-btn ${isOverrideOpen || hasOverrides ? 'active' : ''}`}
                    onClick={() =>
                      setOverrideOpenId((prev) => (prev === slide.id ? null : slide.id))
                    }
                    title={t('canvas.presentation.slideOverrides')}
                    aria-label={t('canvas.presentation.slideOverrides')}
                  >
                    <SlidersHorizontal size={13} />
                  </button>
                  <button
                    type="button"
                    className="canvas-pres-icon-btn"
                    disabled={idx === 0}
                    onClick={() => onReorderSlides(idx, idx - 1)}
                    title={t('canvas.presentation.moveUp')}
                    aria-label={t('canvas.presentation.moveUp')}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="canvas-pres-icon-btn"
                    disabled={idx === slides.length - 1}
                    onClick={() => onReorderSlides(idx, idx + 1)}
                    title={t('canvas.presentation.moveDown')}
                    aria-label={t('canvas.presentation.moveDown')}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="canvas-pres-icon-btn danger"
                    onClick={() => onDeleteSlide(slide.id)}
                    title={t('canvas.presentation.deleteSlide')}
                    aria-label={t('canvas.presentation.deleteSlide')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {isOverrideOpen && (
                  <div
                    className="canvas-pres-override-popover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="canvas-pres-setting-row">
                      <div className="canvas-pres-setting-label">
                        <span>{t('canvas.presentation.overrideZoomDuration')}</span>
                        <span>
                          {slide.zoomDuration !== undefined
                            ? `${slide.zoomDuration} ms`
                            : t('canvas.presentation.useGlobal', { value: config.zoomDuration })}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={200}
                        max={2500}
                        step={50}
                        value={slide.zoomDuration ?? config.zoomDuration}
                        onChange={(e) =>
                          onUpdateSlideOverrides(slide.id, {
                            zoomDuration: Number(e.target.value),
                            revealDuration: slide.revealDuration,
                          })
                        }
                      />
                    </div>
                    <div className="canvas-pres-setting-row">
                      <div className="canvas-pres-setting-label">
                        <span>{t('canvas.presentation.overrideRevealDuration')}</span>
                        <span>
                          {slide.revealDuration !== undefined
                            ? `${slide.revealDuration} ms`
                            : t('canvas.presentation.useGlobal', { value: config.revealDuration })}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={100}
                        max={1500}
                        step={50}
                        value={slide.revealDuration ?? config.revealDuration}
                        onChange={(e) =>
                          onUpdateSlideOverrides(slide.id, {
                            zoomDuration: slide.zoomDuration,
                            revealDuration: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    {hasOverrides && (
                      <button
                        type="button"
                        className="canvas-pres-reset-btn"
                        onClick={() =>
                          onUpdateSlideOverrides(slide.id, {
                            zoomDuration: undefined,
                            revealDuration: undefined,
                          })
                        }
                      >
                        {t('canvas.presentation.resetOverrides')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
