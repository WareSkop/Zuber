import type { FrontmatterProperty } from './types';

export type TableAlignment = 'left' | 'center' | 'right';
export type SortDirection = 'asc' | 'desc';
export type TableWidthsMap = Record<string, number[]>;

export interface ParsedMarkdownTable {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
  colCount: number;
}

export const TABLE_WIDTHS_KEY = '_tableWidths';
export const MIN_TABLE_COL_WIDTH = 60;
export const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export const isTableRowLine = (text: string): boolean =>
  text.includes('|') && text.trim().length > 0;

/**
 * Splits a Markdown table row into trimmed cell strings, respecting escaped pipes (\|).
 */
export function splitTableCells(rowText: string): string[] {
  let trimmed = rowText.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '\\|';
      i++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseAlignments(sepText: string): TableAlignment[] {
  return splitTableCells(sepText).map((cell) => {
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
}

export function parseMarkdownTable(rawLines: string[]): ParsedMarkdownTable {
  const rawHeaders = splitTableCells(rawLines[0] || '');
  const rawAlignments = parseAlignments(rawLines[1] || '');
  const rawRows = rawLines.slice(2).map((line) => splitTableCells(line));

  const colCount = Math.max(
    1,
    rawHeaders.length,
    rawAlignments.length,
    ...rawRows.map((r) => r.length)
  );

  const headers = Array.from({ length: colCount }, (_, c) => rawHeaders[c] ?? '');
  const alignments: TableAlignment[] = Array.from(
    { length: colCount },
    (_, c) => rawAlignments[c] ?? 'left'
  );
  const rows = rawRows.map((row) =>
    Array.from({ length: colCount }, (_, c) => row[c] ?? '')
  );

  return { headers, alignments, rows, colCount };
}

function sanitizeCellForMarkdown(cell: string): string {
  return cell
    .replace(/\r?\n/g, '<br>')
    .replace(/(?<!\\)\|/g, '\\|')
    .trim();
}

/**
 * Serializes a ParsedMarkdownTable into clean, properly padded standard GFM Markdown.
 */
export function serializeMarkdownTable(table: ParsedMarkdownTable): string {
  const colCount = Math.max(1, table.colCount, table.headers.length);
  const headers = Array.from({ length: colCount }, (_, c) =>
    sanitizeCellForMarkdown(table.headers[c] ?? '')
  );
  const alignments: TableAlignment[] = Array.from(
    { length: colCount },
    (_, c) => table.alignments[c] ?? 'left'
  );
  const rows = table.rows.map((row) =>
    Array.from({ length: colCount }, (_, c) => sanitizeCellForMarkdown(row[c] ?? ''))
  );

  const colWidths = Array.from({ length: colCount }, (_, c) => {
    const alignMin = alignments[c] === 'center' ? 5 : 4;
    let maxLen = Math.max(alignMin, headers[c].length);
    for (const row of rows) {
      if (row[c].length > maxLen) maxLen = row[c].length;
    }
    return maxLen;
  });

  const formatRow = (cells: string[]) =>
    `| ${cells.map((cell, c) => cell.padEnd(colWidths[c], ' ')).join(' | ')} |`;

  const formatSeparator = () =>
    `| ${alignments
      .map((align, c) => {
        const w = colWidths[c];
        if (align === 'center') {
          return ':' + '-'.repeat(Math.max(3, w - 2)) + ':';
        }
        if (align === 'right') {
          return '-'.repeat(Math.max(3, w - 1)) + ':';
        }
        return ':' + '-'.repeat(Math.max(3, w - 1));
      })
      .join(' | ')} |`;

  const lines = [formatRow(headers), formatSeparator(), ...rows.map(formatRow)];
  return lines.join('\n');
}

export function insertTableRowAt(
  table: ParsedMarkdownTable,
  rowIndex: number
): ParsedMarkdownTable {
  const clamped = Math.max(0, Math.min(table.rows.length, rowIndex));
  const emptyRow = Array.from({ length: table.colCount }, () => '');
  const nextRows = [
    ...table.rows.slice(0, clamped),
    emptyRow,
    ...table.rows.slice(clamped),
  ];
  return { ...table, rows: nextRows };
}

export function deleteTableRowAt(
  table: ParsedMarkdownTable,
  rowIndex: number
): ParsedMarkdownTable {
  if (rowIndex < 0 || rowIndex >= table.rows.length) return table;
  return {
    ...table,
    rows: table.rows.filter((_, idx) => idx !== rowIndex),
  };
}

export function insertTableColumnAt(
  table: ParsedMarkdownTable,
  colIndex: number,
  defaultHeader = ''
): ParsedMarkdownTable {
  const clamped = Math.max(0, Math.min(table.colCount, colIndex));
  const headers = [
    ...table.headers.slice(0, clamped),
    defaultHeader,
    ...table.headers.slice(clamped),
  ];
  const alignments: TableAlignment[] = [
    ...table.alignments.slice(0, clamped),
    'left',
    ...table.alignments.slice(clamped),
  ];
  const rows = table.rows.map((row) => [
    ...row.slice(0, clamped),
    '',
    ...row.slice(clamped),
  ]);
  return {
    headers,
    alignments,
    rows,
    colCount: table.colCount + 1,
  };
}

export function deleteTableColumnAt(
  table: ParsedMarkdownTable,
  colIndex: number
): ParsedMarkdownTable {
  if (table.colCount <= 1 || colIndex < 0 || colIndex >= table.colCount) {
    return table;
  }
  return {
    headers: table.headers.filter((_, idx) => idx !== colIndex),
    alignments: table.alignments.filter((_, idx) => idx !== colIndex),
    rows: table.rows.map((row) => row.filter((_, idx) => idx !== colIndex)),
    colCount: table.colCount - 1,
  };
}

export function setTableColumnAlignment(
  table: ParsedMarkdownTable,
  colIndex: number,
  alignment: TableAlignment
): ParsedMarkdownTable {
  if (colIndex < 0 || colIndex >= table.colCount) return table;
  const alignments = table.alignments.map((a, idx) =>
    idx === colIndex ? alignment : a
  );
  return { ...table, alignments };
}

/**
 * Strips inline Markdown syntax so sorting compares visible cell values.
 */
function stripInlineMarkdownForSort(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target, alias) =>
      String(alias || target).trim()
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|==|`|\*|_)/g, '')
    .trim();
}

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function tryParseIsoDateMs(val: string): number | null {
  const m = val.match(ISO_DATE_REGEX);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] ? Number(m[4]) : 0;
  const min = m[5] ? Number(m[5]) : 0;
  const sec = m[6] ? Number(m[6]) : 0;
  const ts = Date.UTC(year, month - 1, day, hour, min, sec);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Parses numbers and currency strings (e.g. "$1,234.50", "€ 42,50", "-15.5", "95%").
 */
export function tryParseNumericValue(raw: string): number | null {
  const cleaned = raw
    .replace(/[€$£¥%]/g, '')
    .replace(/\b(?:EUR|USD|CHF|GBP)\b/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return null;

  // Standard US/programming number: 1234.56 or -1234
  if (/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  // US thousands with optional decimal: 1,234,567.89
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  // European thousands with decimal comma: 1.234.567,89
  if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(cleaned)) {
    const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  // European decimal comma without thousands: 42,50 or -3,14
  if (/^[+-]?\d+,\d+$/.test(cleaned)) {
    const n = Number(cleaned.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function compareTableCellValues(
  rawA: string,
  rawB: string,
  direction: SortDirection
): number {
  const a = stripInlineMarkdownForSort(rawA);
  const b = stripInlineMarkdownForSort(rawB);

  const aEmpty = a.length === 0;
  const bEmpty = b.length === 0;
  if (aEmpty && bEmpty) return 0;
  // Empty cells always sort to the bottom regardless of sort direction
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const mult = direction === 'asc' ? 1 : -1;

  const dateA = tryParseIsoDateMs(a);
  const dateB = tryParseIsoDateMs(b);
  if (dateA !== null && dateB !== null) {
    return (dateA - dateB) * mult;
  }

  const numA = tryParseNumericValue(a);
  const numB = tryParseNumericValue(b);
  if (numA !== null && numB !== null) {
    return (numA - numB) * mult;
  }

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * mult;
}

export function sortMarkdownTable(
  table: ParsedMarkdownTable,
  colIndex: number,
  direction: SortDirection
): ParsedMarkdownTable {
  if (colIndex < 0 || colIndex >= table.colCount) return table;
  const sortedRows = [...table.rows].sort((rowA, rowB) =>
    compareTableCellValues(rowA[colIndex] ?? '', rowB[colIndex] ?? '', direction)
  );
  return {
    ...table,
    rows: sortedRows,
  };
}

/**
 * Normalizes table header cells into a stable pipe-joined signature key for _tableWidths.
 * Example: ["Device", "IP", "Status"] -> "Device | IP | Status"
 */
export function getTableHeaderSignature(headers: string[]): string {
  return headers.map((h) => h.trim()).join(' | ');
}

/**
 * Scans a Markdown body (ignoring fenced code blocks) and returns all table header signatures.
 */
export function extractTableHeaderSignaturesFromMarkdown(body: string): Set<string> {
  const signatures = new Set<string>();
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    if (
      i + 1 < lines.length &&
      isTableRowLine(lines[i]) &&
      TABLE_SEPARATOR_REGEX.test(lines[i + 1])
    ) {
      const headers = splitTableCells(lines[i]);
      const sig = getTableHeaderSignature(headers);
      if (sig) signatures.add(sig);
      // Advance past the rest of the table
      i += 1;
      while (i + 1 < lines.length && isTableRowLine(lines[i + 1])) {
        i++;
      }
    }
  }

  return signatures;
}

export function getTableWidthsFromProperties(
  properties: FrontmatterProperty[]
): TableWidthsMap {
  const prop = properties.find((p) => p.key === TABLE_WIDTHS_KEY);
  if (!prop || !prop.value || typeof prop.value !== 'object' || Array.isArray(prop.value)) {
    return {};
  }
  const result: TableWidthsMap = {};
  for (const [sig, widths] of Object.entries(prop.value as Record<string, unknown>)) {
    if (Array.isArray(widths)) {
      const valid = widths
        .map((w) => Number(w))
        .filter((w) => Number.isFinite(w) && w > 0)
        .map((w) => Math.max(MIN_TABLE_COL_WIDTH, Math.round(w)));
      if (valid.length > 0) {
        result[sig] = valid;
      }
    }
  }
  return result;
}

function applyTableWidthsMapToProperties(
  properties: FrontmatterProperty[],
  widthsMap: TableWidthsMap
): FrontmatterProperty[] {
  const keys = Object.keys(widthsMap);
  const existingIdx = properties.findIndex((p) => p.key === TABLE_WIDTHS_KEY);

  if (keys.length === 0) {
    if (existingIdx === -1) return properties;
    return properties.filter((_, idx) => idx !== existingIdx);
  }

  const nextProp: FrontmatterProperty = {
    key: TABLE_WIDTHS_KEY,
    type: 'object',
    value: widthsMap,
  };

  if (existingIdx === -1) {
    return [...properties, nextProp];
  }
  return properties.map((p, idx) => (idx === existingIdx ? nextProp : p));
}

export function setTableWidthsInProperties(
  properties: FrontmatterProperty[],
  headerSignature: string,
  widths: number[],
  bodyForOrphanCleanup?: string
): FrontmatterProperty[] {
  const current = getTableWidthsFromProperties(properties);
  const cleanedWidths = widths.map((w) =>
    Math.max(MIN_TABLE_COL_WIDTH, Math.round(w))
  );
  const nextMap: TableWidthsMap = {
    ...current,
    [headerSignature]: cleanedWidths,
  };

  if (bodyForOrphanCleanup !== undefined) {
    const activeSigs = extractTableHeaderSignaturesFromMarkdown(bodyForOrphanCleanup);
    for (const key of Object.keys(nextMap)) {
      if (key !== headerSignature && !activeSigs.has(key)) {
        delete nextMap[key];
      }
    }
  }

  return applyTableWidthsMapToProperties(properties, nextMap);
}

export function renameTableWidthSignature(
  properties: FrontmatterProperty[],
  oldSignature: string,
  newSignature: string,
  bodyForOrphanCleanup?: string
): FrontmatterProperty[] {
  if (!oldSignature || !newSignature || oldSignature === newSignature) {
    return bodyForOrphanCleanup !== undefined
      ? pruneOrphanedTableWidths(properties, bodyForOrphanCleanup)
      : properties;
  }

  const current = getTableWidthsFromProperties(properties);
  if (!current[oldSignature]) {
    return bodyForOrphanCleanup !== undefined
      ? pruneOrphanedTableWidths(properties, bodyForOrphanCleanup)
      : properties;
  }

  const nextMap: TableWidthsMap = { ...current };
  nextMap[newSignature] = nextMap[oldSignature];
  delete nextMap[oldSignature];

  if (bodyForOrphanCleanup !== undefined) {
    const activeSigs = extractTableHeaderSignaturesFromMarkdown(bodyForOrphanCleanup);
    for (const key of Object.keys(nextMap)) {
      if (key !== newSignature && !activeSigs.has(key)) {
        delete nextMap[key];
      }
    }
  }

  return applyTableWidthsMapToProperties(properties, nextMap);
}

export function pruneOrphanedTableWidths(
  properties: FrontmatterProperty[],
  body: string
): FrontmatterProperty[] {
  const prop = properties.find((p) => p.key === TABLE_WIDTHS_KEY);
  if (!prop) return properties;

  const current = getTableWidthsFromProperties(properties);
  const activeSigs = extractTableHeaderSignaturesFromMarkdown(body);
  let changed = false;
  const nextMap: TableWidthsMap = {};

  for (const [key, widths] of Object.entries(current)) {
    if (activeSigs.has(key)) {
      nextMap[key] = widths;
    } else {
      changed = true;
    }
  }

  // Also clean up if prop had invalid non-object value
  if (!changed && Object.keys(nextMap).length === Object.keys(current).length) {
    return properties;
  }

  return applyTableWidthsMapToProperties(properties, nextMap);
}
