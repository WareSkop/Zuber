import html2canvas from 'html2canvas';

function waitAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function areCanvasEmbedsReady(container: HTMLElement): boolean {
  const canvasEmbeds = Array.from(
    container.querySelectorAll<HTMLElement>('.embedded-canvas-container')
  );
  return canvasEmbeds.every((el) => {
    if (el.querySelector('.canvas-embed-loading')) return false;
    return Boolean(
      el.querySelector('.react-flow__node, .canvas-embed-error, .react-flow__renderer')
    );
  });
}

function areBaseEmbedsReady(container: HTMLElement): boolean {
  const baseEmbeds = Array.from(
    container.querySelectorAll<HTMLElement>('.embedded-base-container')
  );
  return baseEmbeds.every((el) => {
    if (el.querySelector('.base-embed-loading')) return false;
    return Boolean(el.querySelector('.base-embed-content, .base-error-box'));
  });
}

/**
 * Waits until all embedded Canvas and Base widgets inside `container` finish
 * their async loading and React Flow / layout painting completes.
 */
export async function waitForEmbedsToRender(
  container: HTMLElement,
  timeoutMs = 2500
): Promise<void> {
  const hasEmbeds = Boolean(
    container.querySelector('.embedded-canvas-container, .embedded-base-container')
  );
  if (!hasEmbeds) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (areCanvasEmbedsReady(container) && areBaseEmbedsReady(container)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Allow React Flow fitView layout and SVG edge paths to finish painting
  await waitAnimationFrame();
  await waitAnimationFrame();
  await new Promise((resolve) => setTimeout(resolve, 150));
}

/**
 * Strips 4-byte UTF-16 surrogate-pair emojis and normalizes non-WinAnsi symbols
 * so jsPDF's built-in fonts never emit Latin-1 mojibake (e.g. Ø=ÜÄ), while
 * preserving German umlauts (ä, ö, ü, ß, Ä, Ö, Ü) and standard Latin-1 text.
 */
export function sanitizePdfText(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/↗/g, '->')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[✓✔]/g, '[x]')
    .replace(/⚠/g, '[!]')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface CapturedElementImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Captures a rendered embed container (e.g. CanvasEmbedWidget or BaseEmbedWidget)
 * as a crisp PNG data URL using html2canvas, fixing React Flow SVG edge sizing
 * and hiding interactive buttons during capture.
 */
export async function captureElementToPng(
  element: HTMLElement
): Promise<CapturedElementImage | null> {
  const isCanvas = element.classList.contains('embedded-canvas-container');
  const prevHeight = element.style.height;
  const prevBg = element.style.background;

  if (isCanvas) {
    element.style.height = '380px';
    element.style.background = '#ffffff';
  }

  try {
    const renderedCanvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      onclone: (_clonedDoc, clonedEl) => {
        clonedEl
          .querySelectorAll<HTMLElement>(
            '.canvas-embed-open-btn, .base-embed-open-btn, .react-flow__controls, .react-flow__attribution'
          )
          .forEach((btn) => {
            btn.style.display = 'none';
          });

        if (isCanvas) {
          clonedEl.style.height = '380px';
          clonedEl.style.background = '#ffffff';
          const viewport = clonedEl.querySelector<HTMLElement>('.react-flow__viewport');
          if (viewport) {
            viewport.style.width = '100%';
            viewport.style.height = '100%';
            viewport.style.overflow = 'visible';
          }
          const edgesSvg = clonedEl.querySelector<SVGElement>('.react-flow__edges');
          if (edgesSvg) {
            edgesSvg.style.width = '100%';
            edgesSvg.style.height = '100%';
            edgesSvg.style.overflow = 'visible';
          }
        }
      },
    });

    if (!renderedCanvas.width || !renderedCanvas.height) return null;
    return {
      dataUrl: renderedCanvas.toDataURL('image/png'),
      width: renderedCanvas.width,
      height: renderedCanvas.height,
    };
  } catch {
    return null;
  } finally {
    if (isCanvas) {
      element.style.height = prevHeight;
      element.style.background = prevBg;
    }
  }
}
