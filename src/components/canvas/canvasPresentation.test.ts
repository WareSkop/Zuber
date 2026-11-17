import { describe, it, expect } from 'vitest';
import {
  parseCanvasJson,
  jsonCanvasToReactFlow,
  reactFlowToJsonCanvas,
  DEFAULT_PRESENTATION_CONFIG,
  prunePresentationNodeIds,
} from './canvasMapper';
import {
  captureViewportBounds,
  boundsToViewport,
  computeParabolicViewportAt,
  getVisibleNodeIdsForSlide,
  isEdgeVisibleForNodes,
  computeSlideTransitionVisibility,
} from './canvasPresentationUtils';
import type { CanvasPresentation, JsonCanvasDocument } from '../../../shared/canvasTypes';

describe('Canvas Presentation Mode - Schema, Serialization & Math', () => {
  it('1. parses partial presentation config with safe defaults and preserves it on roundtrip', () => {
    const rawJson = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'text', x: 0, y: 0, width: 200, height: 120, text: 'Slide 1' },
        { id: 'n2', type: 'text', x: 400, y: 0, width: 200, height: 120, text: 'Slide 2' },
      ],
      edges: [
        { id: 'e1', fromNode: 'n1', toNode: 'n2' },
      ],
      presentation: {
        config: {
          zoomDuration: 1200,
          // Missing zoomArc, revealDuration, revealDelay, staggerDelay
        },
        slides: [
          {
            id: 's1',
            title: 'Intro',
            bounds: { x: -50, y: -50, width: 400, height: 300 },
            hiddenNodeIds: ['n2'],
          },
          {
            id: 's2',
            title: 'Detail',
            bounds: { x: 350, y: -50, width: 400, height: 300 },
            hiddenNodeIds: [],
            zoomDuration: 600,
          },
        ],
      },
    });

    const doc = parseCanvasJson(rawJson);
    expect(doc.presentation).toBeDefined();
    expect(doc.presentation?.config).toEqual({
      zoomDuration: 1200,
      zoomArc: DEFAULT_PRESENTATION_CONFIG.zoomArc,
      revealDuration: DEFAULT_PRESENTATION_CONFIG.revealDuration,
      revealDelay: DEFAULT_PRESENTATION_CONFIG.revealDelay,
      staggerDelay: DEFAULT_PRESENTATION_CONFIG.staggerDelay,
    });

    const rf = jsonCanvasToReactFlow(doc);
    expect(rf.presentation?.slides).toHaveLength(2);
    expect(rf.presentation?.slides[0].hiddenNodeIds).toEqual(['n2']);
    expect(rf.presentation?.slides[1].zoomDuration).toBe(600);

    // Regular node/edge edit save preserves presentation
    const savedJson = reactFlowToJsonCanvas(rf.nodes, rf.edges, rf.viewport, rf.presentation);
    const reparsed = JSON.parse(savedJson) as JsonCanvasDocument;
    expect(reparsed.presentation).toBeDefined();
    expect(reparsed.presentation?.config.zoomDuration).toBe(1200);
    expect(reparsed.presentation?.slides).toHaveLength(2);
    expect(reparsed.presentation?.slides[0].hiddenNodeIds).toEqual(['n2']);
  });

  it('2. prunes deleted node IDs from slide.hiddenNodeIds across all slides', () => {
    const presentation: CanvasPresentation = {
      config: { ...DEFAULT_PRESENTATION_CONFIG },
      slides: [
        {
          id: 's1',
          title: 'Slide 1',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          hiddenNodeIds: ['n1', 'n2', 'n3'],
        },
        {
          id: 's2',
          title: 'Slide 2',
          bounds: { x: 100, y: 100, width: 800, height: 600 },
          hiddenNodeIds: ['n2'],
        },
      ],
    };

    const pruned = prunePresentationNodeIds(presentation, new Set(['n1', 'n3']));
    expect(pruned.slides[0].hiddenNodeIds).toEqual(['n1', 'n3']);
    expect(pruned.slides[1].hiddenNodeIds).toEqual([]);

    // Also verify via reactFlowToJsonCanvas when n2 is removed from nodes
    const rf = jsonCanvasToReactFlow({
      nodes: [
        { id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'A' },
        { id: 'n3', type: 'text', x: 200, y: 0, width: 100, height: 100, text: 'C' },
      ],
      edges: [],
      presentation,
    });
    const saved = JSON.parse(
      reactFlowToJsonCanvas(rf.nodes, rf.edges, undefined, rf.presentation)
    ) as JsonCanvasDocument;
    expect(saved.presentation?.slides[0].hiddenNodeIds).toEqual(['n1', 'n3']);
    expect(saved.presentation?.slides[1].hiddenNodeIds).toEqual([]);
  });

  it('3. guarantees identical world-space framing across 1920x1080 and 3840x2160 (4K)', () => {
    // Capture on 1920x1080
    const captured = captureViewportBounds({ x: -240, y: -480, zoom: 2.4 }, 1920, 1080);
    expect(captured.x).toBeCloseTo(100, 5);
    expect(captured.y).toBeCloseTo(200, 5);
    expect(captured.width).toBeCloseTo(800, 5);
    expect(captured.height).toBeCloseTo(450, 5);

    // Restore on 1920x1080
    const vp1080 = boundsToViewport(captured, 1920, 1080);
    expect(vp1080.zoom).toBeCloseTo(2.4, 5);
    expect(vp1080.x).toBeCloseTo(-240, 5);
    expect(vp1080.y).toBeCloseTo(-480, 5);

    // Restore on 3840x2160 (4K) -> zoom doubles, world rect stays identical
    const vp4k = boundsToViewport(captured, 3840, 2160);
    expect(vp4k.zoom).toBeCloseTo(4.8, 5);
    expect(vp4k.x).toBeCloseTo(-480, 5);
    expect(vp4k.y).toBeCloseTo(-960, 5);

    const visibleWorldOn4k = captureViewportBounds(vp4k, 3840, 2160);
    expect(visibleWorldOn4k.x).toBeCloseTo(captured.x, 5);
    expect(visibleWorldOn4k.y).toBeCloseTo(captured.y, 5);
    expect(visibleWorldOn4k.width).toBeCloseTo(captured.width, 5);
    expect(visibleWorldOn4k.height).toBeCloseTo(captured.height, 5);
  });

  it('4. computes parabolic camera zoom-out arc between distant slides', () => {
    const startVp = { x: 0, y: 0, zoom: 1 };
    const endVp = { x: -3000, y: -1500, zoom: 1 };

    expect(computeParabolicViewportAt(startVp, endVp, 0, 1200, 800, 'medium')).toEqual(startVp);
    expect(computeParabolicViewportAt(startVp, endVp, 1, 1200, 800, 'medium')).toEqual(endVp);

    const midWithArc = computeParabolicViewportAt(startVp, endVp, 0.5, 1200, 800, 'medium');
    const midNoArc = computeParabolicViewportAt(startVp, endVp, 0.5, 1200, 800, 'none');

    // With arc, camera zooms out mid-flight (smaller zoom than endpoints)
    expect(midWithArc.zoom).toBeLessThan(1);
    expect(midNoArc.zoom).toBeCloseTo(1, 5);
  });

  it('5. computes slide visibility, progressive reveal diff, and automatic edge visibility', () => {
    const allNodeIds = ['n1', 'n2', 'n3'];
    const slide1 = {
      id: 's1',
      title: 'S1',
      bounds: { x: 0, y: 0, width: 500, height: 400 },
      hiddenNodeIds: ['n2', 'n3'],
    };
    const slide2 = {
      id: 's2',
      title: 'S2',
      bounds: { x: 200, y: 0, width: 500, height: 400 },
      hiddenNodeIds: ['n3'],
    };

    const vis1 = getVisibleNodeIdsForSlide(slide1, allNodeIds);
    expect(Array.from(vis1)).toEqual(['n1']);

    // Edge n1 -> n2 is hidden on slide 1 because n2 is hidden
    expect(isEdgeVisibleForNodes({ source: 'n1', target: 'n2' }, vis1)).toBe(false);

    // Transition from slide 1 -> slide 2: n1 stays immediately visible, n2 is newly revealed
    const transition = computeSlideTransitionVisibility(vis1, slide2, allNodeIds);
    expect(Array.from(transition.immediateVisibleIds)).toEqual(['n1']);
    expect(transition.newlyRevealedIds).toEqual(['n2']);
    expect(Array.from(transition.targetVisibleIds)).toEqual(['n1', 'n2']);

    // Once n2 reveals, edge n1 -> n2 becomes visible, while n2 -> n3 stays hidden
    expect(isEdgeVisibleForNodes({ source: 'n1', target: 'n2' }, transition.targetVisibleIds)).toBe(true);
    expect(isEdgeVisibleForNodes({ source: 'n2', target: 'n3' }, transition.targetVisibleIds)).toBe(false);
  });
});
