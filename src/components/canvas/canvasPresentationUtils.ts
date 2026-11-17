import type { Viewport } from '@xyflow/react';
import type {
  CanvasBounds,
  CanvasPresentationSlide,
  CanvasZoomArc,
} from '../../../shared/canvasTypes';

/**
 * Converts the current React Flow viewport + container DOM dimensions into
 * resolution-independent world-space bounds.
 */
export function captureViewportBounds(
  viewport: { x: number; y: number; zoom: number },
  containerWidth: number,
  containerHeight: number
): CanvasBounds {
  const safeZoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const safeW = Math.max(1, containerWidth);
  const safeH = Math.max(1, containerHeight);
  return {
    x: -viewport.x / safeZoom,
    y: -viewport.y / safeZoom,
    width: safeW / safeZoom,
    height: safeH / safeZoom,
  };
}

/**
 * Calculates the React Flow viewport { x, y, zoom } for the current screen
 * dimensions so that `bounds` is centered and fits completely inside the viewport.
 */
export function boundsToViewport(
  bounds: CanvasBounds,
  containerWidth: number,
  containerHeight: number
): Viewport {
  const safeW = Math.max(1, bounds.width);
  const safeH = Math.max(1, bounds.height);
  const safeContainerW = Math.max(1, containerWidth);
  const safeContainerH = Math.max(1, containerHeight);

  const zoom = Math.min(safeContainerW / safeW, safeContainerH / safeH);
  const centerX = bounds.x + safeW / 2;
  const centerY = bounds.y + safeH / 2;
  const x = safeContainerW / 2 - centerX * zoom;
  const y = safeContainerH / 2 - centerY * zoom;

  return { x, y, zoom };
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

const ARC_STRENGTH_MAP: Record<CanvasZoomArc, number> = {
  none: 0,
  subtle: 0.18,
  medium: 0.35,
  strong: 0.55,
};

/**
 * Computes an interpolated viewport at progress t in [0, 1] with an optional
 * parabolic zoom-out arc between spatially separated slides.
 */
export function computeParabolicViewportAt(
  startVp: Viewport,
  endVp: Viewport,
  t: number,
  containerWidth: number,
  containerHeight: number,
  zoomArc: CanvasZoomArc = 'medium'
): Viewport {
  const clampedT = Math.min(1, Math.max(0, t));
  if (clampedT === 0) return { ...startVp };
  if (clampedT === 1) return { ...endVp };

  const z0 = Math.max(0.05, startVp.zoom || 1);
  const z1 = Math.max(0.05, endVp.zoom || 1);
  const cw = Math.max(1, containerWidth);
  const ch = Math.max(1, containerHeight);

  const startCenterX = (cw / 2 - startVp.x) / z0;
  const startCenterY = (ch / 2 - startVp.y) / z0;
  const endCenterX = (cw / 2 - endVp.x) / z1;
  const endCenterY = (ch / 2 - endVp.y) / z1;

  const worldDist = Math.hypot(endCenterX - startCenterX, endCenterY - startCenterY);
  const avgWorldSpan = (cw / z0 + ch / z0 + cw / z1 + ch / z1) / 4;
  const normalizedDist = avgWorldSpan > 0 ? worldDist / avgWorldSpan : 0;

  const e = easeInOutCubic(clampedT);
  const cx = startCenterX + (endCenterX - startCenterX) * e;
  const cy = startCenterY + (endCenterY - startCenterY) * e;

  const baseLogZ = Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e;
  let zoomDip = 0;
  if (zoomArc !== 'none' && normalizedDist > 0.15) {
    const arcFactor = ARC_STRENGTH_MAP[zoomArc] * Math.min(1.5, normalizedDist * 0.5);
    zoomDip = arcFactor * Math.sin(Math.PI * clampedT);
  }

  const z = Math.max(0.05, Math.exp(baseLogZ - zoomDip));
  return {
    x: cw / 2 - cx * z,
    y: ch / 2 - cy * z,
    zoom: z,
  };
}

export interface AnimateViewportOptions {
  startViewport: Viewport;
  targetViewport: Viewport;
  duration: number;
  containerWidth: number;
  containerHeight: number;
  zoomArc: CanvasZoomArc;
  onUpdate: (vp: Viewport) => void;
  onComplete: () => void;
}

/**
 * Smoothly animates the camera viewport via requestAnimationFrame.
 * Returns a cancel function to abort the animation mid-flight.
 */
export function animateViewportTo(opts: AnimateViewportOptions): () => void {
  const {
    startViewport,
    targetViewport,
    duration,
    containerWidth,
    containerHeight,
    zoomArc,
    onUpdate,
    onComplete,
  } = opts;

  if (duration <= 0 || typeof requestAnimationFrame !== 'function') {
    onUpdate(targetViewport);
    onComplete();
    return () => {};
  }

  let rafId = 0;
  let cancelled = false;
  const startTime = performance.now();

  const tick = (now: number) => {
    if (cancelled) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const vp = computeParabolicViewportAt(
      startViewport,
      targetViewport,
      t,
      containerWidth,
      containerHeight,
      zoomArc
    );
    onUpdate(vp);

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onComplete();
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    }
  };
}

/**
 * Returns the set of node IDs visible on a given slide.
 */
export function getVisibleNodeIdsForSlide(
  slide: CanvasPresentationSlide,
  allNodeIds: string[]
): Set<string> {
  const hiddenSet = new Set(slide.hiddenNodeIds || []);
  const visible = new Set<string>();
  for (const id of allNodeIds) {
    if (!hiddenSet.has(id)) {
      visible.add(id);
    }
  }
  return visible;
}

/**
 * An edge is visible iff both its source and target nodes are visible.
 */
export function isEdgeVisibleForNodes(
  edge: { source: string; target: string },
  visibleNodeIds: Set<string>
): boolean {
  return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
}

/**
 * Computes which nodes remain immediately visible during camera movement
 * and which nodes are newly revealed after the camera arrives.
 */
export function computeSlideTransitionVisibility(
  prevVisibleIds: Set<string> | null,
  targetSlide: CanvasPresentationSlide,
  allNodeIds: string[]
): {
  targetVisibleIds: Set<string>;
  immediateVisibleIds: Set<string>;
  newlyRevealedIds: string[];
} {
  const targetVisibleIds = getVisibleNodeIdsForSlide(targetSlide, allNodeIds);

  if (!prevVisibleIds) {
    return {
      targetVisibleIds,
      immediateVisibleIds: new Set(targetVisibleIds),
      newlyRevealedIds: [],
    };
  }

  const immediateVisibleIds = new Set<string>();
  const newlyRevealedIds: string[] = [];

  for (const id of allNodeIds) {
    if (!targetVisibleIds.has(id)) continue;
    if (prevVisibleIds.has(id)) {
      immediateVisibleIds.add(id);
    } else {
      newlyRevealedIds.push(id);
    }
  }

  return {
    targetVisibleIds,
    immediateVisibleIds,
    newlyRevealedIds,
  };
}
