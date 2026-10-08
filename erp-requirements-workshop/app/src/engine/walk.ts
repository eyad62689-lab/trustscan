// Visit every Expr position in the bank. `set` replaces the expression in place.
import type { Bank, Expr } from './types';

export type ExprVisitor = (e: Expr, where: string, set: (n: Expr) => void) => void;

function at(obj: any, key: string, where: string, fn: ExprVisitor) {
  if (obj && key in obj && obj[key] !== undefined) fn(obj[key], where, (n) => (obj[key] = n));
}

export function walkBankExprs(b: Pick<Bank, 'flags' | 'sections' | 'questions' | 'rules' | 'conflicts' | 'fileTemplates' | 'exportSpec'>, fn: ExprVisitor) {
  for (const f of b.flags) at(f, 'expr', `flag ${f.id}`, fn);
  for (const s of b.sections) at(s, 'condition', `section ${s.id}`, fn);
  for (const q of b.questions) {
    at(q, 'condition', `${q.id}`, fn);
    for (const p of q.parts || []) {
      const w = `${q.id}#${p.key}`;
      at(p, 'condition', w, fn);
      at(p, 'rowsFromCondition', `${w} rowsFrom`, fn);
      for (const o of p.options || []) at(o, 'condition', `${w} option ${o.key}`, fn);
      for (const c of p.columns || []) {
        at(c, 'condition', `${w} column ${c.key}`, fn);
        for (const o of c.options || []) at(o, 'condition', `${w}.${c.key} option ${o.key}`, fn);
      }
      for (const [i, r] of (p.rows || []).entries()) if (r && typeof r === 'object') at(r, 'condition', `${w} row ${r.key ?? i + 1}`, fn);
      for (const [i, wr] of (p.recommended?.when || []).entries()) at(wr, 'if', `${w} recommended.when[${i}]`, fn);
    }
    for (const t of q.templates || []) {
      at(t, 'when', `template ${t.id}`, fn);
      if (t.priorityIf) at(t.priorityIf, 'if', `template ${t.id} priorityIf`, fn);
    }
  }
  for (const t of b.fileTemplates) at(t, 'when', `template ${t.id}`, fn);
  for (const r of b.rules) at(r, 'applies', `rule ${r.id}`, fn);
  for (const c of b.conflicts) at(c, 'condition', `conflict ${c.id}`, fn);
  const x = b.exportSpec;
  if (x) {
    for (const r of x.regulatoryRows) {
      at(r, 'when', `4.7 ${r.id}`, fn);
      for (const [i, v] of r.variants.entries()) at(v, 'when', `4.7 ${r.id} variant ${i + 1}`, fn);
    }
    for (const [i, v] of x.verifyItems.entries()) at(v, 'when', `4.8 #${i + 1}`, fn);
    for (const [i, v] of x.setupRows.entries()) at(v, 'when', `4.9 ${v.group ?? ''}${v.n ?? i + 1}`, fn);
    for (const [i, v] of x.outOfScopeLines.entries()) at(v, 'when', `out-of-scope #${i + 1}`, fn);
  }
}

/** Calls cb for every sub-expression (pre-order). */
export function eachNode(e: Expr, cb: (node: any) => void) {
  if (!e || typeof e !== 'object') return;
  cb(e);
  for (const [k, v] of Object.entries(e)) {
    if (k === 'all' || k === 'any') for (const s of v as any[]) eachNode(s, cb);
    else if (k === 'not') eachNode(v, cb);
  }
}
