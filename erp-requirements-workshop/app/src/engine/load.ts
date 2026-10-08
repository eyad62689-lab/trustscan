// Merge bank-data/*.json into one Bank, resolve *Label conditions, build indexes and a report.
import type { Bank, BankReport, Expr, Question, Section, Template, DeferredUnit, Part } from './types';
import { normalizeExport } from './export-spec';
import { walkBankExprs, eachNode } from './walk';
import { normAr } from './normalize';
import { parseRef } from './refs';

const LABEL_OPS: Record<string, string> = {
  eqLabel: 'eq',
  neLabel: 'ne',
  inLabel: 'in',
  hasLabel: 'has',
  hasAnyLabel: 'hasAny',
  hasAllLabel: 'hasAll',
};

export const DEFAULT_RECIPIENTS = ['مُنشئ المستند', 'المعتمِد المعني'];

function emptyReport(): BankReport {
  return { errors: [], warnings: [], textConditions: [], unresolvedLabels: [], files: [] };
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function findPart(q: Question | undefined, key?: string): Part | undefined {
  if (!q) return undefined;
  if (!key) return q.parts[0];
  return q.parts.find((p) => p.key === key);
}

function matchOption(part: Part | undefined, label: string): string | undefined {
  if (!part) return undefined;
  const opts = [...(part.options || []), ...(part.columns || []).flatMap((c) => c.options || [])];
  const n = normAr(label);
  const exact = opts.find((o) => normAr(o.label) === n);
  if (exact) return exact.key;
  const starts = opts.filter((o) => normAr(o.label).startsWith(n) || n.startsWith(normAr(o.label)));
  if (starts.length === 1) return starts[0].key;
  const inc = opts.filter((o) => normAr(o.label).includes(n));
  if (inc.length === 1) return inc[0].key;
  return undefined;
}

export function mergeBank(files: Record<string, unknown>): Bank {
  const report = emptyReport();
  const names = Object.keys(files).sort();
  report.files = names.map((n) => n.split('/').pop()!);
  const get = (base: string) => {
    const k = names.find((n) => n.split('/').pop() === base);
    return k ? clone(files[k] as any) : undefined;
  };
  const meta = get('meta.json') || {};
  const exportRaw = get('export.json');
  const deferredRaw = get('deferred.json');

  const sectionById = new Map<string, Section>();
  const addSection = (s: Section, from: string) => {
    if (!s || !s.id) return;
    const prev = sectionById.get(s.id);
    if (prev) {
      const merged = { ...prev, ...s, opening: { ...(prev.opening || {}), ...(s.opening || {}) } } as Section;
      if (prev.contains || s.contains) merged.contains = [...(prev.contains || []), ...(s.contains || [])];
      sectionById.set(s.id, merged);
    } else sectionById.set(s.id, { ...s });
  };
  for (const s of meta.sections || []) addSection(s, 'meta.json');

  const questions: Question[] = [];
  const questionById = new Map<string, Question>();
  const rules: any[] = [];
  const conflicts: any[] = [];
  const fileTemplates: Template[] = [];
  const ids = new Map<string, string>();
  const seen = (kind: string, id: string, file: string) => {
    const k = `${kind}:${id}`;
    if (ids.has(k)) report.errors.push({ kind: 'duplicate', where: file, detail: `${kind} ${id} also in ${ids.get(k)}` });
    else ids.set(k, file);
  };

  for (const name of names) {
    const base = name.split('/').pop()!;
    if (['meta.json', 'export.json', 'deferred.json'].includes(base)) continue;
    const f = clone(files[name] as any);
    if (!f || typeof f !== 'object') continue;
    for (const s of f.sections || []) addSection(s, base);
    for (const q of f.questions || []) {
      if (!q || !q.id) continue;
      seen('question', q.id, base);
      if (questionById.has(q.id)) continue;
      q.parts = Array.isArray(q.parts) && q.parts.length ? q.parts : [{ key: 'main', type: 'text' }];
      q.templates = [...(q.templates || []), ...(q.extraTemplates || [])];
      q.__file = base;
      questions.push(q);
      questionById.set(q.id, q);
      for (const t of q.templates) seen('template', t.id, base);
    }
    for (const t of f.extraTemplates || []) {
      seen('template', t.id, base);
      fileTemplates.push({ ...t, __unit: f.unit });
    }
    for (const r of f.rules || []) {
      seen('rule', r.id, base);
      rules.push(r);
    }
    for (const c of f.conflicts || []) {
      seen('conflict', c.id, base);
      conflicts.push(c);
    }
  }

  // file-level extra templates attached to a question
  for (const t of [...fileTemplates]) {
    const q = t.question ? questionById.get(t.question) : undefined;
    if (q) {
      q.templates!.push(t);
      fileTemplates.splice(fileTemplates.indexOf(t), 1);
    }
  }

  // sections: `contains` → alsoIn
  for (const s of sectionById.values()) {
    for (const c of s.contains || []) {
      const q = questionById.get(c.id);
      if (!q) {
        report.warnings.push({ kind: 'contains', where: `section ${s.id}`, detail: `question ${c.id} not loaded` });
        continue;
      }
      if (q.section !== s.id) q.alsoIn = [...new Set([...(q.alsoIn || []), s.id])];
    }
  }
  for (const q of questions) {
    if (!sectionById.has(q.section)) {
      report.warnings.push({ kind: 'section', where: q.id, detail: `section ${q.section} not defined; created` });
      sectionById.set(q.section, { id: q.section, title: q.section, order: 9999, condition: true, kind: 'unit' });
    }
  }
  const sections = [...sectionById.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const questionsBySection = new Map<string, Question[]>();
  for (const s of sections) questionsBySection.set(s.id, []);
  for (const q of questions) {
    for (const sid of [q.section, ...(q.alsoIn || [])]) {
      if (!questionsBySection.has(sid)) questionsBySection.set(sid, []);
      questionsBySection.get(sid)!.push(q);
    }
  }
  for (const list of questionsBySection.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

  // deferred units
  let deferred: DeferredUnit[] = [];
  if (deferredRaw) {
    const arr = Array.isArray(deferredRaw)
      ? deferredRaw
      : deferredRaw.units || deferredRaw.deferred || deferredRaw.modules || deferredRaw.sections || Object.values(deferredRaw).find((v) => Array.isArray(v)) || [];
    deferred = (arr as any[]).filter((d) => d && (d.id || d.code)).map((d) => ({ ...d, id: d.id || d.code, title: d.title || d.name || d.id }));
  }
  const deferredIds = new Set<string>([...deferred.map((d) => d.id), ...((meta.moduleRule?.deferredUnits as string[]) || [])]);

  const exportSpec = normalizeExport(exportRaw);
  for (const k of exportSpec.unknownKeys) report.warnings.push({ kind: 'export.json', where: 'export.json', detail: `unrecognised top-level key "${k}" (ignored)` });

  // scope question & priorities
  const scopeQid = meta.scopeQuestion || 'SCP-001';
  const scopePart = findPart(questionById.get(scopeQid));
  const priorities = scopePart?.priorities?.length
    ? scopePart.priorities
    : meta.priorities || [
        { key: 'must_day_one', label: 'ضروري من اليوم الأول' },
        { key: 'later_phase', label: 'مرحلة لاحقة' },
        { key: 'nice_to_have', label: 'مستحسن إن أمكن' },
      ];

  const bank: Bank = {
    version: String(meta.bankVersion ?? meta.version ?? '?'),
    date: meta.date,
    meta,
    flags: (meta.flags || []).map((f: any) => ({ ...f })),
    sections,
    sectionById: new Map(sections.map((s) => [s.id, s])),
    questions,
    questionById,
    questionsBySection,
    rules,
    conflicts,
    fileTemplates,
    deferred,
    deferredIds,
    exportSpec,
    report,
    scopeQid,
    rolesQid: meta.rolesQuestion || 'ROL-001',
    branchesQid: meta.branchesQuestion || 'GEN-003',
    dynamicRecipients: meta.dynamicRecipients || DEFAULT_RECIPIENTS,
    singleUserLabel: meta.singleUserLabel || 'المستخدم الوحيد',
    multiUserFlag: meta.multiUserFlag || 'F_MULTIUSER',
    priorities,
    defaultPriority: scopePart?.defaultPriority || meta.defaultPriority || priorities[0]?.key || 'must_day_one',
    reviewDate: meta.regulatoryReviewDate || meta.reviewDate,
  };

  // resolve *Label ops, collect text fallbacks
  const resolve = (e: Expr, where: string): Expr => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
    const keys = Object.keys(e);
    if (keys.length === 1) {
      const op = keys[0];
      const v = (e as any)[op];
      if (op === 'all' || op === 'any') return { [op]: (v as Expr[]).map((x) => resolve(x, where)) };
      if (op === 'not') return { not: resolve(v, where) };
      if (LABEL_OPS[op]) {
        const [rawRef, labels] = v as [string, string | string[]];
        const ref = parseRef(rawRef, (id) => questionById.has(id));
        const q = questionById.get(ref.qid);
        let part = findPart(q, ref.part);
        if (part && ref.sub && part.columns?.length) {
          const col = part.columns.find((c) => c.key === ref.sub);
          if (col) part = { key: col.key, type: col.type, options: col.options } as Part;
        }
        const list = Array.isArray(labels) ? labels : [labels];
        const keysOut = list.map((l) => matchOption(part, l));
        if (!q || keysOut.some((k) => !k)) {
          report.unresolvedLabels.push({ kind: op, where, detail: `${rawRef}: ${list.filter((_, i) => !keysOut[i]).join(' | ')}${q ? '' : ' (question not loaded)'}` });
          return { unresolved: e };
        }
        const base = LABEL_OPS[op];
        return { [base]: [rawRef, base === 'in' || base === 'hasAny' || base === 'hasAll' ? keysOut : keysOut[0]] };
      }
    }
    return e;
  };
  walkBankExprs(bank, (e, where, set) => {
    const r = resolve(e, where);
    if (r !== e) set(r);
    eachNode(r, (n) => {
      if (n && typeof n === 'object' && 'text' in n && Object.keys(n).length === 1) report.textConditions.push({ kind: 'text', where, detail: String(n.text) });
    });
  });

  // Deep: option/column label resolution inside recommended.when values is not needed.
  return bank;
}

/** Validate references inside expressions (used by validate-bank and dev report). */
export function checkExprRefs(bank: Bank) {
  const flags = new Set(bank.flags.map((f) => f.id));
  const units = new Set([...bank.sections.map((s) => s.id), ...bank.deferredIds]);
  const out: { where: string; detail: string; severity: 'error' | 'warning' }[] = [];
  const checkRef = (raw: string, where: string, keys?: string[]) => {
    const r = parseRef(raw, (id) => bank.questionById.has(id));
    const q = bank.questionById.get(r.qid);
    if (!q) {
      out.push({ where, detail: `unknown question ${r.qid}`, severity: 'warning' });
      return;
    }
    const p = findPart(q, r.part);
    if (!p) {
      out.push({ where, detail: `unknown part ${raw}`, severity: 'error' });
      return;
    }
    if (keys) {
      let opts = p.options || [];
      if (r.sub && p.columns?.length) opts = p.columns.find((c) => c.key === r.sub)?.options || opts;
      if (opts.length) for (const k of keys) if (!opts.some((o) => o.key === k)) out.push({ where, detail: `unknown option ${k} in ${raw}`, severity: 'error' });
    }
  };
  walkBankExprs(bank, (e, where) =>
    eachNode(e, (n) => {
      for (const [op, v] of Object.entries(n)) {
        if (op === 'flag' && !flags.has(v as string)) out.push({ where, detail: `unknown flag ${v}`, severity: 'error' });
        else if (op === 'module' && !units.has(v as string)) out.push({ where, detail: `unknown module ${v}`, severity: 'warning' });
        else if (op === 'eq' || op === 'ne' || op === 'has') checkRef((v as any[])[0], where, [String((v as any[])[1])]);
        else if (op === 'in' || op === 'hasAny' || op === 'hasAll') checkRef((v as any[])[0], where, ((v as any[])[1] as any[]).map(String));
        else if (op === 'num' || op === 'rowsAny') checkRef((v as any[])[0], where);
        else if (op === 'answered' || op === 'visible') checkRef(v as string, where);
        else if (!['all', 'any', 'not', 'text', 'unresolved'].includes(op)) out.push({ where, detail: `unknown operator ${op}`, severity: 'error' });
      }
    }),
  );
  return out;
}
