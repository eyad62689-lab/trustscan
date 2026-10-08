// derive(bank, ws): flags, modules, visibility (fixed point), effective values, recommendations,
// conflicts, automatic flags and archived (hidden-but-answered) answers.
import type { Bank, Expr, Part, Question, Workshop, QAnswer, Conflict, Option } from './types';
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
  value(ref: string | Ref): any;
  partValue(q: Question, p: Part): any;
  rec(q: Question, p: Part): Rec;
  evalExpr(e: Expr, local?: LocalCtx): boolean;
  isAnswered(qid: string): boolean;
  isAssumed(qid: string): boolean;
  visibleOptions(q: Question, p: Part): Option[];
  listRows(q: Question, p: Part): any[];
  roleOptions(): string[];
  branchOptions(): string[];
  sectionVisible(id: string): boolean;
  unitPriority(unit: string): string | undefined;
}

export interface LocalCtx {
  row?: any;
  rowPart?: string; // "QID#part" iterated by forEachRow
  item?: Option & { priority?: string };
  itemPart?: string;
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
  const hasQ = (id: string) => bank.questionById.has(id);

  const scopeQ = bank.questionById.get(bank.scopeQid);
  const scopePart = findPart(scopeQ);
  const moduleOption = (unit: string): Option | undefined =>
    scopePart?.options?.find((o) => o.module === unit || (!o.module && o.key.toUpperCase() === unit));

  // ---------- values ----------
  function dkKey(p: Part): string | undefined {
    return p.options?.find((o) => o.dontKnow)?.key;
  }

  function rawPart(q: Question, p: Part): any {
    const a = ws.answers[q.id];
    if (!a) return undefined;
    return a.parts?.[p.key];
  }

  function partIsDontKnow(q: Question, p: Part): boolean {
    const a = ws.answers[q.id];
    if (!a) return false;
    if (a.dontKnow) return true;
    const v = a.parts?.[p.key];
    const dk = dkKey(p);
    if (!dk) return false;
    return v === dk || (Array.isArray(v) && v.includes(dk)) || (v && typeof v === 'object' && !Array.isArray(v) && dk in v);
  }

  function partValue(q: Question, p: Part): any {
    const k = `${q.id}#${p.key}`;
    if (valueCache.has(k)) return valueCache.get(k);
    let v: any;
    if (!vis.questions.has(q.id) || !vis.parts.has(k)) v = undefined;
    else if (partIsDontKnow(q, p)) v = rec(q, p).value;
    else {
      v = rawPart(q, p);
      if (isEmpty(v) && opts.assumeUnanswered) {
        if (p.type === 'list' || p.type === 'matrix') v = listRows(q, p);
        if (isEmpty(v)) v = rec(q, p).value;
      }
    }
    valueCache.set(k, v);
    return v;
  }

  function resolveRefValue(r: Ref, local?: LocalCtx): any {
    const q = bank.questionById.get(r.qid);
    if (!q) return undefined;
    const p = findPart(q, r.part);
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
    if (p.type === 'list' || p.type === 'matrix') {
      const rows: any[] = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => ({ _k: k, ...(typeof x === 'object' ? x : { value: x }) })) : [];
      let row: any;
      if (r.row !== undefined) {
        if (r.row === 'row' || r.row === '') row = local?.rowPart === pk ? local.row : undefined;
        else if (/^\d+$/.test(r.row)) row = rows[Number(r.row) - 1];
        else row = rows.find((x) => x._k === r.row || x.key === r.row);
        return sub ? row?.[sub] : row;
      }
      if (sub && local?.rowPart === pk && local.row && (p.columns || []).some((c) => c.key === sub)) return local.row[sub];
      if (sub && (p.columns || []).some((c) => c.key === sub)) return rows.map((x) => x[sub]).filter((x) => !isEmpty(x)).flat();
      if (sub) {
        const row2 = rows.find((x) => x._k === sub || x.key === sub);
        if (row2) {
          const vals = Object.entries(row2).filter(([k]) => !k.startsWith('_') && k !== 'key' && k !== 'label' && k !== 'condition');
          return vals.length === 1 ? vals[0][1] : row2;
        }
        return undefined;
      }
      return rows;
    }
    if (p.type === 'approvalRow') return sub ? v?.[sub] : v;
    if (sub === 'other') return ws.answers[q.id]?.other?.[p.key] ?? ws.answers[q.id]?.other?.[`${p.key}.other`];
    if (sub && sub.endsWith('_priority') && v && typeof v === 'object') return v[sub.slice(0, -'_priority'.length)];
    if (sub && v && typeof v === 'object' && !Array.isArray(v)) return v[sub];
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
    if (r) {
      out = { value: r.value, reason: r.reason, text: r.text };
      for (const w of r.when || []) {
        if (evalExpr(w.if)) {
          out = { value: w.value, reason: w.reason ?? r.reason, text: w.text ?? r.text };
          break;
        }
      }
    }
    if ((p.type === 'list' || p.type === 'matrix') && (isEmpty(out.value) || p.rowsFrom)) {
      const rows = prefillRows(q, p);
      if (rows.length) out = { ...out, value: rows };
    }
    recStack.delete(k);
    recCache.set(k, out);
    return out;
  }

  // ---------- list rows ----------
  function sourceRows(src: string): { key: string; label: string }[] {
    const r = parseRef(src, hasQ);
    const q = bank.questionById.get(r.qid);
    const p = findPart(q, r.part);
    if (!q || !p) return [];
    const v = partValue(q, p) ?? (p.type === 'list' ? listRowsRaw(q, p) : undefined);
    if (p.type === 'list') {
      const rows: any[] = Array.isArray(v) ? v : [];
      const col = labelColumn(p);
      return rows.map((row, i) => ({ key: String(row._k ?? row[col] ?? i + 1), label: String(row[col] ?? row._label ?? '') })).filter((x) => x.label);
    }
    const keys = keysOf(v);
    return keys
      .map((k) => p.options?.find((o) => o.key === k))
      .filter((o): o is Option => !!o && !o.dontKnow && !o.deferred)
      .map((o) => ({ key: o.key, label: o.other ? ws.answers[q.id]?.other?.[p.key] || o.label : o.label }));
  }

  function prefillRows(q: Question, p: Part): any[] {
    const defaults = p.recommended?.columnDefaults || {};
    if (p.rowsFrom && (!p.rowsFromCondition || evalExpr(p.rowsFromCondition))) {
      const src = sourceRows(p.rowsFrom);
      if (src.length) {
        const recRows: any[] = Array.isArray(p.recommended?.value) ? p.recommended!.value : [];
        const col = labelColumn(p);
        return src.map((s) => {
          const base = recRows.find((r) => r._k === s.key || r.key === s.key || r[col] === s.label) || {};
          return { ...defaults, ...stripMeta(base), [col]: s.label, _k: s.key, _label: s.label };
        });
      }
    }
    const rows = (p.rows || []).filter((r) => !r || typeof r !== 'object' || !('condition' in r) || evalExpr(r.condition));
    if (p.type === 'matrix') {
      return rows.map((r: any, i: number) => ({ _k: r.key ?? String(i + 1), _label: r.label, ...(r.recommended && typeof r.recommended === 'object' ? (r.recommended.value ?? r.recommended) : {}) }));
    }
    if (rows.length) {
      return rows.map((r: any, i: number) => ({ ...defaults, ...stripMeta(r), ...(r.recommended && typeof r.recommended === 'object' ? (r.recommended.value ?? r.recommended) : {}), _k: r.key ?? r._k ?? String(i + 1) }));
    }
    const rv = p.recommended?.value;
    return Array.isArray(rv) ? rv.map((r: any, i: number) => ({ ...defaults, ...r, _k: r._k ?? r.key ?? String(i + 1) })) : [];
  }

  function stripMeta(r: any) {
    const { condition, recommended, ...rest } = r || {};
    return rest;
  }

  function labelColumn(p: Part): string {
    const cols = p.columns || [];
    return (cols.find((c) => ['role', 'name', 'title', 'label', 'list', 'entity_name', 'branch'].includes(c.key)) || cols.find((c) => c.type === 'text') || cols[0])?.key || 'name';
  }

  function listRowsRaw(q: Question, p: Part): any[] {
    const stored = rawPart(q, p);
    if (Array.isArray(stored)) return stored;
    return prefillRows(q, p);
  }

  /** Rows to display/edit for a list/matrix part: stored rows merged with dynamic rowsFrom rows. */
  function listRows(q: Question, p: Part): any[] {
    const stored = rawPart(q, p);
    const pre = prefillRows(q, p);
    if (!Array.isArray(stored)) return pre;
    if (p.rowsFrom || p.type === 'matrix') {
      // keep one row per source row; keep stored values for matching keys
      const byKey = new Map(stored.map((r: any) => [r._k, r]));
      const out = pre.map((r) => ({ ...r, ...(byKey.get(r._k) || {}), _k: r._k, _label: r._label }));
      return out;
    }
    return stored;
  }

  // ---------- flags / modules ----------
  function flag(id: string): boolean {
    if (flagCache.has(id)) return flagCache.get(id)!;
    flagCache.set(id, false); // cycle guard
    const f = bank.flags.find((x) => x.id === id);
    const v = f ? evalExpr(f.expr) : false;
    flagCache.set(id, v);
    return v;
  }

  function module(unit: string): boolean {
    if (moduleCache.has(unit)) return moduleCache.get(unit)!;
    if (bank.deferredIds.has(unit)) return moduleCache.set(unit, false), false;
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
  function cmp(a: any, op: string, b: any): boolean {
    const x = typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)) ? Number(a) : a;
    switch (op) {
      case '>': return typeof x === 'number' && x > b;
      case '>=': return typeof x === 'number' && x >= b;
      case '<': return typeof x === 'number' && x < b;
      case '<=': return typeof x === 'number' && x <= b;
      case '==': case '=': return x == b;
      case '!=': return x != b;
      default: return false;
    }
  }

  function eqVal(v: any, k: any): boolean {
    if (v === undefined || v === null) return false;
    if (typeof k === 'boolean') return truthy(v) === k;
    if (k === 'yes' && v === true) return true;
    if (k === 'no' && v === false) return true;
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
        const r = parseRef(arg, hasQ);
        const q = bank.questionById.get(r.qid);
        if (!q || !vis.questions.has(q.id)) return false;
        if (!r.part) return answerHasContent(ws.answers[q.id]) || (!!opts.assumeUnanswered);
        return !isEmpty(value(r, local));
      }
      case 'visible': {
        if (bank.sectionById.has(arg) && !hasQ(arg)) return vis.sections.has(arg);
        const r = parseRef(arg, hasQ);
        if (!r.part) return vis.questions.has(r.qid);
        return vis.parts.has(`${r.qid}#${r.part}`);
      }
      case 'rowsAny': {
        const [ref, col, o, val] = arg;
        const r = parseRef(ref, hasQ);
        const rows = resolveRefValue({ ...r, sub: undefined, row: undefined }, local);
        if (!Array.isArray(rows)) return false;
        return rows.some((row) => {
          const cell = row?.[col];
          if (o === '!=' && (val === '' || val === null)) return !isEmpty(cell);
          if (o === '==' && (val === '' || val === null)) return isEmpty(cell);
          return Array.isArray(cell) ? cell.some((c) => cmp(c, o, val)) : cmp(cell, o, val);
        });
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
    flagCache = new Map();
    moduleCache = new Map();
    valueCache = new Map();
    recCache = new Map();
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
      if ((inSec && evalExpr(q.condition)) || forced.has(q.id)) {
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
  // final caches computed against final visibility
  flagCache = new Map();
  moduleCache = new Map();
  valueCache = new Map();
  recCache = new Map();

  const flags: Record<string, boolean> = {};
  for (const f of bank.flags) flags[f.id] = flag(f.id);
  const modules: Record<string, boolean> = {};
  for (const s of bank.sections) if (s.kind === 'unit' || moduleOption(s.id)) modules[s.id] = module(s.id);
  for (const d of bank.deferredIds) modules[d] = false;
  fired = bank.conflicts.filter((c) => evalExpr(c.condition));

  // ---------- automatic flags ----------
  const autoFlags: AutoFlag[] = [];
  const res = ws.autoFlagResolutions || {};
  const mk = (key: string, qid: string, text: string, kind: AutoFlag['kind'], conflictId?: string): AutoFlag => ({
    key, qid, text, kind, conflictId,
    status: res[key]?.status ?? 'open',
    resolution: res[key]?.resolution,
  });
  for (const c of fired) {
    if (c.action !== 'flag') continue;
    let qid = c.target ? parseRef(c.target, hasQ).qid : '';
    if (!qid) qid = firstRef(c.condition) || '';
    autoFlags.push(mk(`conflict:${c.id}`, qid, c.title ? `${c.id} — ${c.title}: ${c.text}` : `${c.id}: ${c.text}`, 'conflict', c.id));
  }
  const dkList: string[] | undefined = bank.meta.dontKnowFlagQuestions;
  const anyExplicit = bank.questions.some((q) => q.flagOnDontKnow !== undefined);
  for (const q of bank.questions) {
    if (!vis.questions.has(q.id)) continue;
    const sec = bank.sectionById.get(q.section);
    const eligible = q.flagOnDontKnow ?? (dkList ? dkList.includes(q.id) : !anyExplicit && ((sec?.kind === 'profile' && !q.detail && !/-099$/.test(q.id)) || ['TAX-001', 'TAX-002'].includes(q.id)));
    if (!eligible) continue;
    const p = q.parts[0];
    const a = ws.answers[q.id];
    const unanswered = !answerHasContent(a);
    if (partIsDontKnow(q, p) || (opts.assumeUnanswered && unanswered && q.parts.some((x) => x.options?.some((o) => o.dontKnow)))) {
      autoFlags.push(mk(`dk:${q.id}`, q.id, `«لا أعلم» في سؤال وصفي عن الكيان (${q.id}) — يُطبَّق الموصى به حتى الحسم (ق-ت9).`, 'dont_know'));
    }
  }

  const archived = Object.keys(ws.answers).filter((qid) => bank.questionById.has(qid) && !vis.questions.has(qid) && answerHasContent(ws.answers[qid]));

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
    return found;
  }

  const visibleOptions = (q: Question, p: Part) => (p.options || []).filter((o) => o.condition === undefined || o.condition === null || evalExpr(o.condition));

  function roleOptions(): string[] {
    const rq = bank.questionById.get(bank.rolesQid);
    const roles: string[] = [];
    if (rq && vis.questions.has(rq.id)) {
      const p = rq.parts.find((x) => x.type === 'list') || rq.parts[0];
      const rows = listRows(rq, p);
      const col = labelColumn(p);
      for (const r of rows) if (r && !isEmpty(r[col])) roles.push(String(r[col]));
    }
    const out = [...new Set(roles)];
    if (!flags[bank.multiUserFlag] && bank.flags.some((f) => f.id === bank.multiUserFlag)) out.unshift(bank.singleUserLabel);
    for (const d of bank.dynamicRecipients) if (!out.includes(d)) out.push(d);
    return out;
  }

  function branchOptions(): string[] {
    const bq = bank.questionById.get(bank.branchesQid);
    if (!bq || !vis.questions.has(bq.id)) return [];
    const p = bq.parts.find((x) => x.type === 'list') || bq.parts[0];
    const col = labelColumn(p);
    return listRows(bq, p).map((r) => String(r[col] ?? '')).filter(Boolean);
  }

  function unitPriority(unit: string): string | undefined {
    const opt = moduleOption(unit);
    if (!opt || !scopeQ || !scopePart) return undefined;
    const v = partValue(scopeQ, scopePart);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v[opt.key] || undefined;
    return undefined;
  }

  const d: Derived = {
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
    value: (r) => value(r),
    partValue,
    rec,
    evalExpr,
    isAnswered: (qid) => answerHasContent(ws.answers[qid]),
    isAssumed: (qid) => {
      const a = ws.answers[qid];
      return !a || a.source === 'assumption' || !!a.dontKnow || (bank.questionById.get(qid)?.parts.some((p) => partIsDontKnow(bank.questionById.get(qid)!, p)) ?? false);
    },
    visibleOptions,
    listRows,
    roleOptions,
    branchOptions,
    sectionVisible: (id) => vis.sections.has(id),
    unitPriority,
  };
  return d;
}
