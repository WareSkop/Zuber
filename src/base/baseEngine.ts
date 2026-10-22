import YAML from 'yaml';
import type {
  BaseDefinition,
  BaseFilterCondition,
  BaseGroupBy,
  BaseSortRule,
  BaseViewConfig,
  NoteData,
  NoteSummary,
} from '../../shared/types';

export interface BaseRecordFile {
  name: string;
  path: string;
  folder: string;
  ext: string;
  mtime: number;
  inFolder: (folder: string) => boolean;
  hasTag: (tag: string) => boolean;
  hasLink: (link: string) => boolean;
}

export interface BaseRecord {
  file: BaseRecordFile;
  tags: string[];
  links: string[];
  properties: Record<string, any>;
  formulas: Record<string, any>;
  [key: string]: any;
}

export interface BaseGroup {
  key: string;
  label: string;
  records: BaseRecord[];
}

export interface BaseQueryResult {
  definition: BaseDefinition;
  view: BaseViewConfig;
  columns: string[];
  columnDisplayNames: Record<string, string>;
  records: BaseRecord[];
  groups: BaseGroup[];
  totalCount: number;
}

/**
 * Parses raw YAML text into a typed BaseDefinition.
 */
export function parseBaseYaml(rawYaml: string): BaseDefinition {
  if (!rawYaml || !rawYaml.trim()) {
    return { views: [{ type: 'table', name: 'Table' }] };
  }

  try {
    const parsed = YAML.parse(rawYaml);
    if (!parsed || typeof parsed !== 'object') {
      return { views: [{ type: 'table', name: 'Table' }] };
    }

    const definition: BaseDefinition = {
      filters: parsed.filters,
      formulas: parsed.formulas,
      properties: parsed.properties,
      summaries: parsed.summaries,
      views: Array.isArray(parsed.views) && parsed.views.length > 0
        ? parsed.views
        : [{ type: 'table', name: 'Table' }],
    };
    return definition;
  } catch (err) {
    throw new Error(`YAML Parsing Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Converts a note into a unified BaseRecord suitable for querying and rendering.
 */
export function createRecordFromNote(note: NoteData | NoteSummary | any): BaseRecord {
  const filePath = (note.path || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const name = note.name || filePath.split('/').pop() || '';
  const folder = note.folder !== undefined
    ? note.folder
    : filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const ext = note.extension || (filePath.includes('.') ? filePath.split('.').pop() || 'md' : 'md');
  const mtime = note.mtime ?? note.updatedAt ?? (note as any).mtimeMs ?? 0;

  // Extract tags: note.tags or note.properties.find(tags)
  const tagsSet = new Set<string>();
  if (Array.isArray(note.tags)) {
    for (const t of note.tags) {
      if (typeof t === 'string' && t.trim()) {
        const clean = t.trim().replace(/^#/, '');
        tagsSet.add(clean.toLowerCase());
      }
    }
  }

  // Properties dictionary
  const properties: Record<string, any> = {};
  if (note.frontmatter && typeof note.frontmatter === 'object') {
    for (const [k, v] of Object.entries(note.frontmatter)) {
      properties[k] = v;
      if (k.toLowerCase() === 'tags') {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (typeof item === 'string' && item.trim()) {
            tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
          }
        }
      }
    }
  }

  if (note.properties && typeof note.properties === 'object') {
    if (Array.isArray(note.properties)) {
      for (const prop of note.properties) {
        if (prop && prop.key) {
          properties[prop.key] = prop.value;
          if (prop.key.toLowerCase() === 'tags') {
            const list = Array.isArray(prop.value) ? prop.value : [prop.value];
            for (const item of list) {
              if (typeof item === 'string' && item.trim()) {
                tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
              }
            }
          }
        }
      }
    } else {
      for (const [k, v] of Object.entries(note.properties)) {
        properties[k] = v;
        if (k.toLowerCase() === 'tags') {
          const list = Array.isArray(v) ? v : [v];
          for (const item of list) {
            if (typeof item === 'string' && item.trim()) {
              tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
            }
          }
        }
      }
    }
  }

  const allTags: string[] = Array.from(tagsSet);
  const allLinks: string[] = Array.isArray(note.links) ? note.links.map(String) : [];

  const fileObj: BaseRecordFile = {
    name,
    path: filePath,
    folder,
    ext,
    mtime,
    inFolder: (targetFolder: string) => {
      const cleanTarget = (targetFolder || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '').toLowerCase();
      if (!cleanTarget) return true; // root or any
      const folderLower = folder.toLowerCase();
      return folderLower === cleanTarget || folderLower.startsWith(`${cleanTarget}/`);
    },
    hasTag: (tag: string) => {
      const clean = (tag || '').trim().replace(/^#/, '').toLowerCase();
      return allTags.includes(clean);
    },
    hasLink: (link: string) => {
      const clean = (link || '').trim().toLowerCase();
      return allLinks.some((l) => l.toLowerCase() === clean || l.toLowerCase().includes(clean));
    },
  };

  const record: BaseRecord = {
    file: fileObj,
    tags: allTags,
    links: allLinks,
    properties,
    formulas: {},
  };

  // Expose properties directly on the record for easy formula/expression evaluation
  for (const [k, v] of Object.entries(properties)) {
    if (!(k in record)) {
      record[k] = v;
    }
  }

  return record;
}

/**
 * Normalizes duration string literals in formulas (e.g. "1 day" -> 86400000).
 */
function normalizeDurationLiterals(expr: string): string {
  return expr.replace(/["'](\d+)\s*(day|days|d|hour|hours|h|minute|minutes|min|m|second|seconds|s)["']/gi, (_, num, unit) => {
    const n = Number(num);
    const u = unit.toLowerCase();
    let ms = 1000;
    if (u.startsWith('d')) ms = 24 * 60 * 60 * 1000;
    else if (u.startsWith('h')) ms = 60 * 60 * 1000;
    else if (u.startsWith('m')) ms = 60 * 1000;
    else if (u.startsWith('s')) ms = 1000;
    return String(n * ms);
  });
}

/**
 * Evaluates a single formula expression against a record.
 */
export function evaluateFormula(formula: string, record: BaseRecord, formulasSoFar: Record<string, any> = {}): any {
  if (!formula || !formula.trim()) return '';

  const cleanFormula = normalizeDurationLiterals(formula.trim()).replace(/\bif\s*\(/g, '__if(');

  // Sandbox helper functions
  const dateFn = (val: any) => {
    if (!val) return 0;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
  };

  const todayFn = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const nowFn = () => Date.now();

  const roundFn = (val: any, decimals = 0) => {
    const num = Number(val);
    if (isNaN(num)) return 0;
    if (decimals <= 0) return Math.round(num);
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  };

  const reservedWords = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield', 'enum', 'await'
  ]);

  const context: Record<string, any> = {
    file: record.file,
    date: dateFn,
    today: todayFn,
    now: nowFn,
    __if: (cond: any, thenVal: any, elseVal: any) => (cond ? thenVal : elseVal),
    round: roundFn,
    floor: Math.floor,
    ceil: Math.ceil,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    Math,
    formula: formulasSoFar,
    ...formulasSoFar,
  };

  const noteObj: Record<string, any> = {};
  for (const [k, v] of Object.entries(record.properties)) {
    const rawKey = k.replace(/^note\./, '');
    noteObj[rawKey] = v;
    if (!reservedWords.has(rawKey) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rawKey)) {
      context[rawKey] = v;
    }
  }
  context.note = noteObj;

  try {
    const keys = Object.keys(context);
    const values = Object.values(context);
    // Wrap in function with keys as arguments
    const fn = new Function(...keys, `return (${cleanFormula});`);
    const result = fn(...values);
    return result !== undefined && result !== null ? result : '';
  } catch {
    return '';
  }
}

/**
 * Evaluates an individual filter string expression against a record.
 */
function evaluateStringExpression(expr: string, record: BaseRecord): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  // 1. file.inFolder("...")
  const inFolderMatch = trimmed.match(/^file\.inFolder\(\s*["']([^"']+)["']\s*\)$/i);
  if (inFolderMatch) {
    return record.file.inFolder(inFolderMatch[1]);
  }

  // 2. file.hasTag("...")
  const hasTagMatch = trimmed.match(/^file\.hasTag\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasTagMatch) {
    return record.file.hasTag(hasTagMatch[1]);
  }

  // 3. file.hasLink("...")
  const hasLinkMatch = trimmed.match(/^file\.hasLink\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasLinkMatch) {
    return record.file.hasLink(hasLinkMatch[1]);
  }

  // 4. Comparison expression (e.g. status == "done", priority > 2, file.ext == "md")
  // Replace single '=' with '==' if not already '==' or '!='
  let safeExpr = trimmed;
  // Convert standard word operators
  safeExpr = safeExpr.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/\bnot\b/gi, '!');

  const noteObj: Record<string, any> = {};
  const validProps: Record<string, any> = {};
  const reservedWords = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
    'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield', 'enum', 'await'
  ]);

  for (const [k, v] of Object.entries(record.properties)) {
    const rawKey = k.replace(/^note\./, '');
    noteObj[rawKey] = v;
    if (!reservedWords.has(rawKey) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rawKey)) {
      validProps[rawKey] = v;
    }
  }

  const context: Record<string, any> = {
    file: record.file,
    note: noteObj,
    ...validProps,
    ...record.formulas,
  };

  try {
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `return Boolean(${safeExpr});`);
    return Boolean(fn(...values));
  } catch {
    // Fallback: simple key-value comparison
    return false;
  }
}

/**
 * Recursively evaluates a BaseFilterCondition against a record.
 */
export function evaluateCondition(cond: BaseFilterCondition | undefined | null, record: BaseRecord): boolean {
  if (cond === undefined || cond === null) return true;

  // A. Array of conditions (implicit AND)
  if (Array.isArray(cond)) {
    return cond.every((c) => evaluateCondition(c, record));
  }

  // B. String expression
  if (typeof cond === 'string') {
    return evaluateStringExpression(cond, record);
  }

  // C. Object with logical operators
  if (typeof cond === 'object') {
    const obj = cond as Record<string, any>;

    // and
    if ('and' in obj && Array.isArray(obj.and)) {
      return obj.and.every((sub) => evaluateCondition(sub, record));
    }

    // or
    if ('or' in obj && Array.isArray(obj.or)) {
      if (obj.or.length === 0) return true;
      return obj.or.some((sub) => evaluateCondition(sub, record));
    }

    // not
    if ('not' in obj) {
      if (Array.isArray(obj.not)) {
        return !obj.not.every((sub) => evaluateCondition(sub, record));
      }
      return !evaluateCondition(obj.not, record);
    }

    // Key-value exact match: { status: "done", priority: 1 }
    for (const [key, val] of Object.entries(obj)) {
      let actual: any;
      if (key.startsWith('file.')) {
        actual = (record.file as any)[key.replace('file.', '')];
      } else {
        actual = getPropertyValue(record, key);
      }
      if (String(actual).toLowerCase() !== String(val).toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  return true;
}

/**
 * Executes a full Base query against a set of vault notes and returns rendered results.
 */
export function executeBaseQuery(
  definition: BaseDefinition,
  allNotes: (NoteData | NoteSummary | any)[],
  viewIndex = 0,
  currentBasePath?: string
): BaseQueryResult {
  const views = definition.views && definition.views.length > 0
    ? definition.views
    : [{ type: 'table', name: 'Table' }];

  const activeView = views[viewIndex] || views[0];

  // Self-Exclusion and Default Filtering:
  // Check if query filters explicitly mention file.ext
  const filtersString = JSON.stringify(definition.filters || '') + JSON.stringify(activeView.filters || '');
  const explicitlyChecksExt = filtersString.includes('file.ext');

  // Candidate filtering:
  // 1. Strictly exclude .base files and currentBasePath
  // 2. By default, restrict to .md files unless query explicitly checks file.ext
  const candidateNotes = (allNotes || []).filter((n) => {
    const p = n?.path || '';
    if (!p) return false;
    if (p.endsWith('.base')) return false;
    if (currentBasePath && p === currentBasePath) return false;
    if (!explicitlyChecksExt) {
      const ext = n.extension || (p.includes('.') ? p.split('.').pop() : 'md');
      if (ext !== 'md' && !p.endsWith('.md')) return false;
    }
    return true;
  });

  // Strict Path Deduplication
  const seenCandidatePaths = new Set<string>();
  const uniqueCandidateNotes = candidateNotes.filter((n) => {
    const p = n?.path || '';
    if (seenCandidatePaths.has(p)) return false;
    seenCandidatePaths.add(p);
    return true;
  });

  // 1. Convert notes to BaseRecords
  const allRecords = uniqueCandidateNotes.map((n) => createRecordFromNote(n));

  // 2. Evaluate Formulas for each record
  const formulas = definition.formulas || {};
  for (const record of allRecords) {
    const computed: Record<string, any> = {};
    for (const [fName, fExpr] of Object.entries(formulas)) {
      computed[fName] = evaluateFormula(fExpr, record, computed);
    }
    record.formulas = computed;
    // Also expose formula.fName
    for (const [k, v] of Object.entries(computed)) {
      record[`formula.${k}`] = v;
    }
  }

  // 3. Filter Records
  const seenResultPaths = new Set<string>();
  const matchingRecords = allRecords.filter((rec) => {
    // Check global filters
    if (definition.filters && !evaluateCondition(definition.filters, rec)) {
      return false;
    }
    // Check view-specific filters
    if (activeView.filters && !evaluateCondition(activeView.filters, rec)) {
      return false;
    }
    if (seenResultPaths.has(rec.file.path)) return false;
    seenResultPaths.add(rec.file.path);
    return true;
  });

  // 4. Sort Records
  const sortRules = activeView.sort || [];
  if (sortRules.length > 0) {
    matchingRecords.sort((a, b) => {
      for (const rule of sortRules) {
        const prop = rule.property;
        const dir = (rule.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;

        const valA = getPropertyValue(a, prop);
        const valB = getPropertyValue(b, prop);

        if (valA === valB) continue;
        if (valA === undefined || valA === null) return 1 * dir;
        if (valB === undefined || valB === null) return -1 * dir;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * dir;
        }

        const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
  }

  // 5. Limit
  const limit = activeView.limit;
  const limitedRecords = limit && limit > 0 ? matchingRecords.slice(0, limit) : matchingRecords;

  // 6. Columns Determination
  let columns: string[] = [];
  if (Array.isArray(activeView.order) && activeView.order.length > 0) {
    columns = [...activeView.order];
  } else {
    // Inferred columns: always start with file.name, then all properties found in records
    const propKeys = new Set<string>();
    for (const rec of limitedRecords) {
      for (const k of Object.keys(rec.properties)) {
        propKeys.add(k);
      }
      for (const f of Object.keys(rec.formulas)) {
        propKeys.add(`formula.${f}`);
      }
    }
    columns = ['file.name', ...Array.from(propKeys)];
  }

  // 7. Column Display Names
  const columnDisplayNames: Record<string, string> = {};
  for (const col of columns) {
    if (definition.properties && definition.properties[col]?.displayName) {
      columnDisplayNames[col] = definition.properties[col].displayName!;
    } else if (col === 'file.name') {
      columnDisplayNames[col] = 'Name';
    } else if (col === 'file.folder') {
      columnDisplayNames[col] = 'Folder';
    } else if (col.startsWith('formula.')) {
      columnDisplayNames[col] = col.replace('formula.', '');
    } else {
      columnDisplayNames[col] = col;
    }
  }

  // 8. Grouping
  const groups: BaseGroup[] = [];
  if (activeView.groupBy && activeView.groupBy.property) {
    const groupProp = activeView.groupBy.property;
    const groupDir = (activeView.groupBy.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;

    const groupMap = new Map<string, BaseRecord[]>();
    for (const rec of limitedRecords) {
      const gVal = String(getPropertyValue(rec, groupProp) ?? 'Ungrouped');
      if (!groupMap.has(gVal)) {
        groupMap.set(gVal, []);
      }
      groupMap.get(gVal)!.push(rec);
    }

    const sortedGroupKeys = Array.from(groupMap.keys()).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true }) * groupDir;
    });

    for (const k of sortedGroupKeys) {
      groups.push({
        key: k,
        label: k,
        records: groupMap.get(k) || [],
      });
    }
  } else {
    // Single default group
    groups.push({
      key: 'all',
      label: 'All Notes',
      records: limitedRecords,
    });
  }

  return {
    definition,
    view: activeView,
    columns,
    columnDisplayNames,
    records: limitedRecords,
    groups,
    totalCount: matchingRecords.length,
  };
}

/**
 * Resolves a property value from a BaseRecord (supports file.name, formula.x, or regular properties).
 */
export function getPropertyValue(record: BaseRecord, propertyKey: string): any {
  if (propertyKey === 'file.name') return record.file.name;
  if (propertyKey === 'file.folder') return record.file.folder;
  if (propertyKey === 'file.path') return record.file.path;
  if (propertyKey === 'file.ext') return record.file.ext;
  if (propertyKey === 'file.mtime') return record.file.mtime;

  if (propertyKey.startsWith('formula.')) {
    const fKey = propertyKey.replace('formula.', '');
    return record.formulas[fKey] ?? record[propertyKey];
  }

  if (propertyKey.startsWith('note.')) {
    const nKey = propertyKey.replace('note.', '');
    return record.properties[nKey] ?? record.properties[propertyKey] ?? record[nKey] ?? record[propertyKey];
  }

  if (propertyKey in record.properties) {
    return record.properties[propertyKey];
  }

  // Flexible property access fallback (e.g. resolve both IP and note.IP)
  if (`note.${propertyKey}` in record.properties) {
    return record.properties[`note.${propertyKey}`];
  }

  return record[propertyKey];
}
