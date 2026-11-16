import {
  extractMatchSnippet,
  findRegexMatchesInText,
  parseSearchQuery,
  scoreSearchMatch,
  type SearchScope,
  type SearchSortMode,
  type SnippetRange,
} from '../../shared/searchEngine';

export type { SearchScope, SearchSortMode, SnippetRange };

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
  score?: number;
}

export interface FullTextNoteHit {
  path: string;
  name: string;
  folder: string;
  matchCount: number;
  snippet: string;
  matchStartInSnippet: number;
  matchEndInSnippet: number;
  ranges: SnippetRange[];
  score: number;
  mtime: number;
}

/**
 * Finds all matches of `query` in `text` using the unified SearchEngine
 * (whole-word default, * wildcards, +/- boolean operators, and "phrases").
 */
export function findInNoteMatches(text: string, query: string): InNoteMatch[] {
  const parsed = parseSearchQuery(query);
  if (!parsed.hasTerms || parsed.required.length === 0 || !text) return [];

  const spans = findRegexMatchesInText(text, parsed);
  if (spans.length === 0) return [];

  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }

  const matches: InNoteMatch[] = [];
  let lineIdx = 0;

  for (const span of spans) {
    while (lineIdx + 1 < lineStarts.length && lineStarts[lineIdx + 1] <= span.from) {
      lineIdx++;
    }
    const lineStart = lineStarts[lineIdx];
    const nextLineStart =
      lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] - 1 : text.length;
    const lineText = text.slice(lineStart, nextLineStart).replace(/\r$/, '');
    const matchStartInLine = span.from - lineStart;
    const matchEndInLine = Math.min(lineText.length, span.to - lineStart);

    matches.push({
      index: matches.length,
      from: span.from,
      to: span.to,
      line: lineIdx + 1,
      lineText,
      matchStartInLine,
      matchEndInLine,
    });
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
 * Searches vault files (.md, .canvas, .base, etc.) by filename and folder path
 * with whole-word default, wildcards, boolean operators, and relevance ranking.
 */
export function searchVaultFiles(
  files: Array<{ path: string; name?: string; folder?: string; extension?: string; mtime?: number }>,
  query: string,
  limit = 60
): FileSearchHit[] {
  const parsed = parseSearchQuery(query);
  const scored: Array<FileSearchHit & { _score: number }> = [];
  const nowMs = Date.now();

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

    if (!parsed.hasTerms) {
      scored.push({
        path: f.path,
        name: fileName,
        folder,
        extension: ext,
        _score: f.mtime ?? 0,
      });
      continue;
    }

    const score = scoreSearchMatch(
      { path: f.path, name: fileName, mtime: f.mtime },
      parsed,
      nowMs
    );
    if (score !== null) {
      scored.push({
        path: f.path,
        name: fileName,
        folder,
        extension: ext,
        score,
        _score: score,
      });
    }
  }

  if (parsed.hasTerms) {
    scored.sort((a, b) => b._score - a._score || a.name.localeCompare(b.name));
  }

  return scored.slice(0, limit).map(({ _score: _, ...hit }) => hit);
}

/**
 * Performs offline full-text search across cached notes (e.g. from IndexedDB)
 * using the unified SearchEngine with relevance scoring or newest-first sorting.
 */
export function searchNotesFullTextOffline(
  notes: Array<{
    path: string;
    name?: string;
    body: string;
    tags?: string[];
    properties?: Array<{ key: string; value: unknown }>;
    updatedAt?: number;
    mtime?: number;
  }>,
  query: string,
  limit = 50,
  sort: SearchSortMode = 'relevance'
): FullTextNoteHit[] {
  const parsed = parseSearchQuery(query);
  if (!parsed.hasTerms) return [];

  const nowMs = Date.now();
  const hits: FullTextNoteHit[] = [];

  for (const note of notes) {
    if (note.path.toLowerCase().endsWith('.zenc') || note.path.endsWith('.zuber-lock.json')) continue;
    const body = note.body || '';
    const mtime = note.mtime ?? note.updatedAt ?? 0;

    const aliasProp = note.properties?.find(
      (p) => p.key.toLowerCase() === 'aliases' || p.key.toLowerCase() === 'alias'
    );
    const aliases = Array.isArray(aliasProp?.value)
      ? aliasProp!.value.map(String)
      : typeof aliasProp?.value === 'string'
        ? [aliasProp.value]
        : [];
    const frontmatterText = (note.properties || [])
      .filter((p) => !p.key.startsWith('_'))
      .map((p) => `${p.key}: ${Array.isArray(p.value) ? p.value.join(', ') : String(p.value ?? '')}`)
      .join('\n');

    const score = scoreSearchMatch(
      {
        path: note.path,
        name: note.name,
        body,
        tags: note.tags,
        aliases,
        frontmatterText,
        mtime,
      },
      parsed,
      nowMs
    );

    if (score === null) continue;

    const matchSpans = findRegexMatchesInText(`${note.name || ''}\n${body}`, parsed);
    const snippetRes = extractMatchSnippet(body, parsed, 120);
    const firstRange = snippetRes.ranges[0];

    const fileName = (note.name || note.path.split('/').pop() || note.path).replace(/\.md$/i, '');
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/'))
      : '';

    hits.push({
      path: note.path,
      name: fileName,
      folder,
      matchCount: Math.max(1, matchSpans.length),
      snippet: snippetRes.snippet,
      matchStartInSnippet: firstRange ? firstRange.start : 0,
      matchEndInSnippet: firstRange ? firstRange.end : 0,
      ranges: snippetRes.ranges,
      score,
      mtime,
    });
  }

  if (sort === 'newest') {
    hits.sort((a, b) => b.mtime - a.mtime || b.score - a.score || a.name.localeCompare(b.name));
  } else {
    hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.name.localeCompare(b.name));
  }
  return hits.slice(0, limit);
}
