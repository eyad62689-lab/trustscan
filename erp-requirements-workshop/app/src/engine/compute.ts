// derive(bank, ws): flags, modules, visibility (fixed point), effective values, recommendations,
// conflicts, automatic flags and archived (hidden-but-answered) answers.
import type { Bank, Expr, Part, Question, Workshop, QAnswer, Conflict, Option, Column } from './types';
import { parseRef, type Ref } from './refs';
import { findPart } from './load';

export interface AutoFlag {
  key: string;
  qid: string;
  text: string;
  kind: 'conflict' | 'dont_know' | 'missing_slot';
  conflictId?: string;
  status: 'open' | 'answered' | 'assumed';
  resolution?: string;
}

export interface Rec {
  value: any;
  reason?: string;
  text?: string;
}

export interface DeriveOptions {
  /** Treat visible unanswered questions as answered with the recommended value (export / review). */
  assumeUnanswered?: boolean;
}

export interface KeyLabel { key: string; label: string }

export interface Derived {
  bank: Bank;
  ws: Workshop;
  opts: DeriveOptions;
  flags: Record<string, boolean>;
  modules: Record<string, boolean>;
  visibleSections: Set<string>;
  visibleQuestions: Set<string>;
  visibleParts: Set<string>;
  forced: Set<string>;
  firedConflicts: Conflict[];
  notes: Conflict[];
  autoFlags: AutoFlag[];
  archived: string[];
  iterations: number;
  value(ref: string | Ref, local?: LocalCtx): any;
  partValue(q: Question, p: Part): any;
  rec(q: Question, p: Part): Rec;
  evalExpr(e: Expr, local?: LocalCtx): boolean;
  isAnswered(qid: string): boolean;
  isAssumed(qid: string): boolean;
  /** options of a choice part incl. optionsFrom, filtered by option conditions */
  visibleOptions(q: Question, p: Part): Option[];
  /** all options (no condition filter) — for labels */
  allOptions(q: Question, p: Part): Option[];
  columnOptions(c: Column): Option[];
  visibleColumns(p: Part): Column[];
  listRows(q: Question, p: Part): any[];
  roleOptions(): KeyLabel[];
  roleLabel(v: any): string;
  branchOptions(): KeyLabel[];
  sectionVisible(id: string): boolean;
  unitPriority(unit: string): string | undefined;
  toRows(p: Part, v: any): any[];
}

export interface LocalCtx {
  row?: any;
  rowPart?: string; // "QID#part" iterated by forEachRow / perItem over rows
  item?: Option & { priority?: string };
  itemPart?: string;
  rowFilter?: { pk: string; where: [string, string, any] };
  /** matrix cell iteration (template iterates a matrix and names the cell with MISSING placeholders) */
  cell?: { key: string; label: string; value: string };
}

export const isEmpty = (v: any): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Normalise any answer value to a list of keys for comparisons. */
export function keysOf(v: any): any[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => (x && typeof x === 'object' ? [] : [x]));
  if (typeof v === 'object') return Object.keys(v);
  return [v];
}

const truthy = (v: any) => v === true || v === 'yes' || v === 'true' || v === 1;

export function answerHasContent(a: QAnswer | undefined): boolean {
  if (!a) return false;
  if (a.dontKnow) return true;
  return Object.values(a.parts || {}).some((v) => !isEmpty(v));
}

export const DEFAULT_RECIPIENT_LABELS: Record<string, string> = {
  document_creator: 'مُنشئ المستند',
  approver_concerned: 'المعتمِد المعني',
  custody_holder: 'حامل العهدة',
  cashbox_officer: 'مسؤول الصندوق',
  branch_cashier: 'أمين صندوق الفرع',
  sole_user: 'المستخدم الوحيد',
};

const LIST_TYPES = new Set(['list', 'matrix']);

export function cmp(a: any, op: string, b: any): boolean {
  const x = typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)) ? Number(a) : a;
  switch (op) {
    case '>': return typeof x === 'number' && x > b;
    case '>=': return typeof x === 'number' && x >= b;
    case '<': return typeof x === 'number' && x < b;
    case '<=': return typeof x === 'number' && x <= b;
    case '==': case '=':
      if (b === '' || b === null) return isEmpty(x);
      if (typeof b === 'boolean') return truthy(x) === b;
      return x == b;
    case '!=':
      if (b === '' || b === null) return !isEmpty(x);
      if (typeof b === 'boolean') return truthy(x) !== b;
      return x != b;
    default: return false;
  }
}

export function rowMatches(row: any, where: [string, string, any] | undefined): boolean {
  if (!where) return true;
  const [col, op, val] = where;
  const cell = row?.[col];
  if (Array.isArray(cell) && !(val === '' || val === null)) return op === '!=' ? !cell.includes(val) : cell.some((c) => cmp(c, op, val));
  return cmp(cell, op, val);
}

export function derive(bank: Bank, ws: Workshop, opts: DeriveOptions = {}): Derived {
  let vis = {
    sections: new Set<string>(bank.sections.map((s) => s.id)),
    questions: new Set<string>(bank.questions.map((q) => q.id)),
    parts: new Set<string>(bank.questions.flatMap((q) => q.parts.map((p) => `${q.id}#${p.key}`))),
  };
  let flagCache = new Map<string, boolean>();
  let moduleCache = new Map<string, boolean>();
  let valueCache = new Map<string, any>();
  let recCache = new Map<string, Rec>();
  const recStack = new Set<string>();
  const moduleStack = new Set<string>();
  const valueStack = new Set<string>();
  const hasQ = (id: string) => bank.questionById.has(id);
  const flagsById = new Map(bank.flags.map((f) => [f.id, f]));

  const scopeQ = bank.questionById.get(bank.scopeQid);
  const scopePart = findPart(scopeQ);
  const moduleOption = (unit: string): Option | undefined =>
    scopePart?.options?.find((o) => o.module === unit || (!o.module && o.key.toUpperCase() === unit));

  // ---------- helpers ----------
  function dkKey(p: Part): string | undefined {
    return p.options?.find((o) => o.dontKnow)?.key;
  }

  function rawPart(q: Question, p: Part): any {
    return ws.answers[q.id]?.parts?.[p.key];
  }

  function partIsDontKnow(q: Question, p: Part): boolean {
    const a = ws.answers[q.id];
    if (!a) return false;
    if (a.dontKnow) return true;
    const v = a.parts?.[p.key];
    const dk = dkKey(p);
    if (!dk) return false;
    return v === dk || (Array.isArray(v) && v.includes(dk)) || (!!v && typeof v === 'object' && !Array.isArray(v) && dk in v);
  }

  function labelColumn(p: Part): string {
    if (p.rowsFromColumn) return p.rowsFromColumn;
    const cols = p.columns || [];
    return (cols.find((c) => ['name', 'role', 'title', 'label', 'list', 'entity_name', 'item', 'type', 'report', 'event', 'document'].includes(c.key)) || cols.find((c) => c.type === 'text') || cols[0])?.key || 'name';
  }

  function toRows(p: Part, v: any): any[] {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.filter((r) => r !== null && r !== undefined).map((r, i) => (typeof r === 'object' ? { ...r, _k: r._k ?? r.key ?? String(i + 1) } : { _k: String(i + 1), [labelColumn(p)]: r }));
    if (typeof v === 'object') {
      const first = (p.columns || [])[0]?.key || 'value';
      return Object.entries(v).map(([k, x]) => ({ _k: k, ...(x && typeof x === 'object' && !Array.isArray(x) ? x : { [first]: x }) }));
    }
    return [];
  }

  // ---------- values ----------
  function partValue(q: Question, p: Part): any {
    const k = `${q.id}#${p.key}`;
    if (valueCache.has(k)) return valueCache.get(k);
    if (valueStack.has(k)) return undefined;
    valueStack.add(k);
    let v: any;
    if (!vis.questions.has(q.id) || !vis.parts.has(k)) v = undefined;
    else if (partIsDontKnow(q, p) && !LIST_TYPES.has(p.type)) v = rec(q, p).value;
    else {
      v = rawPart(q, p);
      if (LIST_TYPES.has(p.type)) {
        v = isEmpty(v) ? (opts.assumeUnanswered || partIsDontKnow(q, p) ? listRows(q, p) : undefined) : listRows(q, p);
        if (Array.isArray(v) && p.type === 'list' && !v.length && !opts.assumeUnanswered) v = undefined;
      } else if (isEmpty(v) && opts.assumeUnanswered) v = rec(q, p).value;
      if (p.type === 'approvalRow' && Array.isArray(v)) v = v[0];
      if (p.type === 'multiPriority' && Array.isArray(v)) v = Object.fromEntries(v.map((x: string) => [x, null]));
      if (p.type === 'multiPriority' && v && typeof v === 'object') {
        const def = unitPriority(q.section) || bank.defaultPriority;
        v = Object.fromEntries(Object.entries(v).map(([kk, pr]) => [kk, pr || (q.id === bank.scopeQid ? null : def)]));
      }
    }
    valueStack.delete(k);
    valueCache.set(k, v);
    return v;
  }

  function itemAttr(field: string, local?: LocalCtx): any {
    if (local?.row) return field === 'key' ? local.row._k : field === 'label' ? local.row._label ?? local.row[labelColumn(partOf(local.rowPart))] : local.row[field];
    if (local?.item) return field === 'key' ? local.item.key : (local.item as any)[field];
    return undefined;
  }

  function partOf(pk?: string): Part {
    if (!pk) return { key: 'main', type: 'list' };
    const [qid, key] = pk.split('#');
    return findPart(bank.questionById.get(qid), key) || { key: 'main', type: 'list' };
  }

  function resolveRefValue(r: Ref, local?: LocalCtx): any {
    if (r.qid.startsWith('@item')) return itemAttr(r.qid.slice(6) || 'key', local);
    const q = bank.questionById.get(r.qid);
    if (!q) return undefined;
    let p = findPart(q, r.part);
    if (!p) return undefined;
    const pk = `${q.id}#${p.key}`;
    if (local?.item && local.itemPart === pk && !r.sub) return local.item.key;
    const v = partValue(q, p);
    if (!r.sub && r.row === undefined) return v;
    return subValue(q, p, v, r, local);
  }

  function subValue(q: Question, p: Part, v: any, r: Ref, local?: LocalCtx): any {
    const pk = `${q.id}#${p.key}`;
    const sub = r.sub;
    if (LIST_TYPES.has(p.type)) {
      let rows: any[] = Array.isArray(v) ? v : toRows(p, v);
      if (local?.rowFilter && local.rowFilter.pk === pk) rows = rows.filter((x) => rowMatches(x, local.rowFilter!.where));
      if (r.row !== undefined) {
        let row: any;
        if (r.row === 'row' || r.row === '' || r.row === 'item') row = local?.rowPart === pk ? local.row : local?.item ? rows.find((x) => x._k === local.item!.key) : undefined;
        else if (r.row === 'last') row = rows[rows.length - 1];
        else if (/^\d+$/.test(r.row)) row = rows[Number(r.row) - 1];
        else row = rows.find((x) => x._k === r.row || x.key === r.row);
        return sub ? row?.[sub] : row;
      }
      const isCol = !!sub && ((p.columns || []).some((c) => c.key === sub) || sub === '_label');
      if (isCol && local?.rowPart === pk && local.row) return local.row[sub!];
      if (isCol) return rows.map((x) => x[sub!]).filter((x) => !isEmpty(x)).flat();
      if (sub) {
        const row2 = rows.find((x) => x._k === sub || x.key === sub);
        if (row2) {
          const vals = Object.entries(row2).filter(([k]) => !k.startsWith('_') && k !== 'key' && k !== 'label' && k !== 'condition' && k !== 'recommended');
          return vals.length === 1 ? vals[0][1] : row2;
        }
        return undefined;
      }
      return rows;
    }
    if (p.type === 'approvalRow') return sub ? v?.[sub] : v;
    if (sub === 'other') return ws.answers[q.id]?.other?.[p.key];
    if (sub && sub.endsWith('_priority') && v && typeof v === 'object') return v[sub.slice(0, -'_priority'.length)];
    if (sub && v && typeof v === 'object' && !Array.isArray(v)) return sub in v ? sub : undefined;
    if (sub) return keysOf(v).includes(sub) ? sub : undefined;
    return v;
  }

  function value(ref: string | Ref, local?: LocalCtx): any {
    const r = typeof ref === 'string' ? parseRef(ref, hasQ) : ref;
    return resolveRefValue(r, local);
  }

  // ---------- recommendations ----------
  function rec(q: Question, p: Part): Rec {
    const k = `${q.id}#${p.key}`;
    if (recCache.has(k)) return recCache.get(k)!;
    if (recStack.has(k)) return { value: undefined };
    recStack.add(k);
    let out: Rec = { value: undefined };
    const r = p.recommended;
    let whenRowsFrom: string | undefined;
    if (r) {
      out = { value: r.value, reason: r.reason, text: r.text };
      for (const w of r.when || []) {
        if (evalExpr(w.if)) {
          out = { value: w.value, reason: w.reason ?? r.reason, text: w.text ?? r.text };
          whenRowsFrom = (w as any).rowsFrom;
          break;
        }
      }
    }
    if (p.type === 'multiPriority') {
      let v = out.value;
      if (Array.isArray(v)) v = Object.fromEntries(v.map((x: string) => [x, null]));
      if (v && typeof v === 'object' && q.id !== bank.scopeQid) {
        const def = unitPriority(q.section) || bank.defaultPriority;
        v = Object.fromEntries(Object.entries(v).map(([kk, pr]) => [kk, pr || def]));
      }
      out = { ...out, value: v };
    }
    if (LIST_TYPES.has(p.type)) out = { ...out, value: prefillRows(q, p, out.value, whenRowsFrom) };
    if (p.type === 'approvalRow' && Array.isArray(out.value)) out = { ...out, value: out.value[0] };
    recStack.delete(k);
    recCache.set(k, out);
    return out;
  }

  // ---------- option / row sources ----------
  /** Rows of a source ref: list part rows (key+label), or selected options of a choice part. */
  function sourceItems(src: string): KeyLabel[] {
    if (src === bank.rolesQid || src.startsWith(bank.rolesQid + '#')) {
      const r = parseRef(src, hasQ);
      if (!r.sub) return roleOptions().filter((o) => !DEFAULT_RECIPIENT_LABELS[o.key] || o.key === 'sole_user');
    }
    const r = parseRef(src, hasQ);
    const q = bank.questionById.get(r.qid);
    if (!q) return [];
    let p = findPart(q, r.part);
    if (!p) return [];
    if (!r.part && !LIST_TYPES.has(p.type) && p.type !== 'multi' && p.type !== 'multiPriority') p = q.parts.find((x) => LIST_TYPES.has(x.type) || x.type === 'multi' || x.type === 'multiPriority') || p;
    if (LIST_TYPES.has(p.type)) {
      const pk = `${q.id}#${p.key}`;
      const rows: any[] = vis.parts.has(pk) && vis.questions.has(q.id) ? (Array.isArray(partValue(q, p)) ? partValue(q, p) : listRows(q, p)) : [];
      const col = r.sub || labelColumn(p);
      const colDef = (p.columns || []).find((c) => c.key === col);
      return rows
        .map((row, i) => {
          const raw = r.sub ? row[col] : row._label ?? row[col];
          const label = colDef?.type === 'role' ? roleLabel(raw) : Array.isArray(raw) ? raw.join('، ') : String(raw ?? '');
          return { key: String(r.sub ? raw ?? i + 1 : row._k ?? i + 1), label };
        })
        .filter((x) => x.label);
    }
    if (!vis.questions.has(q.id)) return [];
    const v = partValue(q, p) ?? rawPart(q, p);
    const all = allOptions(q, p);
    return keysOf(v)
      .map((k) => all.find((o) => o.key === k))
      .filter((o): o is Option => !!o && !o.dontKnow && !o.deferred && !o.exclusive)
      .map((o) => ({ key: o.key, label: o.other ? ws.answers[q.id]?.other?.[p!.key] || o.label : o.label }));
  }

  function fromSources(src: string | string[] | undefined | null): Option[] {
    if (!src) return [];
    const list = Array.isArray(src) ? src : [src];
    const out: Option[] = [];
    for (const s of list) for (const it of sourceItems(s)) if (!out.some((o) => o.key === it.key)) out.push({ key: it.key, label: it.label });
    return out;
  }

  function allOptions(q: Question, p: Part): Option[] {
    const base = p.options || [];
    if (!p.optionsFrom) return base;
    const dyn = fromSources(p.optionsFrom);
    const extra = String(p.optionsFrom).startsWith(bank.rolesQid) ? roleOptions().filter((o) => DEFAULT_RECIPIENT_LABELS[o.key] && !dyn.some((x) => x.key === o.key)).map((o) => ({ key: o.key, label: o.label })) : [];
    return [...dyn, ...extra, ...base.filter((o) => !dyn.some((d) => d.key === o.key))];
  }

  function visibleOptions(q: Question, p: Part): Option[] {
    return allOptions(q, p).filter((o) => o.condition === undefined || o.condition === null || evalExpr(o.condition));
  }

  function columnOptions(c: Column): Option[] {
    if (c.type === 'role') return roleOptions();
    if (c.type === 'branch') return branchOptions();
    const base = (c.options || []).filter((o) => o.condition === undefined || o.condition === null || evalExpr(o.condition));
    const src = c.optionsFrom || c.rowsFrom;
    if (!src) return base;
    const dyn = fromSources(src);
    return [...base, ...dyn.filter((d) => !base.some((b) => b.key === d.key))];
  }

  function visibleColumns(p: Part): Column[] {
    return (p.columns || []).filter((c) => c.condition === undefined || c.condition === null || evalExpr(c.condition));
  }

  function rowRec(row: any): any {
    const r = row?.recommended;
    if (r === undefined || r === null) return {};
    if (typeof r === 'object' && ('value' in r || 'when' in r)) {
      let v = r.value;
      for (const w of r.when || []) if (evalExpr(w.if)) { v = w.value; break; }
      return v;
    }
    return r;
  }

  function expandPlaceholders(rows: any[], src: string): any[] {
    const items = sourceItems(src);
    if (!items.length) return rows;
    const out: any[] = [];
    for (const r of rows) {
      if (r.templateRow || !JSON.stringify(r).match(/<[^<>]*(الفرع|branch)[^<>]*>/)) { out.push(r); continue; }
      for (const it of items) {
        const o: any = {};
        for (const [k, x] of Object.entries(r)) o[k] = typeof x === 'string' ? x.replace(/<اسم الفرع>|<الفرع>/g, it.label) : x;
        out.push(o);
      }
    }
    return out;
  }

  /** Recommended / prefilled rows for list & matrix parts. */
  function prefillRows(q: Question, p: Part, recValue: any, whenRowsFrom?: string): any[] {
    const defaults = { ...(p.recommended?.columnDefaults || {}), ...(p.recommended?.rowDefault || {}) };
    const lc = labelColumn(p);
    let recRows = toRows(p, recValue).filter((r) => !('condition' in r) || evalExpr(r.condition)).map((r) => { const { condition, conditionText, ...rest } = r; return rest; });
    if (whenRowsFrom) recRows = expandPlaceholders(recRows, whenRowsFrom).map((r, i) => ({ ...r, _k: r._k && !/^\d+$/.test(r._k) ? r._k : String(i + 1) }));
    const recFor = (key: string, label?: string) =>
      recRows.find((r) => r._k === key) ||
      recRows.find((r) => label !== undefined && r[lc] === label) ||
      recRows.find((r) => Object.entries(r).some(([k, x]) => k !== '_k' && (x === key || (label !== undefined && x === label))));
    let base: any[] | null = null;
    if (p.rowsFrom && (!p.rowsFromCondition || evalExpr(p.rowsFromCondition))) {
      const excl = new Set<string>(p.rowsExclude || []);
      base = fromSources(p.rowsFrom).filter((s) => !excl.has(s.key)).map((s) => ({ _k: s.key, _label: s.label, [lc]: s.label }));
    } else if ((p.rows || []).length) {
      base = (p.rows || [])
        .filter((r) => !r || typeof r !== 'object' || !('condition' in r) || evalExpr(r.condition))
        .map((r: any, i: number) => {
          const { condition, conditionText, recommended, label, key, verify, note, phaseOne, added, ...cells } = r || {};
          const rr = rowRec(r);
          const recCells = rr && typeof rr === 'object' ? rr : rr !== undefined && rr !== null && rr !== '' ? { [(p.columns || [])[0]?.key || 'value']: rr } : {};
          return { ...cells, ...recCells, _k: key ?? String(i + 1), ...(label !== undefined ? { _label: label } : {}) };
        });
    }
    for (const x of p.extraRows || []) if (x && evalExpr(x.when)) (base ||= []).push({ ...(x.row || {}), _k: x.row?.key || `extra${(base || []).length + 1}` });
    if (base) {
      const merged = base.map((b) => {
        const r = recFor(b._k, b[lc]);
        const cells = r ? Object.fromEntries(Object.entries(r).filter(([k, x]) => k !== '_k' && k !== 'key' && !(x === null && b[k] !== undefined && b[k] !== null))) : {};
        return { ...defaults, ...b, ...cells, _k: b._k, ...(b._label !== undefined ? { _label: b._label } : {}) };
      });
      return p.distribution ? distribute(p, merged) : merged;
    }
    const out = recRows.map((r) => ({ ...defaults, ...r }));
    return p.distribution ? distribute(p, out) : out;
  }

  /** ROL-001 «قاعدة التوزيع»: spread the available users over the roles in the bank's order. */
  function distribute(p: Part, rows: any[]): any[] {
    const dist = p.distribution || {};
    if (rows.some((r) => r.users !== null && r.users !== undefined && r.users !== '')) return rows;
    let avail: number | undefined;
    const qb = bank.questionById.get('PRF-004.ب');
    if (qb) { const v = partValue(qb, qb.parts[0]); if (typeof v === 'number') avail = v; else if (v !== undefined && !isNaN(Number(v))) avail = Number(v); if (avail === undefined) { const r0 = rec(qb, qb.parts[0]).value; if (typeof r0 === 'number') avail = r0; } }
    if (avail === undefined) avail = flagsById.has(bank.multiUserFlag) && !flag(bank.multiUserFlag) ? 1 : undefined;
    if (avail === undefined) return rows;
    const order: string[] = dist.order || [];
    const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.indexOf('*') >= 0 ? order.indexOf('*') + 0.5 : 999 : i; };
    const sorted = [...rows].sort((a, b) => rank(a._k) - rank(b._k));
    const counts = new Map<string, number>();
    let left = avail;
    for (const r of sorted) { if (left <= 0) break; counts.set(r._k, 1); left--; }
    const surplus: string[] = (dist.surplusTo || []).filter((k: string) => rows.some((r) => r._k === k));
    let i = 0;
    while (left > 0 && surplus.length) { const k = surplus[i++ % surplus.length]; counts.set(k, (counts.get(k) || 0) + 1); left--; }
    return rows.map((r) => ({ ...r, users: counts.get(r._k) ?? 0 }));
  }

  /** Rows to display/edit for a list/matrix part: stored rows merged with dynamic source rows. */
  function listRows(q: Question, p: Part): any[] {
    const stored = rawPart(q, p);
    const pre = rec(q, p).value as any[];
    if (!Array.isArray(stored)) return Array.isArray(pre) ? pre : [];
    if (p.rowsFrom || p.type === 'matrix' || p.fixedRows || p.rowsFixed) {
      const byKey = new Map(stored.map((r: any) => [r._k, r]));
      const fromPre = (pre || []).map((r) => ({ ...r, ...(byKey.get(r._k) || {}), _k: r._k, ...(r._label !== undefined ? { _label: r._label } : {}) }));
      if (p.rowsFrom || p.fixedRows || p.rowsFixed) return fromPre;
      const extra = stored.filter((r: any) => !(pre || []).some((x) => x._k === r._k));
      return [...fromPre, ...extra];
    }
    return stored;
  }

  // ---------- flags / modules ----------
  function flag(id: string): boolean {
    if (flagCache.has(id)) return flagCache.get(id)!;
    flagCache.set(id, false); // cycle guard
    const f = flagsById.get(id);
    const v = f ? evalExpr(f.expr) : false;
    flagCache.set(id, v);
    return v;
  }

  function module(unit: string): boolean {
    if (moduleCache.has(unit)) return moduleCache.get(unit)!;
    if (bank.deferredIds.has(unit)) { moduleCache.set(unit, false); return false; }
    if (moduleStack.has(unit)) return false;
    moduleStack.add(unit);
    let v = false;
    const opt = moduleOption(unit);
    if (opt && scopeQ && scopePart) {
      if (opt.deferred) v = false;
      else v = vis.questions.has(scopeQ.id) && keysOf(partValue(scopeQ, scopePart)).includes(opt.key);
    } else {
      const s = bank.sectionById.get(unit);
      if (s && s.condition !== undefined && s.condition !== null && s.condition !== true) v = evalExpr(s.condition);
    }
    moduleStack.delete(unit);
    moduleCache.set(unit, v);
    return v;
  }

  // ---------- expressions ----------
  function eqVal(v: any, k: any): boolean {
    if (v === undefined || v === null) return false;
    if (typeof k === 'boolean') return truthy(v) === k;
    if (k === 'yes' && v === true) return true;
    if (k === 'no' && v === false) return true;
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v.some((x) => x && typeof x === 'object' ? x._k === k : x === k);
    return keysOf(v).some((x) => x === k || String(x) === String(k));
  }

  function evalExpr(e: Expr, local?: LocalCtx): boolean {
    if (e === true || e === null || e === undefined) return true;
    if (e === false) return false;
    if (typeof e !== 'object') return !!e;
    const [op, arg] = Object.entries(e)[0] || [];
    switch (op) {
      case 'all': return (arg as Expr[]).every((x) => evalExpr(x, local));
      case 'any': return (arg as Expr[]).some((x) => evalExpr(x, local));
      case 'not': return !evalExpr(arg, local);
      case 'flag': return flag(arg);
      case 'module': return module(arg);
      case 'text': return true;
      case 'unresolved': return false;
      case 'eq': return eqVal(value(arg[0], local), arg[1]);
      case 'ne': { const v = value(arg[0], local); return !isEmpty(v) && !eqVal(v, arg[1]); }
      case 'in': return (arg[1] as any[]).some((k) => eqVal(value(arg[0], local), k));
      case 'has': return eqVal(value(arg[0], local), arg[1]);
      case 'hasAny': return (arg[1] as any[]).some((k) => eqVal(value(arg[0], local), k));
      case 'hasAll': return (arg[1] as any[]).every((k) => eqVal(value(arg[0], local), k));
      case 'num': { const v = value(arg[0], local); return v !== undefined && v !== null && v !== '' && cmp(Array.isArray(v) ? v[0] : v, arg[1], arg[2]); }
      case 'answered': {
        if (String(arg).startsWith('@item')) return !isEmpty(value(arg, local));
        const r = parseRef(arg, hasQ);
        const q = bank.questionById.get(r.qid);
        if (!q || !vis.questions.has(q.id)) return false;
        if (!r.part) return answerHasContent(ws.answers[q.id]) || (!!opts.assumeUnanswered && !/-099$/.test(q.id) && q.parts.some((p) => vis.parts.has(`${q.id}#${p.key}`) && !isEmpty(partValue(q, p))));
        return !isEmpty(value(r, local));
      }
      case 'visible': {
        if (bank.sectionById.has(arg) && !hasQ(arg)) return vis.sections.has(arg);
        const r = parseRef(arg, hasQ);
        if (!r.part) return vis.questions.has(r.qid);
        return vis.questions.has(r.qid) && vis.parts.has(`${r.qid}#${r.part}`);
      }
      case 'rowsAny': {
        const [ref, col, o, val] = arg;
        const r = parseRef(ref, hasQ);
        const rows = resolveRefValue({ ...r, sub: undefined, row: undefined }, local);
        if (!Array.isArray(rows)) return false;
        return rows.some((row) => rowMatches(row, [col, o, val]));
      }
      default:
        return false;
    }
  }

  // ---------- fixed point visibility ----------
  let iterations = 0;
  let forced = new Set<string>();
  let fired: Conflict[] = [];
  for (; iterations < 12; iterations++) {
    flagCache = new Map(); moduleCache = new Map(); valueCache = new Map(); recCache = new Map();
    const sections = new Set<string>();
    for (const s of bank.sections) {
      let cond = s.condition;
      if ((cond === undefined || cond === null) && s.kind === 'unit' && moduleOption(s.id)) cond = { module: s.id };
      if (evalExpr(cond)) sections.add(s.id);
    }
    fired = bank.conflicts.filter((c) => evalExpr(c.condition));
    forced = new Set(fired.filter((c) => c.action === 'show' && c.target).map((c) => parseRef(c.target!, hasQ).qid));
    const questions = new Set<string>();
    const parts = new Set<string>();
    for (const q of bank.questions) {
      const inSec = sections.has(q.section) || (q.alsoIn || []).some((s) => sections.has(s));
      if ((inSec && evalExpr(q.condition)) || (forced.has(q.id) && (sections.has(q.section) || (q.alsoIn || []).some((s) => sections.has(s))))) {
        questions.add(q.id);
        for (const p of q.parts) if (evalExpr(p.condition)) parts.add(`${q.id}#${p.key}`);
      }
    }
    const same =
      sections.size === vis.sections.size && [...sections].every((x) => vis.sections.has(x)) &&
      questions.size === vis.questions.size && [...questions].every((x) => vis.questions.has(x)) &&
      parts.size === vis.parts.size && [...parts].every((x) => vis.parts.has(x));
    vis = { sections, questions, parts };
    if (same) break;
  }
  flagCache = new Map(); moduleCache = new Map(); valueCache = new Map(); recCache = new Map();

  const flags: Record<string, boolean> = {};
  for (const f of bank.flags) flags[f.id] = flag(f.id);
  const modules: Record<string, boolean> = {};
  for (const s of bank.sections) if (s.kind === 'unit' || moduleOption(s.id)) modules[s.id] = module(s.id);
  for (const o of scopePart?.options || []) if (o.module && !(o.module in modules)) modules[o.module] = module(o.module);
  for (const dd of bank.deferredIds) modules[dd] = false;
  fired = bank.conflicts.filter((c) => evalExpr(c.condition));

  // ---------- automatic flags ----------
  const autoFlags: AutoFlag[] = [];
  const res = ws.autoFlagResolutions || {};
  const mk = (key: string, qid: string, text: string, kind: AutoFlag['kind'], conflictId?: string): AutoFlag => ({
    key, qid, text, kind, conflictId,
    status: res[key]?.status ?? 'open',
    resolution: res[key]?.resolution,
  });
  function firstRef(e: Expr): string | undefined {
    let found: string | undefined;
    const walk = (x: any) => {
      if (found || !x || typeof x !== 'object') return;
      for (const [op, v] of Object.entries(x)) {
        if (['eq', 'ne', 'in', 'has', 'hasAny', 'hasAll', 'num', 'rowsAny'].includes(op)) found = parseRef((v as any[])[0], hasQ).qid;
        else if (op === 'answered' || op === 'visible') found = parseRef(v as string, hasQ).qid;
        else if (op === 'all' || op === 'any') (v as any[]).forEach(walk);
        else if (op === 'not') walk(v);
        if (found) return;
      }
    };
    walk(e);
    return found && hasQ(found) ? found : undefined;
  }
  for (const c of fired) {
    if (c.action !== 'flag') continue;
    let qid = c.target ? parseRef(String(c.target), hasQ).qid : '';
    if (!hasQ(qid)) qid = firstRef(c.condition) || qid;
    let txt = c.flagText || c.text;
    const textConds: string[] = [];
    const findText = (x: any) => { if (!x || typeof x !== 'object') return; if ('text' in x && Object.keys(x).length === 1) textConds.push(String(x.text)); for (const k of ['all', 'any']) if (Array.isArray(x[k])) x[k].forEach(findText); if (x.not) findText(x.not); };
    findText(c.condition);
    if (textConds.length) txt += ` [جزء من شرط هذا التعارض نصي لا يُفحص آلياً: «${textConds.join('»، «')}» — تحقّقوا منه؛ وإن لم يتحقق فاحسموا العلامة بسطر «لا ينطبق».]`;
    autoFlags.push(mk(`conflict:${c.id}`, qid, c.title ? `${c.id} — ${c.title}: ${txt}` : `${c.id}: ${txt}`, 'conflict', c.id));
  }
  const dkList: string[] | undefined = bank.meta.dontKnowFlagQuestions;
  const anyExplicit = bank.questions.some((q) => q.flagOnDontKnow !== undefined);
  for (const q of bank.questions) {
    if (!vis.questions.has(q.id)) continue;
    const sec = bank.sectionById.get(q.section);
    const eligible = q.flagOnDontKnow ?? (dkList ? dkList.includes(q.id) : !anyExplicit && ((sec?.kind === 'profile' && !q.detail && !/-099$/.test(q.id)) || ['TAX-001', 'TAX-002'].includes(q.id)));
    if (!eligible) continue;
    const p = q.parts[0];
    const unanswered = !answerHasContent(ws.answers[q.id]);
    if (partIsDontKnow(q, p) || (opts.assumeUnanswered && unanswered && q.parts.some((x) => x.options?.some((o) => o.dontKnow)))) {
      autoFlags.push(mk(`dk:${q.id}`, q.id, `«لا أعلم» أو بلا إجابة في سؤال وصفي عن الكيان (${q.id}) — يُطبَّق الموصى به حتى الحسم (ق-ت9).`, 'dont_know'));
    }
  }

  const archived = Object.keys(ws.answers).filter((qid) => bank.questionById.has(qid) && !vis.questions.has(qid) && answerHasContent(ws.answers[qid]));

  function roleOptions(): KeyLabel[] {
    const rq = bank.questionById.get(bank.rolesQid);
    const out: KeyLabel[] = [];
    if (rq && vis.questions.has(rq.id)) {
      const p = rq.parts.find((x) => x.type === 'list') || rq.parts[0];
      const rows = listRows(rq, p);
      const col = labelColumn(p);
      for (const r of rows) if (r && !isEmpty(r[col]) && !out.some((o) => o.key === r._k)) out.push({ key: String(r._k), label: String(r[col]) });
    }
    const multi = bank.flags.some((f) => f.id === bank.multiUserFlag) ? flag(bank.multiUserFlag) : true;
    if (!multi) out.unshift({ key: 'sole_user', label: bank.singleUserLabel });
    const dyn = bank.meta.dynamicRecipients;
    const recips: KeyLabel[] = Array.isArray(dyn)
      ? dyn.map((x: any) => (typeof x === 'string' ? { key: x, label: DEFAULT_RECIPIENT_LABELS[x] || x } : { key: x.key, label: x.label }))
      : Object.entries(DEFAULT_RECIPIENT_LABELS).filter(([k]) => k !== 'sole_user').map(([key, label]) => ({ key, label }));
    for (const d of recips) if (!out.some((o) => o.key === d.key)) out.push(d);
    return out;
  }

  function roleLabel(v: any): string {
    if (isEmpty(v)) return '';
    if (Array.isArray(v)) return v.map(roleLabel).filter(Boolean).join('، ');
    const s = String(v);
    const rq = bank.questionById.get(bank.rolesQid);
    const p = rq?.parts.find((x) => x.type === 'list');
    if (rq && p) {
      const row = listRows(rq, p).find((r) => r._k === s) || (p.rows || []).find((r: any) => r.key === s);
      if (row) return String(row[labelColumn(p)] ?? s);
    }
    if (s === 'sole_user') return bank.singleUserLabel;
    return DEFAULT_RECIPIENT_LABELS[s] || s;
  }

  function branchOptions(): KeyLabel[] {
    const bq = bank.questionById.get(bank.branchesQid);
    if (!bq || !vis.questions.has(bq.id)) return [];
    const p = bq.parts.find((x) => x.type === 'list') || bq.parts[0];
    const col = labelColumn(p);
    return listRows(bq, p).map((r) => ({ key: String(r[col] ?? ''), label: String(r[col] ?? '') })).filter((x) => x.label);
  }

  function unitPriority(unit: string): string | undefined {
    const opt = moduleOption(unit);
    if (!opt || !scopeQ || !scopePart) return undefined;
    const v = partValue(scopeQ, scopePart);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v[opt.key] || undefined;
    return undefined;
  }

  return {
    bank, ws, opts, flags, modules,
    visibleSections: vis.sections,
    visibleQuestions: vis.questions,
    visibleParts: vis.parts,
    forced,
    firedConflicts: fired,
    notes: fired.filter((c) => c.action === 'note'),
    autoFlags,
    archived,
    iterations,
    value,
    partValue,
    rec,
    evalExpr,
    isAnswered: (qid) => answerHasContent(ws.answers[qid]),
    isAssumed: (qid) => {
      const a = ws.answers[qid];
      const q = bank.questionById.get(qid);
      return !a || a.source === 'assumption' || !!a.dontKnow || (q?.parts.some((p) => partIsDontKnow(q, p)) ?? false);
    },
    visibleOptions,
    allOptions,
    columnOptions,
    visibleColumns,
    listRows,
    roleOptions,
    roleLabel,
    branchOptions,
    sectionVisible: (id) => vis.sections.has(id),
    unitPriority,
    toRows,
  };
}
