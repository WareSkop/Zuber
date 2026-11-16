export type SearchScope = 'in-note' | 'files' | 'fulltext' | 'settings';
export type SearchSortMode = 'relevance' | 'newest';

export interface SearchTermMatcher {
  raw: string;
  rawLower: string;
  isPhrase: boolean;
  hasWildcard: boolean;
  negated: boolean;
  regex: RegExp;
  wholeWordRegex?: RegExp;
}

export interface ParsedSearchQuery {
  rawQuery: string;
  required: SearchTermMatcher[];
  excluded: SearchTermMatcher[];
  hasTerms: boolean;
}

export interface SearchableDoc {
  path: string;
  name?: string;
  body?: string;
  tags?: string[];
  aliases?: string[];
  frontmatterText?: string;
  mtime?: number;
}

export interface SnippetRange {
  start: number;
  end: number;
}

export interface MatchSnippetResult {
  snippet: string;
  line: number;
  ranges: SnippetRange[];
}

function escapeRegexExceptWildcard(input: string): string {
  return input.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardWordToPattern(token: string): string {
  const escaped = escapeRegexExceptWildcard(token);
  const hasWildcard = token.includes('*');
  const patternBody = escaped.replace(/\*/g, '[\\p{L}\\p{N}_-]*');
  const prefix = token.startsWith('*') ? '' : '(?<![\\p{L}\\p{N}])';
  const suffix = token.endsWith('*') ? '' : '(?![\\p{L}\\p{N}])';
  return hasWildcard ? `${prefix}${patternBody}${suffix}` : `(?<![\\p{L}\\p{N}])${patternBody}(?![\\p{L}\\p{N}])`;
}

function buildMatcher(rawToken: string, isPhrase: boolean, negated: boolean): SearchTermMatcher | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  let pattern: string;
  let wholeWordRegex: RegExp | undefined;
  const hasWildcard = trimmed.includes('*');

  if (isPhrase) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const inner = words.map((w) => escapeRegexExceptWildcard(w).replace(/\*/g, '[\\p{L}\\p{N}_-]*')).join('\\s+');
    const startsWild = words[0].startsWith('*');
    const endsWild = words[words.length - 1].endsWith('*');
    pattern = `${startsWild ? '' : '(?<![\\p{L}\\p{N}])'}${inner}${endsWild ? '' : '(?![\\p{L}\\p{N}])'}`;
    if (!hasWildcard) {
      wholeWordRegex = new RegExp(pattern, 'giu');
    }
  } else {
    pattern = wildcardWordToPattern(trimmed);
    if (!hasWildcard) {
      wholeWordRegex = new RegExp(pattern, 'giu');
    }
  }

  try {
    const regex = new RegExp(pattern, 'giu');
    return {
      raw: trimmed,
      rawLower: trimmed.toLowerCase(),
      isPhrase,
      hasWildcard,
      negated,
      regex,
      wholeWordRegex,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a search query supporting:
 * - Quoted phrases: "exact phrase"
 * - Boolean operators: +required, -excluded, implicit AND on whitespace
 * - Whole-word default with Unicode boundaries, or * wildcards
 */
export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) {
    return { rawQuery: '', required: [], excluded: [], hasTerms: false };
  }

  const required: SearchTermMatcher[] = [];
  const excluded: SearchTermMatcher[] = [];

  // Tokenize optional +/- prefix + quoted phrase OR non-whitespace token
  const tokenRegex = /([+-]?)"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(trimmed)) !== null) {
    if (match[2] !== undefined) {
      const prefix = match[1] || '';
      const phrase = match[2].trim();
      if (!phrase) continue;
      const negated = prefix === '-';
      const matcher = buildMatcher(phrase, true, negated);
      if (matcher) {
        (negated ? excluded : required).push(matcher);
      }
      continue;
    }

    const token = match[3] || '';
    if (!token || token === '+' || token === '-') continue;

    let negated = false;
    let term = token;
    if (token.startsWith('-')) {
      negated = true;
      term = token.slice(1);
    } else if (token.startsWith('+')) {
      term = token.slice(1);
    }

    if (!term) continue;
    const matcher = buildMatcher(term, false, negated);
    if (matcher) {
      (negated ? excluded : required).push(matcher);
    }
  }

  return {
    rawQuery: trimmed,
    required,
    excluded,
    hasTerms: required.length > 0 || excluded.length > 0,
  };
}

function countMatches(regex: RegExp, text: string, cap = 20): number {
  if (!text) return 0;
  regex.lastIndex = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    count++;
    if (count >= cap) break;
    if (m[0].length === 0) {
      regex.lastIndex++;
    }
  }
  return count;
}

function testMatch(regex: RegExp, text: string): boolean {
  if (!text) return false;
  regex.lastIndex = 0;
  return regex.test(text);
}

function computeRecencyBoost(mtime: number | undefined, nowMs: number): number {
  if (!mtime || !Number.isFinite(mtime)) return 0;
  const ageDays = Math.max(0, (nowMs - mtime) / (1000 * 60 * 60 * 24));
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 5;
  if (ageDays <= 90) return 2;
  return 0;
}

/**
 * Scores a document against a parsed query.
 * Returns `null` if any required term fails to match or any excluded term matches.
 */
export function scoreSearchMatch(
  doc: SearchableDoc,
  parsedQuery: ParsedSearchQuery,
  nowMs = Date.now()
): number | null {
  const fileName = doc.name || doc.path.split('/').pop() || doc.path;
  const titleWithoutExt = fileName.replace(/\.(md|canvas|base)(?:\.zenc)?$/i, '');
  const titleLower = titleWithoutExt.toLowerCase();
  const pathText = doc.path || '';
  const tagsText = (doc.tags || []).join(' ');
  const aliasesText = (doc.aliases || []).join(' ');
  const frontmatterText = doc.frontmatterText || '';
  const bodyText = doc.body || '';

  // 1. Exclusions: if any excluded term matches anywhere, reject document
  for (const ex of parsedQuery.excluded) {
    if (
      testMatch(ex.regex, titleWithoutExt) ||
      testMatch(ex.regex, pathText) ||
      testMatch(ex.regex, tagsText) ||
      testMatch(ex.regex, aliasesText) ||
      testMatch(ex.regex, frontmatterText) ||
      testMatch(ex.regex, bodyText)
    ) {
      return null;
    }
  }

  const recency = computeRecencyBoost(doc.mtime, nowMs);
  if (parsedQuery.required.length === 0) {
    return recency;
  }

  let score = 0;

  for (const term of parsedQuery.required) {
    let termMatched = false;

    // Exact title / filename match (+120)
    if (!term.hasWildcard && (titleLower === term.rawLower || fileName.toLowerCase() === term.rawLower)) {
      score += 120;
      termMatched = true;
    } else if (
      (term.wholeWordRegex && (testMatch(term.wholeWordRegex, titleWithoutExt) || testMatch(term.wholeWordRegex, pathText))) ||
      (!term.hasWildcard && (testMatch(term.regex, titleWithoutExt) || testMatch(term.regex, pathText)))
    ) {
      // Whole-word match in title/filename (+70)
      score += 70;
      termMatched = true;
    } else if (testMatch(term.regex, titleWithoutExt) || testMatch(term.regex, pathText)) {
      // Wildcard / partial match in title/filename (+35)
      score += 35;
      termMatched = true;
    }

    // Match in #tags or aliases (+45)
    if (testMatch(term.regex, tagsText) || testMatch(term.regex, aliasesText)) {
      score += 45;
      termMatched = true;
    }

    // Body & frontmatter values
    const combinedBody = frontmatterText ? `${frontmatterText}\n${bodyText}` : bodyText;
    const bodyCount = countMatches(term.regex, combinedBody, 11);
    if (bodyCount > 0) {
      termMatched = true;
      if (!term.hasWildcard) {
        // Whole-word match in body (+20) + +3 per additional occurrence (capped at +30)
        score += 20 + Math.min(30, (bodyCount - 1) * 3);
      } else {
        // Partial / wildcard match in body (+5)
        score += 5 + Math.min(15, (bodyCount - 1) * 2);
      }
    }

    if (!termMatched) {
      return null;
    }
  }

  return score + recency;
}

/**
 * Finds all non-overlapping match spans in `text` for all required terms.
 */
export function findRegexMatchesInText(
  text: string,
  parsedQuery: ParsedSearchQuery
): Array<{ from: number; to: number }> {
  if (!text || parsedQuery.required.length === 0) return [];

  const spans: Array<{ from: number; to: number }> = [];
  for (const term of parsedQuery.required) {
    const rx = new RegExp(term.regex.source, term.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (m[0].length === 0) {
        rx.lastIndex++;
        continue;
      }
      spans.push({ from: m.index, to: m.index + m[0].length });
    }
  }

  if (spans.length === 0) return [];
  spans.sort((a, b) => a.from - b.from || b.to - a.to);

  // Merge/deduplicate overlapping spans
  const merged: Array<{ from: number; to: number }> = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = spans[i];
    if (curr.from < prev.to) {
      prev.to = Math.max(prev.to, curr.to);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Extracts the best matching line snippet (~120 chars) and exact highlight ranges.
 */
export function extractMatchSnippet(
  body: string,
  parsedQuery: ParsedSearchQuery,
  maxLen = 120
): MatchSnippetResult {
  const cleanBody = body || '';
  if (!cleanBody) {
    return { snippet: '', line: 1, ranges: [] };
  }

  const lines = cleanBody.split(/\r?\n/);
  if (parsedQuery.required.length === 0) {
    const first = (lines[0] || '').trim();
    const snippet = first.length > maxLen ? `${first.slice(0, maxLen - 1)}…` : first;
    return { snippet, line: 1, ranges: [] };
  }

  let bestLineIdx = 0;
  let bestDensity = -1;
  let bestSpans: Array<{ from: number; to: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText.trim()) continue;
    let distinctTerms = 0;
    for (const term of parsedQuery.required) {
      if (testMatch(term.regex, lineText)) {
        distinctTerms++;
      }
    }
    if (distinctTerms > bestDensity) {
      bestDensity = distinctTerms;
      bestLineIdx = i;
      bestSpans = findRegexMatchesInText(lineText, parsedQuery);
      if (distinctTerms === parsedQuery.required.length) break;
    }
  }

  const rawLine = (lines[bestLineIdx] || '').trim();
  if (!rawLine) {
    const fallback = cleanBody.replace(/\s+/g, ' ').trim();
    return {
      snippet: fallback.length > maxLen ? `${fallback.slice(0, maxLen - 1)}…` : fallback,
      line: 1,
      ranges: [],
    };
  }

  const lineSpans = bestSpans.length > 0 ? findRegexMatchesInText(rawLine, parsedQuery) : [];
  let startOffset = 0;
  let snippet = rawLine;

  if (rawLine.length > maxLen) {
    const firstMatchStart = lineSpans.length > 0 ? lineSpans[0].from : 0;
    startOffset = Math.max(0, firstMatchStart - Math.floor(maxLen / 3));
    const endOffset = Math.min(rawLine.length, startOffset + maxLen);
    const prefix = startOffset > 0 ? '…' : '';
    const suffix = endOffset < rawLine.length ? '…' : '';
    snippet = `${prefix}${rawLine.slice(startOffset, endOffset)}${suffix}`;
    const prefixLen = prefix.length;
    const adjustedRanges = findRegexMatchesInText(snippet, parsedQuery).map((s) => ({
      start: s.from,
      end: s.to,
    }));
    void prefixLen;
    return {
      snippet,
      line: bestLineIdx + 1,
      ranges: adjustedRanges,
    };
  }

  return {
    snippet,
    line: bestLineIdx + 1,
    ranges: lineSpans.map((s) => ({ start: s.from, end: s.to })),
  };
}
