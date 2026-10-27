import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import {
  Columns,
  Rows,
  ArrowLeft,
  X,
  GitFork,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { createRoot, type Root } from 'react-dom/client';
import DOMPurify from 'dompurify';
import { useTranslation } from '../i18n';
import { api } from '../api';
import { syncEngine } from '../sync/syncEngine';
import type { GraphData } from '../../shared/types';
import { WorkflowCanvasIcon } from './canvas/WorkflowCanvasIcon';
import { renderReadingHtml, loadAndInitMermaid, escapeHtml } from '../utils/readingMode';
import { BaseView } from './BaseView';

const GraphView = lazy(() =>
  import('./GraphView').then((m) => ({ default: m.GraphView }))
);
const CanvasEditor = lazy(() =>
  import('./canvas/CanvasEditor').then((m) => ({ default: m.CanvasEditor }))
);

export type ResearchContentType = 'note' | 'canvas' | 'image' | 'pdf' | 'graph';

export function detectFileType(path: string): ResearchContentType {
  const lower = path.toLowerCase();
  if (lower.endsWith('.canvas')) return 'canvas';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(lower)) return 'image';
  return 'note';
}

export interface ResearchTarget {
  path: string;
  type: ResearchContentType;
}

export interface ResearchPaneProps {
  target: ResearchTarget | null;
  orientation: 'horizontal' | 'vertical';
  onToggleOrientation: () => void;
  onOpenInMain: (path: string) => void;
  onClose: () => void;
  onNavigate: (target: string, event?: { altKey?: boolean; preventDefault?: () => void }) => void;
  onShowGraph: () => void;
  graphData: GraphData;
  allNotes: { path: string; name: string; basename: string }[];
  activeNotePath: string | null;
  onSelectTag?: (tag: string) => void;
}

export const ResearchPane: React.FC<ResearchPaneProps> = ({
  target,
  orientation,
  onToggleOrientation,
  onOpenInMain,
  onClose,
  onNavigate,
  onShowGraph,
  graphData,
  allNotes,
  activeNotePath,
  onSelectTag,
}) => {
  const { t, language } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [noteContent, setNoteContent] = useState<string>('');
  const [canvasRawContent, setCanvasRawContent] = useState<string>('{}');
  const [imageZoom, setImageZoom] = useState<number>(1);
  const readingContainerRef = useRef<HTMLDivElement>(null);

  // Load content when target changes
  useEffect(() => {
    if (!target || target.type === 'graph') {
      setLoading(false);
      return;
    }

    let isMounted = true;
    setImageZoom(1);

    if (target.type === 'note') {
      setLoading(true);
      syncEngine
        .getNote(target.path)
        .then((note) => {
          if (!isMounted) return;
          setNoteContent(note.body || '');
          setLoading(false);
        })
        .catch(() => {
          if (!isMounted) return;
          api
            .getNote(target.path)
            .then((res) => {
              if (!isMounted) return;
              setNoteContent(res.body || '');
              setLoading(false);
            })
            .catch(() => {
              if (!isMounted) return;
              setNoteContent('# Fehler beim Laden der Notiz');
              setLoading(false);
            });
        });
    } else if (target.type === 'canvas') {
      setLoading(true);
      syncEngine
        .getNote(target.path)
        .then((note) => {
          if (!isMounted) return;
          setCanvasRawContent(note.rawContent || note.body || '{}');
          setLoading(false);
        })
        .catch(() => {
          if (!isMounted) return;
          api
            .getNote(target.path)
            .then((res) => {
              if (!isMounted) return;
              setCanvasRawContent(res.rawContent || res.body || '{}');
              setLoading(false);
            })
            .catch(() => {
              if (!isMounted) return;
              setCanvasRawContent('{}');
              setLoading(false);
            });
        });
    } else {
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [target?.path, target?.type]);

  // Render HTML for markdown notes
  const renderedHtml = useMemo(() => {
    if (target?.type !== 'note') return '';
    return renderReadingHtml(noteContent, target.path, allNotes);
  }, [target?.type, target?.path, noteContent, allNotes]);

  // Setup Mermaid diagrams, Base blocks, and event listeners in reading view
  useEffect(() => {
    if (target?.type !== 'note' || !readingContainerRef.current) return;
    const container = readingContainerRef.current;

    const isDark =
      document.documentElement.getAttribute('data-theme') !== 'light' &&
      (document.documentElement.getAttribute('data-theme') === 'dark' ||
        (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
        document.documentElement.classList.contains('dark'));

    // Mermaid rendering
    const mermaidBlocks = container.querySelectorAll<HTMLElement>('.reading-mermaid-container');
    mermaidBlocks.forEach((block) => {
      const rawCode = decodeURIComponent(block.dataset.code || '');
      const svgContainer = block.querySelector<HTMLElement>('.reading-mermaid-svg');
      if (!svgContainer || svgContainer.hasAttribute('data-rendered')) return;

      svgContainer.setAttribute('data-rendered', 'true');
      const renderId = 'research-mermaid-' + Math.random().toString(36).slice(2, 9);
      loadAndInitMermaid(isDark)
        .then((mermaid) => mermaid.render(renderId, rawCode || 'graph TD\n  Start'))
        .then(({ svg }) => {
          svgContainer.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
            ADD_ATTR: ['style', 'class', 'transform', 'viewBox', 'xmlns'],
          });
          const svgEl = svgContainer.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        })
        .catch((err) => {
          document.getElementById('d' + renderId)?.remove();
          document.getElementById(renderId)?.remove();
          svgContainer.innerHTML = `
            <div class="cm-lp-mermaid-error">
              <span class="cm-lp-mermaid-error-icon">⚠️</span>
              <span class="cm-lp-mermaid-error-title">Mermaid Syntax Error:</span>
              <pre class="cm-lp-mermaid-error-msg">${escapeHtml(err?.message || String(err))}</pre>
            </div>
          `;
        });
    });

    // Base block rendering
    const baseBlocks = container.querySelectorAll<HTMLElement>('.reading-base-container');
    const baseRoots: Root[] = [];
    baseBlocks.forEach((block) => {
      const rawCode = decodeURIComponent(block.dataset.code || '');
      const mountContainer = block.querySelector<HTMLElement>('.reading-base-mount');
      if (!mountContainer || mountContainer.hasAttribute('data-rendered')) return;

      mountContainer.setAttribute('data-rendered', 'true');
      const root = createRoot(mountContainer);
      baseRoots.push(root);
      root.render(
        <BaseView
          definitionYaml={rawCode}
          allNotes={allNotes}
          currentBasePath={target.path || undefined}
          onOpenNote={(noteP: string) => onNavigate(noteP)}
        />
      );
    });

    return () => {
      baseRoots.forEach((r) => {
        try {
          r.unmount();
        } catch {}
      });
    };
  }, [target?.type, target?.path, renderedHtml, allNotes, onNavigate]);

  // Click handler inside Reading Mode
  const handleReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If external link, let standard target="_blank" handle it
    const extLink = (e.target as HTMLElement).closest('a[target="_blank"]');
    if (extLink) return;

    // Codeblock view toggle (Diagram | Code / Preview | Code)
    const toggleBtn = (e.target as HTMLElement).closest('.codeblock-toggle-btn') as HTMLButtonElement | null;
    if (toggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = toggleBtn.closest('.codeblock-container');
      if (!container) return;
      const action = toggleBtn.getAttribute('data-action');
      const buttons = container.querySelectorAll('.codeblock-toggle-btn');
      buttons.forEach((b) => b.classList.remove('active'));
      toggleBtn.classList.add('active');

      const previewEl = container.querySelector<HTMLElement>(
        '.reading-mermaid-preview, .reading-html-preview, .reading-base-preview'
      );
      const codeEl = container.querySelector<HTMLElement>(
        '.reading-mermaid-code, .reading-html-code, .reading-base-code'
      );

      if (action === 'code') {
        if (previewEl) previewEl.style.display = 'none';
        if (codeEl) codeEl.style.display = 'block';
      } else {
        if (previewEl) previewEl.style.display = 'block';
        if (codeEl) codeEl.style.display = 'none';
      }
      return;
    }

    // Copy code button
    const copyBtn = (e.target as HTMLElement).closest(
      '.codeblock-copy-btn, .cm-lp-codeblock-copy-btn'
    ) as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = copyBtn.closest('.codeblock-container');
      const code = container?.querySelector('code')?.textContent || '';
      navigator.clipboard.writeText(code).finally(() => {
        copyBtn.classList.add('copied');
        const textSpan = copyBtn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = language === 'de' ? 'Kopiert!' : 'Copied!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          if (textSpan) textSpan.textContent = language === 'de' ? 'Kopieren' : 'Copy';
        }, 2000);
      });
      return;
    }

    // WikiLink or Tag click
    const targetEl = (e.target as HTMLElement).closest('[data-wikilink], [data-tag]');
    if (!targetEl) return;

    const wiki = targetEl.getAttribute('data-wikilink');
    if (wiki) {
      if (e.altKey) e.preventDefault();
      e.preventDefault();
      onNavigate(wiki, e);
      return;
    }

    const tag = targetEl.getAttribute('data-tag');
    if (tag && onSelectTag) {
      e.preventDefault();
      onSelectTag(tag);
    }
  };

  const isGraph = !target || target.type === 'graph';
  const fileName = target?.path ? target.path.split('/').pop() || target.path : '';
  const typeBadge = isGraph
    ? 'GRAPH'
    : target?.type === 'note'
    ? 'MD'
    : target?.type === 'canvas'
    ? 'CANVAS'
    : target?.type === 'image'
    ? 'IMG'
    : target?.type === 'pdf'
    ? 'PDF'
    : 'REF';

  return (
    <aside className="research-pane-container" aria-label={t('research.title', 'Rechercheansicht')}>
      {/* Header Bar */}
      <header className="research-pane-header">
        <div className="research-header-left">
          <span className="research-type-badge">{typeBadge}</span>
          <span className="research-title-text" title={isGraph ? t('graph.title', 'Graph-Ansicht') : target?.path}>
            {isGraph ? (
              <>
                <GitFork size={14} className="research-icon" />
                <span>{t('graph.title', 'Graph-Ansicht')}</span>
              </>
            ) : target?.type === 'canvas' ? (
              <>
                <WorkflowCanvasIcon size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : target?.type === 'image' ? (
              <>
                <ImageIcon size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : (
              <>
                <FileText size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            )}
          </span>
        </div>

        <div className="research-header-controls">
          {/* Quick Graph Switch */}
          <button
            type="button"
            className={`research-header-btn show-graph-btn ${isGraph ? 'active' : ''}`}
            onClick={onShowGraph}
            title={t('research.showGraph', 'Graph in Rechercheansicht zeigen')}
            aria-label={t('research.showGraph', 'Graph in Rechercheansicht zeigen')}
          >
            <GitFork size={15} />
            <span className="btn-label-desktop">{language === 'de' ? 'Graph' : 'Graph'}</span>
          </button>

          {/* Orientation Toggle */}
          <button
            type="button"
            className="research-header-btn orientation-btn"
            onClick={onToggleOrientation}
            title={t('research.toggleOrientation', 'Split-Ausrichtung wechseln (Links/Rechts ⇄ Oben/Unten)')}
            aria-label={t('research.toggleOrientation', 'Split-Ausrichtung wechseln')}
          >
            {orientation === 'horizontal' ? <Rows size={15} /> : <Columns size={15} />}
          </button>

          {/* Open in Main Editor */}
          <button
            type="button"
            className="research-header-btn open-in-main-btn"
            disabled={isGraph || !target?.path}
            onClick={() => {
              if (target?.path) {
                onOpenInMain(target.path);
              }
            }}
            title={t('research.openInMain', 'Im Haupteditor öffnen (Alt+Klick)')}
            aria-label={t('research.openInMain', 'Im Haupteditor öffnen')}
          >
            <ArrowLeft size={15} />
            <span className="btn-label-desktop">{language === 'de' ? 'Im Editor' : 'In Editor'}</span>
          </button>

          {/* Close Research Pane */}
          <button
            type="button"
            className="research-header-btn close-btn"
            onClick={onClose}
            title={t('research.close', 'Rechercheansicht schließen')}
            aria-label={t('research.close', 'Rechercheansicht schließen')}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Pane Content Area */}
      <div className="research-pane-content">
        {loading ? (
          <div className="empty-state">
            <span className="sync-spinner" />
            <p>{language === 'de' ? 'Lade Referenzinhalt…' : 'Loading reference content…'}</p>
          </div>
        ) : isGraph ? (
          <div className="research-graph-wrapper">
            <Suspense fallback={<div className="empty-state">Lade Graph…</div>}>
              <GraphView
                graphData={graphData}
                activeNotePath={activeNotePath}
                isLocalGraph={false}
                onSelectNote={(pathOrTitle, isUnresolved, event) => {
                  if (event?.altKey) {
                    event.preventDefault?.();
                    onOpenInMain(pathOrTitle);
                  } else {
                    onNavigate(pathOrTitle, event);
                  }
                }}
                onSelectTag={onSelectTag}
              />
            </Suspense>
          </div>
        ) : target?.type === 'note' ? (
          <div
            className="research-reading-scroller scroller"
            ref={readingContainerRef}
            onClick={handleReadingClick}
          >
            <div className="reading-view-container research-reading-container">
              <div
                className="reading-view-content"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </div>
          </div>
        ) : target?.type === 'canvas' ? (
          <div className="research-canvas-wrapper">
            <Suspense fallback={<div className="empty-state">Lade Canvas…</div>}>
              <CanvasEditor
                filePath={target.path}
                rawContent={canvasRawContent}
                onChange={() => {}}
                onOpenNote={(path: string) => onNavigate(path)}
                onSelectTag={onSelectTag}
                allNotes={allNotes}
                readOnly={true}
              />
            </Suspense>
          </div>
        ) : target?.type === 'image' ? (
          <div className="research-image-wrapper">
            <div className="research-image-toolbar">
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom((z) => Math.min(5, z * 1.25))}
                title="Zoom In (+)"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom((z) => Math.max(0.2, z / 1.25))}
                title="Zoom Out (-)"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom(1)}
                title="Fit / 100%"
              >
                <RotateCcw size={16} />
              </button>
              <span className="image-zoom-indicator">{Math.round(imageZoom * 100)}%</span>
            </div>
            <div className="research-image-canvas">
              <img
                src={api.getAttachmentUrl(target.path)}
                alt={fileName}
                className="research-image-element"
                style={{
                  transform: `scale(${imageZoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.12s ease-out',
                }}
              />
            </div>
          </div>
        ) : target?.type === 'pdf' ? (
          <div className="research-pdf-wrapper">
            <iframe
              src={`${api.getAttachmentUrl(target.path)}#toolbar=1&view=FitH`}
              className="research-pdf-frame"
              title={fileName}
            />
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={36} />
            <p>{language === 'de' ? 'Nicht unterstütztes Format' : 'Unsupported format'}</p>
          </div>
        )}
      </div>
    </aside>
  );
};
