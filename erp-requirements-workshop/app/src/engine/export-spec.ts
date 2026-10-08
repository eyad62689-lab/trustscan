// Tolerant normaliser for bank-data/export.json. The bank schema does not fix its shape, so
// we accept several aliases and record unrecognised top-level keys in the bank report.
import type { ExportSpec, RegRow, SetupRow, VerifyItem, Expr } from './types';

const str = (v: any): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(str).filter(Boolean).join('، ') : typeof v === 'object' && 'text' in v ? str(v.text) : undefined);
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const asArr = (v: any): any[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

function exprOf(o: any): Expr | undefined {
  const e = pick(o, 'when', 'condition', 'if', 'writeWhen', 'expr');
  return e === undefined ? undefined : e;
}

const KNOWN = new Set([
  'chapters', 'chapterTitles', 'structure', 'sections', 'fixedTexts', 'texts', 'text', 'regulatory', 'regulatoryRows', 'rows47', 'section47', '4.7',
  'verify', 'verifyItems', 'items48', 'section48', '4.8', 'checklist', 'setup', 'setupRows', 'rows49', 'section49', '4.9', 'setupTasks',
  'outOfScope', 'outOfScopeLines', 'workshop', 'guide', 'facilitatorGuide', 'privacy', 'privacyNotice', 'yamlKeys', 'yaml', 'appendix',
  'sectionChapters', 'chapterMap', 'meta', 'bankVersion', 'version', 'date', 'notes', 'note', 'part', 'source',
]);

function findArr(raw: any, names: string[]): any[] {
  for (const n of names) {
    const v = raw?.[n];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      if (Array.isArray(v.rows)) return v.rows;
      if (Array.isArray(v.items)) return v.items;
      // grouped object {a: {title, rows}, b: {...}} or {a: [...], b: [...]}
      const groups = Object.entries(v);
      if (groups.length && groups.every(([, g]) => Array.isArray(g) || (g && typeof g === 'object' && (Array.isArray((g as any).rows) || Array.isArray((g as any).items))))) {
        const out: any[] = [];
        for (const [gk, g] of groups) {
          const rows = Array.isArray(g) ? g : (g as any).rows || (g as any).items;
          for (const r of rows) out.push({ group: (g as any).group ?? (g as any).id ?? gk, ...r });
        }
        return out;
      }
    }
  }
  // nested under chapters/sections with id "4.7" etc.
  return [];
}

function findChapterRows(raw: any, id: string): any[] {
  const chapters = asArr(raw?.chapters ?? raw?.structure ?? raw?.sections);
  const stack = [...chapters];
  while (stack.length) {
    const c = stack.shift();
    if (!c || typeof c !== 'object') continue;
    if (String(c.id ?? c.number ?? c.key ?? '').replace(/^ch/, '') === id) {
      if (Array.isArray(c.rows)) return c.rows;
      if (Array.isArray(c.items)) return c.items;
      if (Array.isArray(c.groups)) return c.groups.flatMap((g: any) => (g.rows || g.items || []).map((r: any) => ({ group: g.id ?? g.group ?? g.key, ...r })));
      if (Array.isArray(c.tables)) return c.tables.flatMap((g: any) => (g.rows || []).map((r: any) => ({ group: g.id ?? g.group ?? g.key, ...r })));
    }
    for (const k of ['children', 'subsections', 'sections', 'chapters']) if (Array.isArray(c[k])) stack.push(...c[k]);
  }
  return [];
}

export function normalizeExport(raw: any): ExportSpec {
  const spec: ExportSpec = {
    chapterTitles: {},
    texts: {},
    regulatoryRows: [],
    verifyItems: [],
    setupRows: [],
    outOfScopeLines: [],
    sectionChapters: {},
    guide: [],
    yamlKeys: {},
    unknownKeys: [],
    raw,
  };
  if (!raw || typeof raw !== 'object') return spec;
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) spec.unknownKeys.push(k);

  // chapter titles
  const chapters = asArr(pick(raw, 'chapters', 'structure', 'chapterTitles'));
  const walkCh = (list: any[]) => {
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      const id = str(pick(c, 'id', 'number', 'key'));
      const title = str(pick(c, 'title', 'name', 'heading'));
      if (id && title) spec.chapterTitles[id] = title;
      for (const k of ['children', 'subsections', 'sections', 'chapters']) if (Array.isArray(c[k])) walkCh(c[k]);
      const secs = pick(c, 'sectionIds', 'sectionsIncluded', 'fromSections');
      if (id && Array.isArray(secs)) for (const s of secs) spec.sectionChapters[String(s)] = id;
    }
  };
  walkCh(chapters);
  if (raw.chapterTitles && !Array.isArray(raw.chapterTitles) && typeof raw.chapterTitles === 'object')
    for (const [k, v] of Object.entries(raw.chapterTitles)) if (typeof v === 'string') spec.chapterTitles[k] = v;

  // fixed texts
  const texts = pick(raw, 'fixedTexts', 'texts');
  if (texts && typeof texts === 'object') {
    for (const [k, v] of Object.entries(texts)) {
      const s = str(v);
      if (s) spec.texts[k] = s;
    }
  }

  const sc = pick(raw, 'sectionChapters', 'chapterMap');
  if (sc && typeof sc === 'object') for (const [k, v] of Object.entries(sc)) spec.sectionChapters[k] = String(v);

  // 4.7
  let r47 = findArr(raw, ['regulatoryRows', 'regulatory', 'rows47', 'section47', '4.7']);
  if (!r47.length) r47 = findChapterRows(raw, '4.7');
  spec.regulatoryRows = r47.map((r: any, i: number): RegRow => {
    const variants = asArr(pick(r, 'variants', 'cases', 'rulings', 'special', 'specialCases')).map((v: any) => ({
      when: exprOf(v),
      ruling: str(pick(v, 'ruling', 'judgement', 'judgment', 'text', 'status')),
      phase: str(pick(v, 'phase', 'stage')),
      note: str(pick(v, 'note', 'verify', 'notes')),
      outOfScope: !!pick(v, 'outOfScope', 'toOutOfScope'),
      omit: !!pick(v, 'omit', 'hide'),
    }));
    const rulingRaw = pick(r, 'ruling', 'judgement', 'judgment', 'status');
    if (Array.isArray(rulingRaw)) for (const v of rulingRaw) variants.push({ when: exprOf(v), ruling: str(pick(v, 'text', 'ruling')), phase: str(v.phase), note: str(v.note), outOfScope: !!v.outOfScope, omit: false });
    return {
      id: str(pick(r, 'id', 'key')) || `r${i + 1}`,
      item: str(pick(r, 'item', 'title', 'name', 'label')) || '',
      ruling: Array.isArray(rulingRaw) ? undefined : str(rulingRaw ?? pick(r, 'rulingText', 'default')),
      phase: str(pick(r, 'phase', 'stage')),
      note: str(pick(r, 'note', 'verify', 'notes')),
      when: exprOf(r),
      variants,
      outOfScope: !!pick(r, 'outOfScope'),
    };
  });

  // 4.8
  let r48 = findArr(raw, ['verifyItems', 'verify', 'items48', 'section48', '4.8', 'checklist']);
  if (!r48.length) r48 = findChapterRows(raw, '4.8');
  spec.verifyItems = r48.map((r: any): VerifyItem => ({
    group: str(pick(r, 'group', 'table')),
    item: str(pick(r, 'item', 'title', 'text', 'label')) || '',
    ref: str(pick(r, 'ref', 'refs', 'question', 'questions', 'related', 'source')),
    what: str(pick(r, 'what', 'check', 'verify', 'toVerify')),
    when: exprOf(r),
  }));

  // 4.9
  let r49 = findArr(raw, ['setupRows', 'setup', 'rows49', 'section49', '4.9', 'setupTasks']);
  if (!r49.length) r49 = findChapterRows(raw, '4.9');
  spec.setupRows = r49.map((r: any): SetupRow => ({
    group: str(pick(r, 'group', 'table')),
    n: pick(r, 'n', 'no', 'num', 'number', 'id'),
    task: str(pick(r, 'task', 'title', 'text', 'item')) || '',
    owner: str(pick(r, 'owner', 'by', 'doer', 'responsible')),
    ref: str(pick(r, 'ref', 'refs', 'question', 'questions', 'related')),
    whenText: str(pick(r, 'whenText', 'writeWhenText', 'conditionText')),
    when: exprOf(r),
  }));

  // out of scope
  spec.outOfScopeLines = asArr(pick(raw, 'outOfScopeLines', 'outOfScope'))
    .map((r: any) => (typeof r === 'string' ? { text: r } : { when: exprOf(r), text: str(pick(r, 'text', 'line', 'item')) || '' }))
    .filter((r: any) => r.text);

  // workshop: privacy + guide
  const ws = raw.workshop || {};
  spec.privacy = str(pick(ws, 'privacy', 'privacyNotice')) ?? str(pick(raw, 'privacy', 'privacyNotice'));
  const guide = pick(ws, 'guide', 'facilitatorGuide') ?? pick(raw, 'guide', 'facilitatorGuide');
  spec.guide = asArr(guide)
    .map((g: any) =>
      typeof g === 'string'
        ? { title: '', body: g }
        : { title: str(pick(g, 'title', 'heading')) || '', body: Array.isArray(g.items) ? g.items.map((x: any) => '- ' + (str(x) || '')).join('\n') : str(pick(g, 'body', 'text', 'content')) || '' },
    )
    .filter((g: any) => g.title || g.body);

  const yk = pick(raw, 'yamlKeys', 'yaml', 'appendix');
  if (yk && typeof yk === 'object' && !Array.isArray(yk)) for (const [k, v] of Object.entries(yk)) if (typeof v === 'string') spec.yamlKeys[k] = v;
  return spec;
}
