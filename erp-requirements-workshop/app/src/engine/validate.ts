// Bank validation used by scripts/validate-bank.mjs (and tests).
import { mergeBank, checkExprRefs, findPart } from './load';
import { parseTemplate, type SlotNode } from './slots';
import { parseRef } from './refs';
import type { Bank } from './types';

export interface Finding { severity: 'error' | 'warning' | 'info'; where: string; detail: string }
export interface ValidationResult { bank: Bank; findings: Finding[]; counts: Record<string, Record<string, number>>; unknownFields: Record<string, string[]> }

const KNOWN: Record<string, string[]> = {
  question: ['id', 'section', 'order', 'title', 'help', 'detail', 'condition', 'conditionText', 'regulatory', 'verify', 'impact', 'parts', 'templates', 'extraTemplates', 'workshopNote', 'alsoIn', 'reviewDate', 'flagOnDontKnow', 'chapter', 'answerTypeText', 'notes', 'note'],
  part: ['key', 'label', 'type', 'options', 'max', 'unit', 'min', 'maxValue', 'columns', 'rows', 'rowsFrom', 'rowsFromCondition', 'rowsFromColumn', 'rowsExclude', 'condition', 'conditionText', 'recommended', 'required', 'priorities', 'defaultPriority', 'deferredDefaultPriority', 'optionsFrom', 'fixedRows', 'rowsFixed', 'extraRows', 'rangeFrom', 'distribution', 'inputType', 'conditionLabel', 'level'],
  template: ['id', 'when', 'whenText', 'noRequirement', 'text', 'forEach', 'forEachRow', 'perRow', 'perItem', 'itemWhen', 'rowFilter', 'alternativeOf', 'family', 'sourceTemplate', 'expandedFrom', 'priority', 'priorityText', 'priorityIf', 'source', 'chapter', 'question', 'note', 'iter', 'freeText', 'priorityRule'],
  option: ['key', 'label', 'other', 'dontKnow', 'condition', 'conditionText', 'deferred', 'module', 'desc', 'hint', 'exclusive', 'recipient'],
  column: ['key', 'label', 'type', 'options', 'condition', 'unit', 'optionsFrom', 'rowsFrom', 'readOnly', 'multiple', 'default', 'min', 'help', 'note'],
  rule: ['id', 'scope', 'title', 'text', 'applies', 'appliesText', 'regulatory', 'verify'],
  conflict: ['id', 'scope', 'title', 'condition', 'conditionText', 'action', 'target', 'text', 'flagText'],
};

export function validateBank(files: Record<string, unknown>): ValidationResult {
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], where: string, detail: string) => findings.push({ severity, where, detail });
  const unknownFields: Record<string, Set<string>> = {};
  const note = (kind: string, obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) if (!KNOWN[kind].includes(k) && !k.startsWith('__')) (unknownFields[kind] ||= new Set()).add(k);
  };
  const counts: Record<string, Record<string, number>> = {};
  for (const [name, raw] of Object.entries(files)) {
    const f: any = raw;
    const c: Record<string, number> = { questions: 0, parts: 0, options: 0, templates: 0, rules: 0, conflicts: 0 };
    for (const q of f?.questions || []) {
      c.questions++;
      note('question', q);
      for (const p of q.parts || []) {
        c.parts++;
        note('part', p);
        const keys = new Set<string>();
        for (const o of p.options || []) {
          c.options++;
          note('option', o);
          if (!/^[a-z0-9_]+$/.test(String(o.key))) add('warning', `${q.id}#${p.key}`, `option key «${o.key}» is not snake_case`);
          if (keys.has(o.key)) add('error', `${q.id}#${p.key}`, `duplicate option key ${o.key}`);
          keys.add(o.key);
          if (o.key === 'other' && !o.other) add('warning', `${q.id}#${p.key}`, 'option "other" without other:true');
          if (o.key === 'dont_know' && !o.dontKnow) add('warning', `${q.id}#${p.key}`, 'option "dont_know" without dontKnow:true');
        }
        for (const col of p.columns || []) note('column', col);
      }
      for (const t of [...(q.templates || []), ...(q.extraTemplates || [])]) { c.templates++; note('template', t); }
    }
    for (const r of f?.rules || []) { c.rules++; note('rule', r); }
    for (const x of f?.conflicts || []) { c.conflicts++; note('conflict', x); }
    counts[name] = c;
    const text = JSON.stringify(raw);
    if (text.includes('〔مصدر')) add('error', name, 'provenance tag 〔مصدر …〕 left in text');
  }

  const bank = mergeBank(files);
  for (const e of bank.report.errors) add('error', e.where, e.detail);
  for (const w of bank.report.warnings) add('warning', w.where, w.detail);
  for (const u of bank.report.unresolvedLabels) {
    const qid = parseRef(u.detail.split(':')[0]).qid;
    const deferred = bank.deferredIds.has(qid.split('-')[0]);
    add(deferred ? 'info' : 'error', u.where, `unresolved ${u.kind}: ${u.detail}${deferred ? ' (deferred unit — evaluates false)' : ''}`);
  }
  for (const t of bank.report.textConditions) add('info', t.where, `{"text"} condition treated as true: ${t.detail}`);
  for (const r of checkExprRefs(bank)) add(r.severity, r.where, r.detail);

  // templates
  const hasQ = (id: string) => bank.questionById.has(id);
  const checkSlots = (where: string, text: string) => {
    const { nodes, errors } = parseTemplate(text);
    for (const e of errors) add('error', where, `slot syntax: ${e}`);
    const walk = (ns: SlotNode[]) => {
      for (const n of ns) {
        if (n.t === 'Q' || n.t === 'SW' || n.t === 'ITEMCELL') {
          const ref = n.t === 'Q' ? n.ref : n.ref;
          if (ref.startsWith('@item')) continue;
          const r = parseRef(ref, hasQ);
          const q = bank.questionById.get(r.qid);
          if (!q) { if (!bank.deferredIds.has(r.qid.split('-')[0])) add('error', where, `slot ref to unknown question ${ref}`); continue; }
          const p = findPart(q, r.part);
          if (!p) { add('error', where, `slot ref to unknown part ${ref}`); continue; }
          if (n.t === 'SW' && !r.sub) {
            const opts = new Set((p.options || []).map((o) => o.key));
            for (const b of n.branches) if (b.key !== '*' && opts.size && !p.optionsFrom && !opts.has(b.key) && !['yes', 'no'].includes(b.key)) add('warning', where, `SW branch «${b.key}» is not an option of ${ref}`);
          }
        }
        if (n.t === 'IF') { if (n.error) add('error', where, n.error); walk(n.body); }
        if (n.t === 'SW') for (const b of n.branches) walk(b.body);
        if (n.t === 'BAD') add('error', where, `bad slot ${n.raw}`);
        if (n.t === 'MISSING') add('info', where, `MISSING slot: ${n.desc}`);
      }
    };
    walk(nodes);
  };
  for (const q of bank.questions) for (const t of q.templates || []) checkSlots(`template ${t.id}`, t.text);
  for (const r of bank.rules) checkSlots(`rule ${r.id}`, r.text);

  const uf: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(unknownFields)) uf[k] = [...v].sort();
  for (const [k, v] of Object.entries(uf)) add('info', `${k} fields`, `fields not used by the app (ignored): ${v.join(', ')}`);
  return { bank, findings, counts, unknownFields: uf };
}
