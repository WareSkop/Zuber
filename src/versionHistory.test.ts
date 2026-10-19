import { describe, it, expect } from 'vitest';
import { computeLineDiff } from './components/VersionHistoryModal';

describe('computeLineDiff (LCS Line Diff Engine)', () => {
  it('handles empty inputs', () => {
    expect(computeLineDiff('', '')).toEqual([]);
  });

  it('handles pure additions to empty old content', () => {
    const diff = computeLineDiff('', 'line 1\nline 2');
    expect(diff).toEqual([
      { type: 'added', newLineNumber: 1, content: 'line 1' },
      { type: 'added', newLineNumber: 2, content: 'line 2' },
    ]);
  });

  it('handles pure deletions from new content', () => {
    const diff = computeLineDiff('line 1\nline 2', '');
    expect(diff).toEqual([
      { type: 'removed', oldLineNumber: 1, content: 'line 1' },
      { type: 'removed', oldLineNumber: 2, content: 'line 2' },
    ]);
  });

  it('handles identical content', () => {
    const diff = computeLineDiff('same 1\nsame 2', 'same 1\nsame 2');
    expect(diff).toEqual([
      { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'same 1' },
      { type: 'unchanged', oldLineNumber: 2, newLineNumber: 2, content: 'same 2' },
    ]);
  });

  it('correctly calculates mixed additions, removals, and unchanged lines', () => {
    const oldText = 'Alpha\nBeta\nGamma\nDelta';
    const newText = 'Alpha\nBeta Modified\nDelta\nEpsilon';

    const diff = computeLineDiff(oldText, newText);

    // Alpha is unchanged
    expect(diff[0]).toEqual({
      type: 'unchanged',
      oldLineNumber: 1,
      newLineNumber: 1,
      content: 'Alpha',
    });

    // Beta removed, Beta Modified added, Gamma removed
    const types = diff.map((d) => d.type);
    expect(types).toContain('unchanged');
    expect(types).toContain('removed');
    expect(types).toContain('added');

    // Last line Epsilon added
    expect(diff[diff.length - 1]).toEqual({
      type: 'added',
      newLineNumber: 4,
      content: 'Epsilon',
    });
  });

  it('normalizes CRLF (\\r\\n) carriage returns', () => {
    const oldText = 'Line 1\r\nLine 2\r\n';
    const newText = 'Line 1\nLine 2\n';
    const diff = computeLineDiff(oldText, newText);
    expect(diff.every((d) => d.type === 'unchanged')).toBe(true);
  });
});
