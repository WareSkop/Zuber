import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useTranslation } from '../i18n';

export interface ResearchPdfViewerProps {
  src: string;
  title: string;
  externalOpenUrl?: string;
}

interface RenderedPageSlot {
  pageNumber: number;
}

export const ResearchPdfViewer: React.FC<ResearchPdfViewerProps> = ({
  src,
  title,
  externalOpenUrl,
}) => {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderGenerationRef = useRef<number>(0);

  // Load PDF document via local offline pdfjs-dist worker
  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    setLoading(true);
    setErrorMsg(null);
    setNumPages(0);
    setCurrentPage(1);

    const loadPdf = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        if (pdfjsLib.GlobalWorkerOptions) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        }
        loadingTask = pdfjsLib.getDocument({
          url: src,
          withCredentials: true,
        });
        const doc = await loadingTask.promise;
        if (cancelled) {
          try {
            await doc.destroy();
          } catch {}
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages || 0);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err?.message || t('research.pdfError'));
        setLoading(false);
      }
    };

    if (src) {
      loadPdf();
    }

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {}
      const prevDoc = pdfDocRef.current;
      pdfDocRef.current = null;
      if (prevDoc) {
        try {
          prevDoc.destroy?.();
        } catch {}
      }
    };
  }, [src, t]);

  // Render canvas + selectable TextLayer for each page when document or scale changes
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || numPages <= 0) return;

    let cancelled = false;
    const generation = ++renderGenerationRef.current;
    const activeTasks: Array<{ cancel?: () => void }> = [];

    const renderAllPages = async () => {
      const pdfjsLib = await import('pdfjs-dist');
      if (cancelled || generation !== renderGenerationRef.current) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (cancelled || generation !== renderGenerationRef.current) break;
        const pageSlot = pageContainerRefs.current.get(pageNum);
        if (!pageSlot) continue;

        const canvas = pageSlot.querySelector<HTMLCanvasElement>('.research-pdf-canvas');
        const textLayerEl = pageSlot.querySelector<HTMLDivElement>('.research-pdf-text-layer');
        if (!canvas || !textLayerEl) continue;

        try {
          const page = await doc.getPage(pageNum);
          if (cancelled || generation !== renderGenerationRef.current) break;

          const viewport = page.getViewport({ scale });
          const cssW = Math.floor(viewport.width);
          const cssH = Math.floor(viewport.height);

          pageSlot.style.width = `${cssW}px`;
          pageSlot.style.height = `${cssH}px`;
          pageSlot.style.setProperty('--scale-factor', String(scale));

          canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
          canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
          canvas.style.width = `${cssW}px`;
          canvas.style.height = `${cssH}px`;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const renderTask = page.render({
              canvasContext: ctx,
              viewport,
            });
            activeTasks.push(renderTask);
            await renderTask.promise.catch((err: any) => {
              if (err?.name !== 'RenderingCancelledException') {
                throw err;
              }
            });
          }

          if (cancelled || generation !== renderGenerationRef.current) break;

          // Build transparent selectable TextLayer aligned to the rendered page viewport
          textLayerEl.innerHTML = '';
          textLayerEl.style.width = `${cssW}px`;
          textLayerEl.style.height = `${cssH}px`;
          textLayerEl.style.setProperty('--scale-factor', String(scale));

          if (typeof pdfjsLib.TextLayer === 'function') {
            const textContent = await page.getTextContent();
            if (cancelled || generation !== renderGenerationRef.current) break;
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayerEl,
              viewport,
            });
            activeTasks.push(textLayer);
            await textLayer.render().catch((err: any) => {
              if (err?.name !== 'AbortException') {
                throw err;
              }
            });
          }
        } catch (err: any) {
          if (cancelled || err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') {
            continue;
          }
          console.warn(`[Zuber PDF] Failed to render page ${pageNum}:`, err);
        }
      }
    };

    renderAllPages();

    return () => {
      cancelled = true;
      for (const task of activeTasks) {
        try {
          task.cancel?.();
        } catch {}
      }
    };
  }, [numPages, scale]);

  const handleScroll = () => {
    const container = scrollerRef.current;
    if (!container || numPages <= 0) return;
    const containerTop = container.getBoundingClientRect().top;
    let bestPage = 1;
    let bestDist = Infinity;

    for (let i = 1; i <= numPages; i++) {
      const el = pageContainerRefs.current.get(i);
      if (!el) continue;
      const dist = Math.abs(el.getBoundingClientRect().top - containerTop);
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = i;
      }
    }
    setCurrentPage(bestPage);
  };

  const pages: RenderedPageSlot[] = [];
  for (let i = 1; i <= numPages; i++) {
    pages.push({ pageNumber: i });
  }

  return (
    <div className="research-pdf-viewer" data-testid="research-pdf-viewer">
      <div className="research-pdf-toolbar">
        <div className="research-pdf-toolbar-left">
          <FileText size={14} />
          <span className="research-pdf-page-indicator" data-testid="research-pdf-page-indicator">
            {numPages > 0
              ? t('research.pdfPageInfo', { current: currentPage, total: numPages })
              : title}
          </span>
        </div>

        <div className="research-pdf-toolbar-right">
          <button
            type="button"
            className="image-tool-btn"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
            title={t('research.pdfZoomOut')}
            aria-label={t('research.pdfZoomOut')}
          >
            <ZoomOut size={15} />
          </button>
          <span className="image-zoom-indicator">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="image-tool-btn"
            onClick={() => setScale((s) => Math.min(3.0, Number((s + 0.15).toFixed(2))))}
            title={t('research.pdfZoomIn')}
            aria-label={t('research.pdfZoomIn')}
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="image-tool-btn"
            onClick={() => setScale(1.15)}
            title={t('research.pdfZoomReset')}
            aria-label={t('research.pdfZoomReset')}
          >
            <RotateCcw size={14} />
          </button>
          {(externalOpenUrl || src) && (
            <button
              type="button"
              className="image-tool-btn"
              onClick={() =>
                window.open(externalOpenUrl || src, '_blank', 'noopener,noreferrer')
              }
              title={t('editor.openInNewTab')}
              aria-label={t('editor.openInNewTab')}
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="research-pdf-pages scroller" ref={scrollerRef} onScroll={handleScroll}>
        {loading ? (
          <div className="empty-state">
            <span className="sync-spinner" />
            <p>{t('research.pdfLoading')}</p>
          </div>
        ) : errorMsg ? (
          <div className="research-web-blocked-card">
            <FileText size={32} className="research-web-blocked-icon" />
            <h3>{t('research.pdfError')}</h3>
            <p>{errorMsg}</p>
            {(externalOpenUrl || src) && (
              <button
                type="button"
                className="research-web-blocked-btn"
                onClick={() =>
                  window.open(externalOpenUrl || src, '_blank', 'noopener,noreferrer')
                }
              >
                {t('editor.openInNewTab')}
              </button>
            )}
          </div>
        ) : (
          pages.map(({ pageNumber }) => (
            <div
              key={pageNumber}
              className="research-pdf-page"
              data-pdf-page={pageNumber}
              ref={(el) => {
                if (el) pageContainerRefs.current.set(pageNumber, el);
                else pageContainerRefs.current.delete(pageNumber);
              }}
            >
              <canvas className="research-pdf-canvas" />
              <div className="research-pdf-text-layer textLayer" data-pdf-page={pageNumber} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
