import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import {
  FileText,
  Image as ImageIcon,
  ExternalLink,
  File,
  Link2,
  Globe,
  AlertTriangle,
  Database,
} from 'lucide-react';
import { api } from '../../../api';
import { resolveCanvasColor, type CanvasShape } from '../../../../shared/canvasTypes';
import { stripZencExt } from '../../../crypto/folderCrypto';
import { resolveDecryptedAttachmentUrl } from '../../../crypto/encryptedAttachmentUrl';
import { renderReadingHtml } from '../../../utils/readingMode';
import { useCanvasContext, isCanvasAncestorCycle } from '../CanvasContext';
import { CanvasNodeHiddenBadge } from './CanvasNodeHiddenBadge';
import {
  isImageFilePath,
  renderShapeClipGeometry,
  renderShapeBorderSvg,
} from './canvasShapeGeometry';
import { useTranslation } from '../../../i18n';

function getLinkBadgeLabel(linkUrl: string): string {
  const trimmed = linkUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return trimmed;
    }
  }
  const clean = stripZencExt(trimmed);
  const name = clean.split('/').pop() || clean;
  return name.replace(/\.md$/i, '');
}

export const CanvasFileNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { t } = useTranslation();
  const { onOpenNote, onSelectTag, allNotes, readOnly, ancestorPaths = [] } = useCanvasContext();
  const filePath = (data.file as string) || '';
  const customColor = resolveCanvasColor(data.color as string);
  const shape: CanvasShape = (data.shape as CanvasShape) || 'rectangle';
  const linkUrl = typeof data.linkUrl === 'string' ? data.linkUrl.trim() : '';

  const [noteContent, setNoteContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [decryptedImageUrl, setDecryptedImageUrl] = useState<string | null>(null);

  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const rawUid = useId();
  const clipId = `canvas-img-clip-${rawUid.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const logicalPath = stripZencExt(filePath);
  const isMarkdown = logicalPath.toLowerCase().endsWith('.md');
  const isImage = isImageFilePath(filePath);
  const isCircularSelf = Boolean(filePath && isCanvasAncestorCycle(filePath, ancestorPaths));
  const fileName = logicalPath.split('/').pop() || logicalPath || t('canvas.untitledFile');
  const isCustomImageShape = isImage && shape !== 'rectangle';

  useEffect(() => {
    let cancelled = false;
    if (isMarkdown && filePath && !isCircularSelf) {
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
            setNoteContent(t('canvas.noteLoadError'));
            setLoading(false);
          }
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [filePath, isMarkdown, isCircularSelf, t]);

  useEffect(() => {
    let cancelled = false;
    let objectUrlToRevoke: string | null = null;
    setDecryptedImageUrl(null);

    if (isImage && filePath && !isCircularSelf) {
      resolveDecryptedAttachmentUrl(filePath)
        .then((res) => {
          if (cancelled) {
            if (res?.isObjectUrl) URL.revokeObjectURL(res.url);
            return;
          }
          if (res?.url) {
            if (res.isObjectUrl) objectUrlToRevoke = res.url;
            setDecryptedImageUrl(res.url);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [filePath, isImage, isCircularSelf]);

  const renderedMarkdown = useMemo(() => {
    if (!noteContent || !isMarkdown || isCircularSelf) return '';
    return renderReadingHtml(noteContent, filePath, allNotes, {
      attachmentLabel: t('sidebar.pdfAttachmentLabel'),
      pageBreakLabel: t('editor.pageBreakLabel'),
      openInNewTabLabel: t('editor.openInNewTab'),
      embeddedNoteLabel: t('editor.embeddedNote'),
    });
  }, [noteContent, isMarkdown, isCircularSelf, filePath, allNotes, t]);

  // Post-process rendered Markdown inside the node:
  // 1) Replace nested .canvas / .base embed containers with safe clickable placeholders (no infinite recursion!)
  // 2) Decrypt `.zenc` attachment <img> elements
  useEffect(() => {
    const container = markdownContainerRef.current;
    if (!container || !renderedMarkdown) return;

    const revokedUrls: string[] = [];
    let cancelled = false;

    const canvasEmbeds = container.querySelectorAll<HTMLElement>(
      '.embedded-canvas-container, .reading-canvas-embed'
    );
    canvasEmbeds.forEach((el) => {
      const targetPath = el.dataset.canvasPath || el.dataset.wikilink || '';
      const displayName = stripZencExt(targetPath).split('/').pop() || targetPath;
      const isCycle = isCanvasAncestorCycle(targetPath, ancestorPaths);
      el.classList.add('canvas-file-safe-embed-card', 'nodrag');
      el.innerHTML = '';

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `canvas-file-safe-embed-btn ${isCycle ? 'is-cycle' : ''}`;
      row.title = isCycle
        ? t('canvas.circularEmbedNotice', { target: displayName })
        : t('canvas.openNoteTooltip', { target: targetPath });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'canvas-file-safe-embed-title';
      titleSpan.textContent = isCycle
        ? t('canvas.circularEmbedNotice', { target: displayName })
        : `Canvas: ${displayName}`;
      row.appendChild(titleSpan);

      row.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (targetPath) onOpenNote(targetPath);
      };
      el.appendChild(row);
    });

    const baseEmbeds = container.querySelectorAll<HTMLElement>(
      '.embedded-base-container, .reading-base-embed'
    );
    baseEmbeds.forEach((el) => {
      const targetPath = el.dataset.basePath || el.dataset.wikilink || '';
      const displayName = stripZencExt(targetPath).split('/').pop() || targetPath;
      el.classList.add('canvas-file-safe-embed-card', 'nodrag');
      el.innerHTML = '';

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'canvas-file-safe-embed-btn';
      row.title = t('canvas.openNoteTooltip', { target: targetPath });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'canvas-file-safe-embed-title';
      titleSpan.textContent = `Base: ${displayName}`;
      row.appendChild(titleSpan);

      row.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (targetPath) onOpenNote(targetPath);
      };
      el.appendChild(row);
    });

    const imgs = container.querySelectorAll<HTMLImageElement>('img');
    imgs.forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src.includes('/api/vault/attachment')) return;
      try {
        const parsed = new URL(src, window.location.origin);
        const targetParam = parsed.searchParams.get('target');
        if (!targetParam) return;
        resolveDecryptedAttachmentUrl(targetParam, filePath)
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
        // ignore URL parse issues
      }
    });

    return () => {
      cancelled = true;
      for (const u of revokedUrls) {
        URL.revokeObjectURL(u);
      }
    };
  }, [renderedMarkdown, filePath, ancestorPaths, onOpenNote, t]);

  const handleMarkdownClick = (e: React.MouseEvent) => {
    const tagEl = (e.target as HTMLElement).closest('[data-tag]') as HTMLElement | null;
    if (tagEl) {
      e.preventDefault();
      e.stopPropagation();
      const tag = tagEl.getAttribute('data-tag');
      if (tag && onSelectTag) {
        onSelectTag(tag);
      }
      return;
    }

    const targetEl = (e.target as HTMLElement).closest('[data-wiki-target], [data-wikilink], a') as HTMLElement | null;
    if (targetEl) {
      const href = targetEl.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        e.stopPropagation();
        return;
      }
      if (href.includes('/api/vault/attachment')) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const target =
        targetEl.getAttribute('data-wiki-target') ||
        targetEl.getAttribute('data-wikilink') ||
        href;
      if (target && target !== '#') {
        onOpenNote(decodeURIComponent(target));
      }
    }
  };

  const openLinkedTarget = (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
    } else {
      onOpenNote(trimmed);
    }
  };

  const handleImageInteraction = (e: React.MouseEvent, forceOpen = false) => {
    if (readOnly && linkUrl) {
      e.stopPropagation();
      openLinkedTarget(linkUrl);
      return;
    }
    if (forceOpen || e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      if (linkUrl) {
        openLinkedTarget(linkUrl);
      } else {
        onOpenNote(filePath);
      }
    }
  };

  const strokeColor = customColor || (selected ? 'var(--accent-color, #7852ee)' : 'var(--border-color, #444)');
  const strokeWidth = selected ? '2.5' : '2';
  const resolvedImageSrc = decryptedImageUrl || api.getAttachmentUrl(filePath);
  const isExternalLink = /^https?:\/\//i.test(linkUrl);
  const linkBadgeLabel = linkUrl ? getLinkBadgeLabel(linkUrl) : '';

  return (
    <div
      className={`canvas-custom-node canvas-file-node ${isImage ? 'is-image-node' : ''} ${
        isCustomImageShape ? `is-shaped-image shape-${shape}` : ''
      } ${selected ? 'selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        borderColor: isCustomImageShape ? 'transparent' : strokeColor,
        backgroundColor: isCustomImageShape ? 'transparent' : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={isImage ? 80 : 120}
        minHeight={isImage ? 60 : 80}
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

      {isCircularSelf ? (
        <>
          <div className="canvas-file-header">
            <div className="canvas-file-title-group" title={filePath}>
              <AlertTriangle size={14} />
              <span className="canvas-file-name">{fileName}</span>
            </div>
            <button
              type="button"
              className="canvas-file-open-btn nodrag"
              onClick={() => onOpenNote(filePath)}
              title={t('canvas.openFile')}
              aria-label={t('canvas.openFileAria')}
            >
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="canvas-file-body canvas-file-cycle-guard">
            <AlertTriangle size={24} />
            <p>{t('canvas.circularEmbedNotice', { target: fileName })}</p>
          </div>
        </>
      ) : isCustomImageShape ? (
        <div
          className={`canvas-file-shaped-image-wrapper ${linkUrl ? 'has-link' : ''}`}
          onClick={(e) => handleImageInteraction(e, false)}
          onDoubleClick={(e) => handleImageInteraction(e, true)}
        >
          <svg
            width="0"
            height="0"
            style={{ position: 'absolute', pointerEvents: 'none' }}
            aria-hidden="true"
          >
            <defs>
              <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                <g transform="scale(0.01, 0.01)">{renderShapeClipGeometry(shape)}</g>
              </clipPath>
            </defs>
          </svg>

          <img
            src={resolvedImageSrc}
            alt={fileName}
            loading="lazy"
            className="canvas-file-shaped-img"
            style={{
              clipPath: `url(#${clipId})`,
              WebkitClipPath: `url(#${clipId})`,
            }}
          />

          <svg
            className="canvas-node-svg-bg canvas-file-shape-border-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {renderShapeBorderSvg(shape, strokeColor, strokeWidth)}
          </svg>

          {linkUrl && (
            <button
              type="button"
              className="canvas-file-link-badge floating nodrag"
              onClick={(e) => {
                e.stopPropagation();
                openLinkedTarget(linkUrl);
              }}
              title={t('canvas.openLinkedTarget', { target: linkUrl })}
            >
              {isExternalLink ? <Globe size={11} /> : <Link2 size={11} />}
              <span>{linkBadgeLabel}</span>
            </button>
          )}

          {!readOnly && (
            <button
              type="button"
              className="canvas-file-open-btn floating nodrag"
              onClick={(e) => {
                e.stopPropagation();
                onOpenNote(filePath);
              }}
              title={t('canvas.openFile')}
              aria-label={t('canvas.openFileAria')}
            >
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      ) : (
        <>
          {/* File Header */}
          <div className="canvas-file-header">
            <div className="canvas-file-title-group" title={filePath}>
              {isImage ? (
                <ImageIcon size={14} />
              ) : isMarkdown ? (
                <FileText size={14} />
              ) : logicalPath.toLowerCase().endsWith('.base') ? (
                <Database size={14} />
              ) : (
                <File size={14} />
              )}
              <span className="canvas-file-name">{fileName}</span>
            </div>
            <div className="canvas-file-header-actions">
              {linkUrl && (
                <button
                  type="button"
                  className="canvas-file-link-badge nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    openLinkedTarget(linkUrl);
                  }}
                  title={t('canvas.openLinkedTarget', { target: linkUrl })}
                >
                  {isExternalLink ? <Globe size={11} /> : <Link2 size={11} />}
                  <span>{linkBadgeLabel}</span>
                </button>
              )}
              <button
                type="button"
                className="canvas-file-open-btn nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenNote(filePath);
                }}
                title={t('canvas.openFile')}
                aria-label={t('canvas.openFileAria')}
              >
                <ExternalLink size={13} />
              </button>
            </div>
          </div>

          {/* File Body Content */}
          <div className={`canvas-file-body ${isImage ? 'is-image-body' : 'nowheel nodrag scroller'}`}>
            {isMarkdown ? (
              loading ? (
                <div className="canvas-file-loading">{t('canvas.loadingNote')}</div>
              ) : (
                <div
                  ref={markdownContainerRef}
                  className="canvas-file-markdown markdown-rendered"
                  onClick={handleMarkdownClick}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('a, [data-wiki-target], [data-wikilink], [data-tag], button')) {
                      e.stopPropagation();
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                />
              )
            ) : isImage ? (
              <div
                className={`canvas-file-image-container ${linkUrl ? 'has-link' : ''}`}
                onClick={(e) => handleImageInteraction(e, false)}
                onDoubleClick={(e) => handleImageInteraction(e, true)}
              >
                <img src={resolvedImageSrc} alt={fileName} loading="lazy" />
              </div>
            ) : (
              <div className="canvas-file-fallback">
                <File size={32} />
                <p>{filePath}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
