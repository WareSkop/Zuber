import YAML from 'yaml';

export type FilterOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'startsWith'
  | 'isEmpty'
  | '!isEmpty';

export interface BaseFilterRule {
  id: string;
  field: string; // e.g. "file.folder", "status", "IP", "file.hasTag", "file.inFolder"
  operator: FilterOperator;
  value: string | number | boolean;
}

export interface BaseSortRule {
  property: string;
  direction: 'asc' | 'desc';
}

export interface BoardColumnSortRule {
  property: string; // 'file.name' | 'file.ctime' | custom frontmatter property
  direction: 'asc' | 'desc';
}

export interface BasePropertyConfig {
  displayName?: string;
  hidden?: boolean;
  type?: string;
  width?: number;
  [key: string]: any;
}

export interface BaseBoardColumnConfig {
  name: string;
  limit?: number; // Optional per-column limit (defaults to view default or 10)
  color?: string; // Optional accent color badge for the column header
  sort?: BoardColumnSortRule; // Column-level sort override
}

export interface BaseGroupBy {
  property: string;
  direction?: 'asc' | 'desc';
  columns?: (string | BaseBoardColumnConfig)[];
}

export interface BaseBoardSwimlaneItem {
  name: string;
  collapsed?: boolean;
}

export interface BaseBoardSwimlaneConfig {
  property: string; // e.g. "prio" (empty or undefined = no swimlanes)
  lanes?: (string | BaseBoardSwimlaneItem)[];
  unassignedCollapsed?: boolean; // Collapse status for the catch-all "Keine Zuordnung" swimlane
}

export interface BaseViewConfig {
  type: 'table' | 'cards' | 'board' | 'list';
  name: string;
  limit?: number;
  columnLimit?: number; // Default max visible cards per column (default: 10)
  filters?: {
    and?: (string | Record<string, any>)[];
    or?: (string | Record<string, any>)[];
    [key: string]: any;
  };
  order?: string[];
  sort?: BaseSortRule[];
  boardSort?: BoardColumnSortRule;
  groupBy?: BaseGroupBy;
  swimlanes?: BaseBoardSwimlaneConfig;
  columnSize?: Record<string, number>;
  [key: string]: any;
}

export interface BaseConfig {
  properties?: Record<string, BasePropertyConfig>;
  filters?: BaseViewConfig['filters'];
  views: BaseViewConfig[];
  formulas?: Record<string, string>;
  summaries?: Record<string, string>;
  [key: string]: any;
}

/**
 * Safely parse raw YAML text into a typed BaseConfig.
 */
export function parseBaseYaml(rawYaml: string): BaseConfig {
  if (!rawYaml || !rawYaml.trim()) {
    return { views: [{ type: 'table', name: 'Table' }] };
  }

  try {
    const parsed = YAML.parse(rawYaml);
    if (!parsed || typeof parsed !== 'object') {
      return { views: [{ type: 'table', name: 'Table' }] };
    }

    const views: BaseViewConfig[] = Array.isArray(parsed.views) && parsed.views.length > 0
      ? parsed.views.map((v: any, idx: number) => ({
          ...v,
          type: (v.type === 'cards' || v.type === 'board' || v.type === 'list') ? v.type : 'table',
          name: v.name || (v.type === 'board' ? 'Board' : v.type === 'cards' ? 'Cards' : `Table ${idx + 1}`),
          columnLimit: typeof v.columnLimit === 'number' ? v.columnLimit : undefined,
          sort: Array.isArray(v.sort)
            ? v.sort.map((s: any) => ({
                property: s.property,
                direction: (s.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
              }))
            : undefined,
          boardSort: v.boardSort && typeof v.boardSort === 'object' && v.boardSort.property
            ? {
                property: String(v.boardSort.property),
                direction: (v.boardSort.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
              }
            : undefined,
          groupBy: v.groupBy && typeof v.groupBy === 'object' && v.groupBy.property
            ? {
                property: v.groupBy.property,
                direction: (v.groupBy.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
                columns: Array.isArray(v.groupBy.columns)
                  ? v.groupBy.columns.map((c: any) =>
                      typeof c === 'string'
                        ? c
                        : {
                            name: String(c.name || ''),
                            limit: typeof c.limit === 'number' ? c.limit : undefined,
                            color: c.color ? String(c.color) : undefined,
                            sort: c.sort && typeof c.sort === 'object' && c.sort.property
                              ? {
                                  property: String(c.sort.property),
                                  direction: (c.sort.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
                                }
                              : undefined,
                          }
                    )
                  : undefined,
              }
            : undefined,
          swimlanes:
            v.swimlanes && typeof v.swimlanes === 'object' && v.swimlanes.property && String(v.swimlanes.property).trim()
              ? {
                  property: String(v.swimlanes.property).trim(),
                  lanes: Array.isArray(v.swimlanes.lanes)
                    ? v.swimlanes.lanes.map((l: any) =>
                        typeof l === 'string'
                          ? l
                          : {
                              name: String(l.name || ''),
                              collapsed: typeof l.collapsed === 'boolean' ? l.collapsed : undefined,
                            }
                      )
                    : undefined,
                  unassignedCollapsed:
                    typeof v.swimlanes.unassignedCollapsed === 'boolean'
                      ? v.swimlanes.unassignedCollapsed
                      : undefined,
                }
              : undefined,
        }))
      : [{ type: 'table', name: 'Table' }];

    return {
      ...parsed,
      views,
    };
  } catch (err: any) {
    throw new Error(`YAML Parsing Error: ${err?.message || String(err)}`);
  }
}

/**
 * Convert a single BaseFilterRule into an Obsidian-compatible expression string.
 */
export function ruleToExpression(rule: BaseFilterRule): string {
  const field = (rule.field || '').trim();
  const val = rule.value;

  // 1. file.inFolder
  if (field === 'file.inFolder') {
    const cleanFolder = String(val ?? '').replace(/"/g, '\\"');
    if (rule.operator === '!=') {
      return `!file.inFolder("${cleanFolder}")`;
    }
    return `file.inFolder("${cleanFolder}")`;
  }

  // 2. file.hasTag
  if (field === 'file.hasTag') {
    const cleanTag = String(val ?? '').replace(/^#/, '').replace(/"/g, '\\"');
    if (rule.operator === '!=') {
      return `!file.hasTag("${cleanTag}")`;
    }
    return `file.hasTag("${cleanTag}")`;
  }

  // 3. file.hasLink
  if (field === 'file.hasLink') {
    const cleanLink = String(val ?? '').replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/"/g, '\\"');
    if (rule.operator === '!=') {
      return `!file.hasLink("${cleanLink}")`;
    }
    return `file.hasLink("${cleanLink}")`;
  }

  // 3. isEmpty / !isEmpty
  if (rule.operator === 'isEmpty') {
    return `${field} == null || ${field} == ""`;
  }
  if (rule.operator === '!isEmpty') {
    return `${field} != null && ${field} != ""`;
  }

  // 4. contains / startsWith
  if (rule.operator === 'contains') {
    const cleanStr = String(val ?? '').replace(/"/g, '\\"');
    return `${field}.contains("${cleanStr}")`;
  }
  if (rule.operator === 'startsWith') {
    const cleanStr = String(val ?? '').replace(/"/g, '\\"');
    return `${field}.startsWith("${cleanStr}")`;
  }

  // 5. Comparison operators (==, !=, >, <, >=, <=)
  const op = rule.operator;
  if (typeof val === 'number') {
    return `${field} ${op} ${val}`;
  }
  if (typeof val === 'boolean') {
    return `${field} ${op} ${val}`;
  }
  // If string represents a clean number for numeric comparisons
  if (['>', '<', '>=', '<='].includes(op) && !isNaN(Number(val)) && String(val).trim() !== '') {
    return `${field} ${op} ${Number(val)}`;
  }

  const cleanStr = String(val ?? '').replace(/"/g, '\\"');
  return `${field} ${op} "${cleanStr}"`;
}

/**
 * Parse an expression string into a structured BaseFilterRule.
 */
export function expressionToRule(expr: string, idPrefix = 'rule'): BaseFilterRule {
  const trimmed = expr.trim();
  const ruleId = `${idPrefix}-${Math.random().toString(36).slice(2, 9)}`;

  // 1. file.inFolder("...")
  const inFolderMatch = trimmed.match(/^(!)?\s*file\.inFolder\(\s*["']([^"']+)["']\s*\)$/i);
  if (inFolderMatch) {
    return {
      id: ruleId,
      field: 'file.inFolder',
      operator: inFolderMatch[1] ? '!=' : '==',
      value: inFolderMatch[2],
    };
  }

  // 2. file.hasTag("...")
  const hasTagMatch = trimmed.match(/^(!)?\s*file\.hasTag\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasTagMatch) {
    return {
      id: ruleId,
      field: 'file.hasTag',
      operator: hasTagMatch[1] ? '!=' : '==',
      value: hasTagMatch[2],
    };
  }

  // 3. file.hasLink("...")
  const hasLinkMatch = trimmed.match(/^(!)?\s*file\.hasLink\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasLinkMatch) {
    return {
      id: ruleId,
      field: 'file.hasLink',
      operator: hasLinkMatch[1] ? '!=' : '==',
      value: hasLinkMatch[2],
    };
  }

  // 3. isEmpty: field == null || field == ""
  const isEmptyMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*==\s*null\s*\|\|\s*\1\s*==\s*["']{2}$/);
  if (isEmptyMatch) {
    return {
      id: ruleId,
      field: isEmptyMatch[1],
      operator: 'isEmpty',
      value: '',
    };
  }

  // 4. !isEmpty: field != null && field != ""
  const notEmptyMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*!=\s*null\s*&&\s*\1\s*!=\s*["']{2}$/);
  if (notEmptyMatch) {
    return {
      id: ruleId,
      field: notEmptyMatch[1],
      operator: '!isEmpty',
      value: '',
    };
  }

  // 5. contains: field.contains("...") or field.includes("...")
  const containsMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\.(?:contains|includes)\(\s*["']([^"']*)["']\s*\)$/);
  if (containsMatch) {
    return {
      id: ruleId,
      field: containsMatch[1],
      operator: 'contains',
      value: containsMatch[2],
    };
  }

  // 6. startsWith: field.startsWith("...")
  const startsWithMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\.startsWith\(\s*["']([^"']*)["']\s*\)$/);
  if (startsWithMatch) {
    return {
      id: ruleId,
      field: startsWithMatch[1],
      operator: 'startsWith',
      value: startsWithMatch[2],
    };
  }

  // 7. Standard binary comparisons: field == "val", field != 10, field > 5, etc.
  const compMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(===|==|!==|!=|>=|<=|>|<)\s*(.*)$/);
  if (compMatch) {
    const field = compMatch[1];
    let rawOp = compMatch[2];
    let op: FilterOperator = '==';
    if (rawOp === '==' || rawOp === '===') op = '==';
    else if (rawOp === '!=' || rawOp === '!==') op = '!=';
    else op = rawOp as FilterOperator;

    let rawVal = compMatch[3].trim();
    // String quotes
    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      return {
        id: ruleId,
        field,
        operator: op,
        value: rawVal.slice(1, -1),
      };
    }
    // Number
    if (!isNaN(Number(rawVal)) && rawVal !== '') {
      return {
        id: ruleId,
        field,
        operator: op,
        value: Number(rawVal),
      };
    }
    // Boolean
    if (rawVal === 'true' || rawVal === 'false') {
      return {
        id: ruleId,
        field,
        operator: op,
        value: rawVal === 'true',
      };
    }

    return {
      id: ruleId,
      field,
      operator: op,
      value: rawVal,
    };
  }

  // Fallback: treated as equality or raw expression
  return {
    id: ruleId,
    field: trimmed,
    operator: '==',
    value: '',
  };
}

/**
 * Extract an array of BaseFilterRule objects from any Base filters definition.
 */
export function extractFilterRules(filters: any): BaseFilterRule[] {
  if (!filters) return [];

  // 1. Array of conditions
  if (Array.isArray(filters)) {
    return filters.map((item, idx) => {
      if (typeof item === 'string') return expressionToRule(item, `rule-${idx}`);
      return expressionToRule(JSON.stringify(item), `rule-${idx}`);
    });
  }

  // 2. Object with 'and' array
  if (typeof filters === 'object') {
    if (Array.isArray(filters.and)) {
      return filters.and.map((item: any, idx: number) => {
        if (typeof item === 'string') return expressionToRule(item, `rule-${idx}`);
        return expressionToRule(JSON.stringify(item), `rule-${idx}`);
      });
    }
  }

  // 3. Single string expression
  if (typeof filters === 'string' && filters.trim()) {
    return [expressionToRule(filters, 'rule-0')];
  }

  return [];
}

/**
 * Build standard Obsidian filters object from an array of BaseFilterRule items.
 */
export function rulesToFiltersObject(rules: BaseFilterRule[]): { and?: string[] } | undefined {
  if (!rules || rules.length === 0) return undefined;

  const expressions = rules
    .map((r) => ruleToExpression(r))
    .filter((e) => Boolean(e && e.trim()));

  if (expressions.length === 0) return undefined;
  return { and: expressions };
}

/**
 * Format and stringify a BaseConfig into standard Obsidian YAML.
 */
export function stringifyBaseYaml(config: BaseConfig): string {
  // Deep clone to safely sanitize before stringifying
  const clean: Record<string, any> = {};

  // Copy unknown or custom top-level properties first (graceful preservation)
  for (const [key, value] of Object.entries(config)) {
    if (!['filters', 'views', 'properties'].includes(key) && value !== undefined) {
      clean[key] = value;
    }
  }

  // Global filters
  if (config.filters && typeof config.filters === 'object') {
    const fObj: Record<string, any> = {};
    if (Array.isArray(config.filters.and) && config.filters.and.length > 0) {
      fObj.and = config.filters.and;
    }
    if (Array.isArray(config.filters.or) && config.filters.or.length > 0) {
      fObj.or = config.filters.or;
    }
    if (Object.keys(fObj).length > 0) {
      clean.filters = fObj;
    }
  } else if (typeof (config.filters as any) === 'string' && (config.filters as any).trim()) {
    clean.filters = (config.filters as any);
  }

  // Properties config
  if (config.properties && typeof config.properties === 'object') {
    const propClean: Record<string, any> = {};
    for (const [propName, pConf] of Object.entries(config.properties)) {
      if (pConf && typeof pConf === 'object') {
        const entry: Record<string, any> = {};
        if (pConf.displayName) entry.displayName = pConf.displayName;
        if (pConf.type) entry.type = pConf.type;
        if (pConf.width) entry.width = pConf.width;
        // Preserve any custom property flags
        for (const [k, v] of Object.entries(pConf)) {
          if (!['displayName', 'type', 'width'].includes(k) && v !== undefined) {
            entry[k] = v;
          }
        }
        if (Object.keys(entry).length > 0) {
          propClean[propName] = entry;
        }
      }
    }
    if (Object.keys(propClean).length > 0) {
      clean.properties = propClean;
    }
  }

  // Views array
  clean.views = (config.views || [{ type: 'table', name: 'Table' }]).map((v) => {
    const vObj: Record<string, any> = {
      type: v.type || 'table',
      name: v.name || (v.type === 'cards' ? 'Cards' : 'Table'),
    };

    if (v.limit && v.limit > 0) {
      vObj.limit = v.limit;
    }

    if (Array.isArray(v.order) && v.order.length > 0) {
      vObj.order = v.order;
    }

    if (typeof v.columnLimit === 'number' && v.columnLimit > 0) {
      vObj.columnLimit = v.columnLimit;
    }

    if (v.columnSize && typeof v.columnSize === 'object' && Object.keys(v.columnSize).length > 0) {
      vObj.columnSize = v.columnSize;
    }

    if (Array.isArray(v.sort) && v.sort.length > 0) {
      vObj.sort = v.sort.map((s) => ({
        property: s.property,
        direction: (s.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
      }));
    }

    if (v.boardSort && typeof v.boardSort === 'object' && v.boardSort.property) {
      vObj.boardSort = {
        property: v.boardSort.property,
        direction: (v.boardSort.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
      };
    }

    if (v.groupBy && v.groupBy.property) {
      const gb: Record<string, any> = {
        property: v.groupBy.property,
        direction: (v.groupBy.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
      };
      if (Array.isArray(v.groupBy.columns) && v.groupBy.columns.length > 0) {
        gb.columns = v.groupBy.columns.map((c) => {
          if (typeof c === 'string') return c;
          const colClean: Record<string, any> = { name: c.name };
          if (typeof c.limit === 'number') colClean.limit = c.limit;
          if (c.color) colClean.color = c.color;
          if (c.sort && typeof c.sort === 'object' && c.sort.property) {
            colClean.sort = {
              property: c.sort.property,
              direction: (c.sort.direction || '').toLowerCase() === 'desc' ? 'desc' : 'asc',
            };
          }
          return colClean;
        });
      }
      vObj.groupBy = gb;
    }

    if (v.swimlanes && typeof v.swimlanes === 'object' && v.swimlanes.property && v.swimlanes.property.trim()) {
      const sl: Record<string, any> = {
        property: v.swimlanes.property.trim(),
      };
      if (Array.isArray(v.swimlanes.lanes) && v.swimlanes.lanes.length > 0) {
        sl.lanes = v.swimlanes.lanes.map((l) => {
          if (typeof l === 'string') {
            return {
              name: l,
              collapsed: false,
            };
          }
          return {
            name: l.name,
            collapsed: Boolean(l.collapsed),
          };
        });
      }
      if (typeof v.swimlanes.unassignedCollapsed === 'boolean') {
        sl.unassignedCollapsed = v.swimlanes.unassignedCollapsed;
      }
      vObj.swimlanes = sl;
    }

    if (v.filters && typeof v.filters === 'object') {
      const fObj: Record<string, any> = {};
      if (Array.isArray(v.filters.and) && v.filters.and.length > 0) {
        fObj.and = v.filters.and;
      }
      if (Array.isArray(v.filters.or) && v.filters.or.length > 0) {
        fObj.or = v.filters.or;
      }
      if (Object.keys(fObj).length > 0) {
        vObj.filters = fObj;
      }
    }

    // Preserve any custom view fields
    for (const [k, val] of Object.entries(v)) {
      if (
        !['type', 'name', 'limit', 'columnLimit', 'order', 'columnSize', 'sort', 'boardSort', 'groupBy', 'swimlanes', 'filters'].includes(k) &&
        val !== undefined
      ) {
        vObj[k] = val;
      }
    }

    return vObj;
  });

  return YAML.stringify(clean, {
    indent: 2,
    lineWidth: 0,
  });
}

/**
 * Extract all unique properties found across vault notes.
 */
export function extractVaultProperties(allNotes: any[]): { key: string; label: string; count: number }[] {
  const propMap = new Map<string, number>();

  for (const n of allNotes || []) {
    // 1. properties array
    if (Array.isArray(n.properties)) {
      for (const p of n.properties) {
        if (p && p.key && typeof p.key === 'string') {
          const k = p.key.trim();
          propMap.set(k, (propMap.get(k) || 0) + 1);
        }
      }
    }
    // 2. frontmatter dictionary
    if (n.frontmatter && typeof n.frontmatter === 'object') {
      for (const k of Object.keys(n.frontmatter)) {
        if (typeof k === 'string') {
          const cleanK = k.trim();
          propMap.set(cleanK, (propMap.get(cleanK) || 0) + 1);
        }
      }
    }
  }

  const result: { key: string; label: string; count: number }[] = [];
  for (const [key, count] of propMap.entries()) {
    result.push({ key, label: key, count });
  }

  // Sort by count descending, then alphabetically
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return result;
}

/**
 * Extract all unique folders from vault notes.
 */
export function extractVaultFolders(allNotes: any[]): string[] {
  const folderSet = new Set<string>();

  for (const n of allNotes || []) {
    const p = n.path || '';
    if (p.includes('/')) {
      const folder = p.slice(0, p.lastIndexOf('/'));
      if (folder) folderSet.add(folder);
    }
  }

  return Array.from(folderSet).sort();
}

/**
 * Extract all unique tags from vault notes.
 */
export function extractVaultTags(allNotes: any[]): string[] {
  const tagSet = new Set<string>();

  for (const n of allNotes || []) {
    if (Array.isArray(n.tags)) {
      for (const t of n.tags) {
        if (typeof t === 'string' && t.trim()) {
          tagSet.add(t.trim().replace(/^#/, ''));
        }
      }
    }
  }

  return Array.from(tagSet).sort();
}

/**
 * Extract all unique non-empty values for a given property across vault notes or records.
 */
export function extractPropertyValues(allNotes: any[], propKey: string): string[] {
  const cleanKey = (propKey || '').trim().toLowerCase();
  if (!cleanKey) return [];

  const values: string[] = [];
  const seenLower = new Set<string>();

  const addVal = (rawVal: any) => {
    if (rawVal === undefined || rawVal === null) return;
    const items = Array.isArray(rawVal) ? rawVal : [rawVal];
    for (const item of items) {
      const str = String(item).trim();
      if (!str) continue;
      const lower = str.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        values.push(str);
      }
    }
  };

  for (const n of allNotes || []) {
    if (!n) continue;
    // 1. properties array
    if (Array.isArray(n.properties)) {
      for (const p of n.properties) {
        if (p && typeof p.key === 'string' && p.key.trim().toLowerCase() === cleanKey) {
          addVal(p.value);
        }
      }
    } else if (n.properties && typeof n.properties === 'object') {
      // BaseRecord properties dictionary
      for (const [k, v] of Object.entries(n.properties)) {
        if (k.trim().toLowerCase() === cleanKey) {
          addVal(v);
        }
      }
    }

    // 2. frontmatter dictionary
    if (n.frontmatter && typeof n.frontmatter === 'object') {
      for (const [k, v] of Object.entries(n.frontmatter)) {
        if (k.trim().toLowerCase() === cleanKey) {
          addVal(v);
        }
      }
    }
  }

  return values;
}

export { sortColumnNotes } from './baseEngine';

