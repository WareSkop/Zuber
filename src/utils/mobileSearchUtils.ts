export type SearchScope = 'in-note' | 'files' | 'fulltext' | 'settings';

export interface InNoteMatch {
  index: number;
  from: number;
  to: number;
  line: number;
  lineText: string;
  matchStartInLine: number;
  matchEndInLine: number;
}

export interface FileSearchHit {
  path: string;
  name: string;
  folder: string;
  extension: string;
}

export interface FullTextNoteHit {
  path: string;
  name: string;
  folder: string;
  matchCount: number;
  snippet: string;
  matchStartInSnippet: number;
  matchEndInSnippet: number;
}

/**
 * Finds all case-insensitive occurrences of `query` in `text`, returning
 * exact character offsets and 1-based line metadata for previews and jumping.
 */
export function findInNoteMatches(text: string, query: string): InNoteMatch[] {
  const q = query.trim();
  if (!q || !text) return [];

  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  const qLen = lowerQuery.length;

  // Precompute line start offsets for O(log L) or single-pass line lookup
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  const matches: InNoteMatch[] = [];
  let pos = 0;
  let lineIdx = 0;

  while (pos <= lowerText.length - qLen) {
    const found = lowerText.indexOf(lowerQuery, pos);
    if (found === -1) break;

    while (lineIdx + 1 < lineStarts.length && lineStarts[lineIdx + 1] <= found) {
      lineIdx++;
    }

    const lineStart = lineStarts[lineIdx];
    const nextLineStart =
      lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] - 1 : text.length;
    const lineText = text.slice(lineStart, nextLineStart).replace(/\r$/, '');
    const matchStartInLine = found - lineStart;
    const matchEndInLine = Math.min(lineText.length, matchStartInLine + qLen);

    matches.push({
      index: matches.length,
      from: found,
      to: found + qLen,
      line: lineIdx + 1,
      lineText,
      matchStartInLine,
      matchEndInLine,
    });

    pos = found + qLen;
  }

  return matches;
}

/**
 * Wraps match index seamlessly for Next (+1) and Previous (-1) navigation.
 */
export function wrapMatchIndex(
  currentIndex: number,
  delta: 1 | -1,
  total: number
): number {
  if (total <= 0) return 0;
  return (((currentIndex + delta) % total) + total) % total;
}

/**
 * Searches vault files (.md, .canvas, .base, etc.) by filename and folder path.
 */
export function searchVaultFiles(
  files: Array<{ path: string; name?: string; folder?: string; extension?: string }>,
  query: string,
  limit = 60
): FileSearchHit[] {
  const q = query.trim().toLowerCase();
  const results: FileSearchHit[] = [];

  for (const f of files) {
    const fileName = f.name || f.path.split('/').pop() || f.path;
    if (fileName === '.zuber-lock.json') continue;
    const folder =
      f.folder !== undefined
        ? f.folder
        : f.path.includes('/')
          ? f.path.slice(0, f.path.lastIndexOf('/'))
          : '';
    const ext =
      f.extension ||
      (fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : 'md');

    if (!q || f.path.toLowerCase().includes(q) || fileName.toLowerCase().includes(q)) {
      results.push({
        path: f.path,
        name: fileName,
        folder,
        extension: ext,
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}

/**
 * Performs offline full-text search across an array of cached notes (e.g. from IndexedDB).
 */
export function searchNotesFullTextOffline(
  notes: Array<{ path: string; name?: string; body: string }>,
  query: string,
  limit = 50
): FullTextNoteHit[] {
  const q = query.trim();
  if (!q) return [];

  const lowerQuery = q.toLowerCase();
  const qLen = lowerQuery.length;
  const hits: FullTextNoteHit[] = [];

  for (const note of notes) {
    if (note.path.toLowerCase().endsWith('.zenc') || note.path.endsWith('.zuber-lock.json')) continue;
    const body = note.body || '';
    const lowerBody = body.toLowerCase();
    const firstIdx = lowerBody.indexOf(lowerQuery);
    if (firstIdx === -1) continue;

    let count = 1;
    let searchPos = firstIdx + qLen;
    while (searchPos <= lowerBody.length - qLen) {
      const nextIdx = lowerBody.indexOf(lowerQuery, searchPos);
      if (nextIdx === -1) break;
      count++;
      searchPos = nextIdx + qLen;
    }

    // Build a clean snippet around the first match
    const snippetRadius = 48;
    const rawStart = Math.max(0, firstIdx - snippetRadius);
    const rawEnd = Math.min(body.length, firstIdx + qLen + snippetRadius);
    const prefixEllipsis = rawStart > 0 ? '…' : '';
    const suffixEllipsis = rawEnd < body.length ? '…' : '';
    const rawSlice = body.slice(rawStart, rawEnd).replace(/[\r\n]+/g, ' ');
    const snippet = `${prefixEllipsis}${rawSlice}${suffixEllipsis}`;
    const matchStartInSnippet = prefixEllipsis.length + (firstIdx - rawStart);
    const matchEndInSnippet = matchStartInSnippet + qLen;

    const fileName = (note.name || note.path.split('/').pop() || note.path).replace(/\.md$/i, '');
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/'))
      : '';

    hits.push({
      path: note.path,
      name: fileName,
      folder,
      matchCount: count,
      snippet,
      matchStartInSnippet,
      matchEndInSnippet,
    });
  }

  hits.sort((a, b) => b.matchCount - a.matchCount || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
