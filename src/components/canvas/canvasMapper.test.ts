import { describe, it, expect } from 'vitest';
import {
  parseCanvasJson,
  jsonCanvasToReactFlow,
  reactFlowToJsonCanvas,
  getChildNodesInGroup,
} from './canvasMapper';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import type { JsonCanvasDocument, CanvasShape } from '../../../shared/canvasTypes';

describe('Knowmesh Canvas - canvasMapper & State Roundtrip', () => {
  it('1. loads an empty canvas safely without errors', () => {
    const emptyDoc = parseCanvasJson('{ "nodes": [], "edges": [] }');
    expect(emptyDoc.nodes).toEqual([]);
    expect(emptyDoc.edges).toEqual([]);

    const rf = jsonCanvasToReactFlow(emptyDoc);
    expect(rf.nodes).toEqual([]);
    expect(rf.edges).toEqual([]);
  });

  it('2. adds multiple nodes (rectangle, diamond, server, file) and connects an edge', () => {
    const rawDoc: JsonCanvasDocument = {
      nodes: [
        {
          id: 'node-rect-1',
          type: 'text',
          shape: 'rectangle',
          x: 100,
          y: 120,
          width: 260,
          height: 160,
          text: '# Start Process\nThis is a standard process step.',
          color: '4', // Green
        },
        {
          id: 'node-diamond-2',
          type: 'text',
          shape: 'diamond',
          x: 420,
          y: 120,
          width: 180,
          height: 140,
          text: 'Is Valid?',
          color: '3', // Yellow
        },
        {
          id: 'node-server-3',
          type: 'text',
          shape: 'server',
          x: 700,
          y: 120,
          width: 200,
          height: 160,
          text: 'Database Primary Host',
          color: '5', // Cyan
        },
        {
          id: 'node-file-4',
          type: 'file',
          file: 'Projekte/Architektur.md',
          x: 420,
          y: 350,
          width: 320,
          height: 240,
        },
      ],
      edges: [
        {
          id: 'edge-1-to-2',
          fromNode: 'node-rect-1',
          fromSide: 'right',
          toNode: 'node-diamond-2',
          toSide: 'left',
          label: 'proceed',
          edgeStyle: 'straight',
        },
      ],
      viewport: { x: 50, y: 75, zoom: 1.2 },
    };

    const rf = jsonCanvasToReactFlow(rawDoc);
    expect(rf.nodes).toHaveLength(4);
    expect(rf.edges).toHaveLength(1);
    expect(rf.viewport).toEqual({ x: 50, y: 75, zoom: 1.2 });

    // Verify node properties
    const rectNode = rf.nodes.find((n) => n.id === 'node-rect-1');
    expect(rectNode).toBeDefined();
    expect(rectNode?.type).toBe('canvasShape');
    expect(rectNode?.position).toEqual({ x: 100, y: 120 });
    expect(rectNode?.width).toBe(260);
    expect(rectNode?.height).toBe(160);
    expect(rectNode?.style?.width).toBe('260px');
    expect(rectNode?.style?.height).toBe('160px');
    expect(rectNode?.data.shape).toBe('rectangle');
    expect(rectNode?.data.color).toBe('4');

    const diamondNode = rf.nodes.find((n) => n.id === 'node-diamond-2');
    expect(diamondNode?.data.shape).toBe('diamond');

    const serverNode = rf.nodes.find((n) => n.id === 'node-server-3');
    expect(serverNode?.data.shape).toBe('server');

    const fileNode = rf.nodes.find((n) => n.id === 'node-file-4');
    expect(fileNode?.type).toBe('canvasFile');
    expect(fileNode?.data.file).toBe('Projekte/Architektur.md');

    // Verify edge properties
    const edge = rf.edges[0];
    expect(edge.source).toBe('node-rect-1');
    expect(edge.target).toBe('node-diamond-2');
    expect(edge.sourceHandle).toBe('right');
    expect(edge.targetHandle).toBe('left');
    expect(edge.label).toBe('proceed');
    expect(edge.type).toBe('straight');
  });

  it('3. serializes to JSON Canvas and deserializes back preserving positions, dimensions and shapes', () => {
    const inputNodes: Node[] = [
      {
        id: 'node-proc',
        type: 'canvasShape',
        position: { x: 220, y: 180 },
        width: 260,
        height: 160,
        style: { width: '260px', height: '160px' },
        data: {
          rawType: 'text',
          text: 'Process Step',
          shape: 'rounded' as CanvasShape,
          color: '1',
        },
      },
      {
        id: 'node-decision',
        type: 'canvasShape',
        position: { x: 560, y: 180 },
        width: 180,
        height: 140,
        style: { width: '180px', height: '140px' },
        data: {
          rawType: 'text',
          text: 'Check Condition',
          shape: 'diamond' as CanvasShape,
          color: '2',
        },
      },
      {
        id: 'node-router',
        type: 'canvasShape',
        position: { x: 820, y: 180 },
        width: 200,
        height: 150,
        style: { width: '200px', height: '150px' },
        data: {
          rawType: 'text',
          text: 'Core Gateway',
          shape: 'router' as CanvasShape,
        },
      },
      {
        id: 'node-vault-file',
        type: 'canvasFile',
        position: { x: 400, y: 400 },
        width: 340,
        height: 280,
        style: { width: '340px', height: '280px' },
        data: {
          rawType: 'file',
          file: 'Guides/Network.md',
        },
      },
    ];

    const inputEdges: Edge[] = [
      {
        id: 'edge-proc-decision',
        source: 'node-proc',
        target: 'node-decision',
        sourceHandle: 'right',
        targetHandle: 'left',
        label: 'valid',
        type: 'smoothstep',
        data: {
          edgeStyle: 'step',
          toEnd: 'arrow',
        },
      },
    ];

    const vp = { x: -50, y: -20, zoom: 1.5 };

    // Serialize to JSON Canvas string
    const jsonCanvasStr = reactFlowToJsonCanvas(inputNodes, inputEdges, vp);
    expect(jsonCanvasStr).toContain('"node-proc"');
    expect(jsonCanvasStr).toContain('"node-decision"');
    expect(jsonCanvasStr).toContain('"node-router"');
    expect(jsonCanvasStr).toContain('"node-vault-file"');

    // Parse back
    const parsedDoc = parseCanvasJson(jsonCanvasStr);
    expect(parsedDoc.nodes).toHaveLength(4);
    expect(parsedDoc.edges).toHaveLength(1);
    expect(parsedDoc.viewport).toEqual({ x: -50, y: -20, zoom: 1.5 });

    const roundtrip = jsonCanvasToReactFlow(parsedDoc);
    expect(roundtrip.nodes).toHaveLength(4);
    expect(roundtrip.edges).toHaveLength(1);

    // Verify all attributes match exactly
    const proc = roundtrip.nodes.find((n) => n.id === 'node-proc');
    expect(proc?.position).toEqual({ x: 220, y: 180 });
    expect(proc?.width).toBe(260);
    expect(proc?.height).toBe(160);
    expect(proc?.style?.width).toBe('260px');
    expect(proc?.style?.height).toBe('160px');
    expect(proc?.data.shape).toBe('rounded');
    expect(proc?.data.color).toBe('1');

    const decision = roundtrip.nodes.find((n) => n.id === 'node-decision');
    expect(decision?.position).toEqual({ x: 560, y: 180 });
    expect(decision?.data.shape).toBe('diamond');

    const router = roundtrip.nodes.find((n) => n.id === 'node-router');
    expect(router?.data.shape).toBe('router');

    const file = roundtrip.nodes.find((n) => n.id === 'node-vault-file');
    expect(file?.data.file).toBe('Guides/Network.md');
    expect(file?.width).toBe(340);
    expect(file?.height).toBe(280);

    const edge = roundtrip.edges[0];
    expect(edge.source).toBe('node-proc');
    expect(edge.target).toBe('node-decision');
    expect(edge.sourceHandle).toBe('right');
    expect(edge.targetHandle).toBe('left');
    expect(edge.label).toBe('valid');
  });

  it('4. calculates safe centered spawn positions without NaN or offset anomalies', () => {
    // Simulating getCenterSpawnPosition math
    const calculateSpawn = (
      nodeW: number,
      nodeH: number,
      count: number,
      vp: { x: number; y: number; zoom: number },
      container: { width: number; height: number }
    ) => {
      const safeZoom = vp.zoom > 0 ? vp.zoom : 1;
      const centerX = Math.round((-vp.x + container.width / 2) / safeZoom - nodeW / 2);
      const centerY = Math.round((-vp.y + container.height / 2) / safeZoom - nodeH / 2);
      const offset = (count % 8) * 24;
      return {
        x: isNaN(centerX) ? 100 + offset : centerX + offset,
        y: isNaN(centerY) ? 100 + offset : centerY + offset,
      };
    };

    // Standard container (1200 x 800), default viewport (0, 0, 1), node 260 x 160
    const spawn0 = calculateSpawn(260, 160, 0, { x: 0, y: 0, zoom: 1 }, { width: 1200, height: 800 });
    // Center of container is (600, 400). Node half is (130, 80). Expected: (470, 320)
    expect(spawn0).toEqual({ x: 470, y: 320 });

    // Second node added (count = 1) -> offset +24px
    const spawn1 = calculateSpawn(260, 160, 1, { x: 0, y: 0, zoom: 1 }, { width: 1200, height: 800 });
    expect(spawn1).toEqual({ x: 494, y: 344 });

    // Panned & zoomed viewport (x: -200, y: -100, zoom: 2)
    const spawnZoom = calculateSpawn(260, 160, 0, { x: -200, y: -100, zoom: 2 }, { width: 1200, height: 800 });
    // -vp.x + 600 = 800. / 2 = 400. - 130 = 270.
    // -vp.y + 400 = 500. / 2 = 250. - 80 = 170.
    expect(spawnZoom).toEqual({ x: 270, y: 170 });

    // Fallback on zero / NaN
    const spawnFallback = calculateSpawn(260, 160, 0, { x: NaN, y: NaN, zoom: 0 }, { width: 0, height: 0 });
    expect(spawnFallback.x).not.toBeNaN();
    expect(spawnFallback.y).not.toBeNaN();
    expect(spawnFallback).toEqual({ x: 100, y: 100 });
  });

  it('5. correctly identifies child nodes inside a group node via getChildNodesInGroup', () => {
    const groupNode: Node = {
      id: 'group-1',
      type: 'canvasGroup',
      position: { x: 100, y: 100 },
      width: 400,
      height: 300,
      data: { rawType: 'group', label: 'Backend Cluster' },
    };

    const nodeInsideA: Node = {
      id: 'node-inside-a',
      type: 'canvasShape',
      position: { x: 120, y: 120 },
      width: 100,
      height: 60,
      data: { rawType: 'text' },
    };

    const nodeInsideB: Node = {
      id: 'node-inside-b',
      type: 'canvasFile',
      position: { x: 250, y: 220 },
      width: 120,
      height: 80,
      data: { rawType: 'file' },
    };

    const nodeOutside: Node = {
      id: 'node-outside',
      type: 'canvasShape',
      position: { x: 600, y: 200 },
      width: 120,
      height: 80,
      data: { rawType: 'text' },
    };

    const otherGroup: Node = {
      id: 'group-2',
      type: 'canvasGroup',
      position: { x: 150, y: 150 },
      width: 200,
      height: 150,
      data: { rawType: 'group' },
    };

    const allNodes = [groupNode, nodeInsideA, nodeInsideB, nodeOutside, otherGroup];
    const childIds = getChildNodesInGroup(groupNode, allNodes);

    expect(childIds).toContain('node-inside-a');
    expect(childIds).toContain('node-inside-b');
    expect(childIds).not.toContain('node-outside');
    expect(childIds).not.toContain('group-1'); // Group should not contain itself
    expect(childIds).not.toContain('group-2'); // Other groups should not be included
    expect(childIds).toHaveLength(2);
  });

  it('6. preserves edge arrow direction deterministically (toEnd & fromEnd)', () => {
    // Test: edge with arrow on target side only
    const docWithTargetArrow: JsonCanvasDocument = {
      nodes: [
        { id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 50 },
        { id: 'n2', type: 'text', x: 200, y: 0, width: 100, height: 50 },
      ],
      edges: [
        {
          id: 'e1',
          fromNode: 'n1',
          toNode: 'n2',
          fromEnd: 'none',
          toEnd: 'arrow',
        },
      ],
    };

    const rf = jsonCanvasToReactFlow(docWithTargetArrow);
    const rfEdge = rf.edges[0];
    expect(rfEdge.source).toBe('n1');
    expect(rfEdge.target).toBe('n2');
    expect(rfEdge.markerEnd).toBeDefined();
    expect((rfEdge.markerEnd as any)?.type).toBe(MarkerType.ArrowClosed);
    expect(rfEdge.markerStart).toBeUndefined();

    // Roundtrip back to JSON Canvas
    const jsonStr = reactFlowToJsonCanvas(rf.nodes, rf.edges);
    const parsed = parseCanvasJson(jsonStr);
    expect(parsed.edges[0].fromNode).toBe('n1');
    expect(parsed.edges[0].toNode).toBe('n2');
    expect(parsed.edges[0].toEnd).toBe('arrow');
    expect(parsed.edges[0].fromEnd).toBe('none');

    // Test: edge with arrow on source side (fromEnd: arrow, toEnd: none)
    const docWithSourceArrow: JsonCanvasDocument = {
      nodes: [
        { id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 50 },
        { id: 'n2', type: 'text', x: 200, y: 0, width: 100, height: 50 },
      ],
      edges: [
        {
          id: 'e2',
          fromNode: 'n1',
          toNode: 'n2',
          fromEnd: 'arrow',
          toEnd: 'none',
        },
      ],
    };

    const rfSource = jsonCanvasToReactFlow(docWithSourceArrow);
    const rfSourceEdge = rfSource.edges[0];
    expect(rfSourceEdge.markerEnd).toBeUndefined();
    expect(rfSourceEdge.markerStart).toBeDefined();
    expect((rfSourceEdge.markerStart as any)?.type).toBe(MarkerType.ArrowClosed);

    const jsonStrSource = reactFlowToJsonCanvas(rfSource.nodes, rfSource.edges);
    const parsedSource = parseCanvasJson(jsonStrSource);
    expect(parsedSource.edges[0].fromEnd).toBe('arrow');
    expect(parsedSource.edges[0].toEnd).toBe('none');
  });
});
