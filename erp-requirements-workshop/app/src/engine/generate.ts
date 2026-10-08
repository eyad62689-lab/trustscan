// Requirements, standard rules, assumptions, verify items, setup tasks, out-of-scope, and the
// review gate. Everything is computed from a Derived with assumeUnanswered=true (export view).
import type { Bank, Question, Part, Template, Workshop, Option, Source, Rule } from './types';
import { derive, isEmpty, keysOf, answerHasContent, type Derived, type AutoFlag, type LocalCtx } from './compute';
import { renderTemplate, formatPartValue, type RenderIssue } from './slots';
import { parseRef } from './refs';
import { findPart } from './load';

export interface Requirement {
  id: string;
  text: string;
  priority: string; // priority key (or literal label from priorityText)
  priorityLabel: string;
  source: Source;
  question: string;
  section: string;
  chapter: string; // section id of the chapter it belongs to, or "summary" / "4.x"
  templateId: string;
  tag?: string;
}

export interface AppliedRule { id: string; title?: string; text: string; scope: string; chapter: string }
export interface Assumption { question: string; title: string; value: string; valueRaw: any; reason: string; reasonText: string }
export interface VerifyRow { item: string; ref: string; what: string }
export interface SetupTask { group: string; n: string; task: string; owner: string; ref: string; when: string }
export interface RegRowOut { item: string; ruling: string; phase: string; note: string; outOfScope: boolean }

export interface GenResult {
  d: Derived;
  requirements: Requirement[];
  noRequirement: { id: string; question: string; text: string }[];
  rules: AppliedRule[];
  assumptions: Assumption[];
  verify: VerifyRow[];
  setup: SetupTask[];
  regulatory: RegRowOut[];
  outOfScope: string[];
  deferredNeeds: { id: string; title: string; priority: string }[];
  slotFlags: AutoFlag[];
  allFlags: AutoFlag[];
  openFlags: number;
  unanswered: { section: string; qids: string[] }[];
  chapterSections: string[]; // unit / mini section ids with a chapter 3.x, in order
  sharedChapter: (sectionId: string) => string | undefined;
}

export const REASON_TEXT: Record<string, string> = {
  dont_know: 'لا أعلم',
  unanswered: 'لم يُجب',
  flag_recommended: 'قبول الموصى به بعد خلاف',
  bulk_section: 'قبول الموصى به لباقي القسم',
  prefilled_accepted: 'صفوف معبّأة قُبلت كما هي',
  role_mapping: 'مطابقة اسم دور متروك (STD-GEN-18)',
  rule: 'افتراض تحدده قاعدة',
};

export const SOURCE_LABEL: Record<string, string> = { answer: 'إجابة', assumption: 'افتراض', free_text: 'نص حر', standard: 'قياسي' };

const DEFAULT_SHARED_CHAPTERS: Record<string, string> = {
  ROLES: '4.1', ROL: '4.1', GEN: '4.2', DOC: '4.2', RPT: '4.3', ALR: '4.3', INT: '4.4', MIG: '4.5', ADM: '4.6', PRF: '4.2',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function questionSource(d: Derived, q: Question): { source: Source; reason?: string } {
  const a = d.ws.answers[q.id];
  if (/-099$/.test(q.id) && answerHasContent(a)) return { source: 'free_text' };
  if (!answerHasContent(a)) return { source: 'assumption', reason: 'unanswered' };
  if (a!.dontKnow) return { source: 'assumption', reason: 'dont_know' };
  for (const p of q.parts) {
    const dk = p.options?.find((o) => o.dontKnow)?.key;
    const v = a!.parts?.[p.key];
    if (dk && (v === dk || (Array.isArray(v) && v.includes(dk)))) return { source: 'assumption', reason: 'dont_know' };
  }
  if (a!.source === 'assumption') return { source: 'assumption', reason: a!.reason || 'unanswered' };
  return { source: 'answer' };
}

export function generate(bank: Bank, ws: Workshop): GenResult {
  const d = derive(bank, ws, { assumeUnanswered: true });
  const spec = bank.exportSpec;
  const unitsCh = (spec.raw?.chapters || []).find((c: any) => c.id === 'units') || {};
  const prfOrder: string[] = unitsCh.prf003bChapterOrder || ['SAL', 'POS'];
  const taxSoon = unitsCh.taxSoonHeading;
  const taxSoonOn = taxSoon && d.evalExpr(taxSoon.condition);
  const res = ws.autoFlagResolutions || {};
  const prLabel = (k: string) => bank.priorities.find((p) => p.key === k)?.label ?? k;

  const sharedChapter = (sid: string) => spec.sectionChapters[sid] ?? DEFAULT_SHARED_CHAPTERS[sid];

  // chapter sections (3.x): visible unit + mini sections
  const chapterSections = bank.sections.filter((s) => (s.kind === 'unit' || s.kind === 'mini') && d.visibleSections.has(s.id)).map((s) => s.id);

  const homeSection = (q: Question): string => {
    for (const sid of [q.section, ...(q.alsoIn || [])]) if (d.visibleSections.has(sid)) return sid;
    return q.section;
  };
  const chapterOf = (q: Question, home: string): string => {
    const s = bank.sectionById.get(home);
    if (s && (s.kind === 'unit' || s.kind === 'mini')) return home;
    if (s?.kind === 'scope') return 'summary';
    if (s?.kind === 'profile') {
      for (const u of prfOrder) if (chapterSections.includes(u)) return u;
      return sharedChapter(home) || '4.2';
    }
    return sharedChapter(home) || home;
  };

  const requirements: Requirement[] = [];
  const noRequirement: GenResult['noRequirement'] = [];
  const slotFlags: AutoFlag[] = [];
  const counters = new Map<string, number>();
  const freeCounters = new Map<string, number>();

  const resolvedFor = (key: string) => (desc: string) => {
    const r = res[`slot:${key}:${desc}`];
    return r && r.status !== 'open' && r.value ? r.value : undefined;
  };
  const addIssues = (issues: RenderIssue[], key: string, qid: string) => {
    for (const is of issues) {
      if (is.kind === 'dropped') continue;
      const fk = `slot:${key}:${is.desc}`;
      if (slotFlags.some((f) => f.key === fk)) continue;
      const tmpl = spec.texts.missingSlotFlag || 'خانة بلا مصدر في قالب <معرّف السؤال>: <اسم الخانة>';
      slotFlags.push({
        key: fk, qid, kind: 'missing_slot',
        text: tmpl.replace('<معرّف السؤال>', `${key} (${qid})`).replace('<اسم الخانة>', is.desc),
        status: res[fk]?.status ?? 'open',
        resolution: res[fk]?.resolution,
      });
    }
  };

  const unitPriority = (q: Question, home: string): string => {
    const s = bank.sectionById.get(home);
    if (s && (s.kind === 'unit' || s.kind === 'mini')) {
      const u = d.unitPriority(home) || d.unitPriority(q.section);
      if (u) return u;
    }
    return bank.defaultPriority;
  };

  for (const s of bank.sections) {
    if (!d.visibleSections.has(s.id)) continue;
    for (const q of bank.questionsBySection.get(s.id) || []) {
      if (!d.visibleQuestions.has(q.id)) continue;
      const home = homeSection(q);
      if (home !== s.id) continue; // generate once, in its home section
      const chapter = chapterOf(q, home);
      const { source } = questionSource(d, q);
      for (const t of q.templates || []) {
        if (!d.evalExpr(t.when)) continue;
        if (t.noRequirement) {
          noRequirement.push({ id: t.id, question: q.id, text: t.text });
          continue;
        }
        const isFree = /R9nn/i.test(t.id);
        const instances = expandInstances(d, q, t);
        instances.forEach((local, idx) => {
          let id = t.id;
          if (isFree) {
            const unit = t.id.split('-R')[0];
            const n = (freeCounters.get(unit) || 0) + 1;
            freeCounters.set(unit, n);
            id = `${unit}-R9${pad2(n)}`;
          } else if (t.sourceTemplate) {
            const n = (counters.get(t.sourceTemplate) || 0) + 1;
            counters.set(t.sourceTemplate, n);
            id = `${t.sourceTemplate}-${pad2(n)}`;
          } else if (t.forEachRow || t.perItem || instances.length > 1) id = `${t.id}-${pad2(idx + 1)}`;
          const rr = renderTemplate(d, t.text, { local, resolved: resolvedFor(id) });
          addIssues(rr.issues, id, q.id);
          if (!rr.text) return;
          let priority = unitPriority(q, home);
          let priorityLabel = prLabel(priority);
          if (local?.item?.priority) { priority = local.item.priority; priorityLabel = prLabel(priority); }
          if (t.priorityIf) {
            priorityLabel = d.evalExpr(t.priorityIf.if) ? t.priorityIf.value : t.priorityIf.else ?? priorityLabel;
            priority = bank.priorities.find((p) => p.label === priorityLabel)?.key ?? priorityLabel;
          } else if (t.priorityText) {
            priorityLabel = t.priorityText;
            priority = bank.priorities.find((p) => p.label === t.priorityText)?.key ?? t.priorityText;
          }
          let tag: string | undefined;
          if (taxSoonOn && home === (taxSoon.unit || 'TAX')) {
            tag = taxSoon.tag;
            priority = 'later_phase';
            priorityLabel = prLabel('later_phase');
          }
          if (!bank.priorities.some((p) => p.key === priority) && !priorityLabel) { priority = bank.defaultPriority; priorityLabel = prLabel(priority); }
          requirements.push({
            id, text: rr.text, priority, priorityLabel,
            source: isFree ? 'free_text' : source,
            question: q.id, section: home, chapter, templateId: t.id, tag,
          });
        });
      }
    }
  }

  // file-level templates not tied to a question
  for (const t of bank.fileTemplates) {
    const unit = (t as any).__unit as string | undefined;
    if (unit && !d.visibleSections.has(unit)) continue;
    if (!d.evalExpr(t.when)) continue;
    if (t.noRequirement) { noRequirement.push({ id: t.id, question: '', text: t.text }); continue; }
    const rr = renderTemplate(d, t.text, { resolved: resolvedFor(t.id) });
    addIssues(rr.issues, t.id, '');
    if (rr.text) requirements.push({ id: t.id, text: rr.text, priority: bank.defaultPriority, priorityLabel: prLabel(bank.defaultPriority), source: 'standard', question: '', section: unit || '', chapter: unit && chapterSections.includes(unit) ? unit : sharedChapter(unit || '') || '4.0', templateId: t.id });
  }

  // standard rules
  const rules: AppliedRule[] = [];
  for (const r of bank.rules) {
    if (!ruleApplies(d, bank, r)) continue;
    const rr = renderTemplate(d, r.text, { resolved: resolvedFor(r.id) });
    addIssues(rr.issues.filter((i) => i.kind !== 'empty'), r.id, r.id);
    const scope = r.scope || 'GEN';
    const chapter = scope === 'GEN' || !chapterSections.includes(scope) ? '4.0' : scope;
    rules.push({ id: r.id, title: r.title, text: rr.text, scope, chapter });
  }

  // assumptions
  const assumptions: Assumption[] = [];
  for (const q of bank.questions) {
    if (!d.visibleQuestions.has(q.id)) continue;
    const { source, reason } = questionSource(d, q);
    if (source !== 'assumption') continue;
    // free-text and pure optional questions left empty are not assumptions
    if (/-099$/.test(q.id) && reason === 'unanswered') continue;
    const vals = q.parts.filter((p) => d.visibleParts.has(`${q.id}#${p.key}`)).map((p) => formatPartValue(d, q, p, d.partValue(q, p))).filter(Boolean);
    if (!vals.length && reason === 'unanswered') continue;
    assumptions.push({
      question: q.id, title: shortTitle(q.title), value: vals.join('؛ ') || '—',
      valueRaw: Object.fromEntries(q.parts.map((p) => [p.key, d.partValue(q, p)])),
      reason: reason || 'unanswered', reasonText: reasonLabel(bank, reason || 'unanswered'),
    });
  }
  // SCP-001 units selected without priority → day one (ع-01)
  const scopeQ = bank.questionById.get(bank.scopeQid);
  const scopeP = findPart(scopeQ);
  if (scopeQ && scopeP && d.visibleQuestions.has(scopeQ.id)) {
    const v = d.partValue(scopeQ, scopeP);
    if (Array.isArray(v)) for (const k of v) {
      const o = scopeP.options?.find((x) => x.key === k);
      if (o && !o.dontKnow && !o.other) assumptions.push({ question: scopeQ.id, title: shortTitle(scopeQ.title), value: `${prLabel(bank.defaultPriority)} — ${o.module || o.key.toUpperCase()}`, valueRaw: { [k]: bank.defaultPriority }, reason: 'rule', reasonText: 'ع-01' });
    } else if (v && typeof v === 'object') for (const [k, pr] of Object.entries(v)) {
      if (!pr) {
        const o = scopeP.options?.find((x) => x.key === k);
        assumptions.push({ question: scopeQ.id, title: shortTitle(scopeQ.title), value: `${prLabel(bank.defaultPriority)} — ${o?.module || k.toUpperCase()}`, valueRaw: { [k]: bank.defaultPriority }, reason: 'rule', reasonText: 'ع-01' });
      }
    }
  }
  // flags resolved by accepting the recommended value / slot values settled in review
  for (const [k, r] of Object.entries(res)) {
    if (r.status === 'assumed' && k.startsWith('slot:') && r.value && slotFlags.some((f) => f.key === k)) {
      const [, tid, ...desc] = k.split(':');
      assumptions.push({ question: tid, title: desc.join(':'), value: r.value, valueRaw: r.value, reason: 'flag_recommended', reasonText: reasonLabel(bank, 'flag_recommended') });
    }
  }
  for (const rm of ws.importReport?.roleMappings || []) assumptions.push({ question: bank.rolesQid, title: 'مطابقة أسماء الأدوار', value: `${rm.from} ← ${rm.to}`, valueRaw: rm, reason: 'role_mapping', reasonText: REASON_TEXT.role_mapping });
  for (const n of d.notes) if (/افتراض/.test(n.text) && n.scope) { /* conflict notes are written in 3.x.4 / 4.0 */ }

  // 4.7
  const regulatory: RegRowOut[] = spec.regulatoryRows.map((r) => {
    const v = r.variants.find((x) => d.evalExpr(x.when === undefined ? true : x.when));
    if (v) return { item: r.item, ruling: v.ruling || '', phase: v.phase ?? '—', note: v.note ?? '—', outOfScope: !!v.outOfScope };
    const applies = r.when === undefined ? true : d.evalExpr(r.when);
    return applies
      ? { item: r.item, ruling: r.ruling && !r.ruling.includes('/') ? r.ruling : 'ينطبق', phase: r.phase && !r.phase.includes('/') ? r.phase : '—', note: r.note ?? '—', outOfScope: false }
      : { item: r.item, ruling: 'لا ينطبق', phase: '—', note: '—', outOfScope: true };
  });

  // 4.8
  const verify: VerifyRow[] = [];
  const vSeen = new Set<string>();
  const addV = (item: string, ref: string, what: string) => {
    const k = `${item}|${ref}`;
    if (vSeen.has(k)) return;
    vSeen.add(k);
    verify.push({ item, ref, what });
  };
  for (const v of spec.verifyItems) if (v.when === undefined || d.evalExpr(v.when)) addV(v.item, v.ref || '—', v.what || '—');
  for (const q of bank.questions) {
    if (!d.visibleQuestions.has(q.id)) continue;
    for (const v of q.verify || []) {
      const what = v.replace(/^\[?يحتاج تحقق( من)?\s*/, '').replace(/\]$/, '').trim() || 'الاشتراطات';
      addV(shortTitle(q.title), q.id, what);
    }
  }
  for (const r of rules) {
    const src = bank.rules.find((x) => x.id === r.id);
    for (const v of src?.verify || []) addV(src?.title || r.id, r.id, v.replace(/^\[?يحتاج تحقق( من)?\s*/, '').replace(/\]$/, '').trim() || 'الاشتراطات');
  }

  // 4.9
  const setup: SetupTask[] = [];
  for (const r of spec.setupRows) {
    if (r.when !== undefined && !d.evalExpr(r.when)) continue;
    const rr = renderTemplate(d, r.task, {});
    setup.push({ group: r.group || '', n: String(r.n ?? ''), task: rr.text, owner: r.owner || '', ref: r.ref || '', when: (r.whenText || '').replace(/`/g, '') });
  }

  // deferred needs + out of scope
  const deferredNeeds: GenResult['deferredNeeds'] = [];
  const outOfScope: string[] = [];
  if (scopeQ && scopeP && d.visibleQuestions.has(scopeQ.id)) {
    const v = d.partValue(scopeQ, scopeP);
    const sel = keysOf(v);
    for (const o of d.visibleOptions(scopeQ, scopeP)) {
      if (o.dontKnow || o.other) continue;
      if (sel.includes(o.key)) {
        if (o.deferred) {
          const pr = v && typeof v === 'object' && !Array.isArray(v) ? v[o.key] : undefined;
          deferredNeeds.push({ id: o.module || o.key.toUpperCase(), title: o.label, priority: prLabel(pr || scopeP.deferredDefaultPriority || 'later_phase') });
        }
      } else outOfScope.push(`${o.label} (${o.module || o.key.toUpperCase()}): لم تُختر.`);
    }
  }
  for (const r of regulatory) if (r.outOfScope) outOfScope.push(`${r.item}: ${r.ruling}`);
  for (const l of spec.outOfScopeLines) if (l.when === undefined || d.evalExpr(l.when)) outOfScope.push(l.text.replace(/`/g, ''));
  for (const n of noRequirement) if (/خارج النطاق/.test(n.text)) {
    const q = bank.questionById.get(n.question);
    if (q) {
      const val = q.parts.map((p) => formatPartValue(d, q, p, d.partValue(q, p))).filter(Boolean).join('؛ ');
      if (val) outOfScope.push(`${shortTitle(q.title)} (${q.id}): ${val}`);
    }
  }

  // unanswered by section (review)
  const unanswered: GenResult['unanswered'] = [];
  const live = derive(bank, ws);
  for (const s of bank.sections) {
    if (!live.visibleSections.has(s.id)) continue;
    const qids = (bank.questionsBySection.get(s.id) || []).filter((q) => q.section === s.id || !live.visibleSections.has(q.section)).filter((q) => live.visibleQuestions.has(q.id) && !live.isAnswered(q.id) && !/-099$/.test(q.id)).map((q) => q.id);
    if (qids.length) unanswered.push({ section: s.id, qids });
  }

  const allFlags = [...d.autoFlags, ...slotFlags];
  const openFlags = allFlags.filter((f) => f.status === 'open').length + ws.flags.filter((f) => f.status === 'open').length;

  return { d, requirements, noRequirement, rules, assumptions, verify, setup, regulatory, outOfScope, deferredNeeds, slotFlags, allFlags, openFlags, unanswered, chapterSections, sharedChapter };
}

export function ruleApplies(d: Derived, bank: Bank, r: Rule): boolean {
  const scope = r.scope || 'GEN';
  if (scope !== 'GEN' && bank.sectionById.has(scope) && !d.visibleSections.has(scope)) return false;
  if (bank.deferredIds.has(scope)) return false;
  return d.evalExpr(r.applies === undefined ? true : r.applies);
}

function expandInstances(d: Derived, q: Question, t: Template): (LocalCtx | undefined)[] {
  const hasQ = (id: string) => d.bank.questionById.has(id);
  if (t.forEachRow) {
    const r = parseRef(t.forEachRow, hasQ);
    const rq = d.bank.questionById.get(r.qid);
    const p = findPart(rq, r.part);
    if (!rq || !p) return [];
    const rows = d.partValue(rq, p);
    const pk = `${rq.id}#${p.key}`;
    return (Array.isArray(rows) ? rows : []).filter((x) => x && typeof x === 'object').map((row) => ({ row, rowPart: pk }));
  }
  if (t.perItem) {
    const r = parseRef(t.perItem, hasQ);
    const rq = d.bank.questionById.get(r.qid);
    const p = findPart(rq, r.part);
    if (!rq || !p) return [];
    const v = d.partValue(rq, p);
    const pk = `${rq.id}#${p.key}`;
    return keysOf(v)
      .map((k) => p.options?.find((o) => o.key === k))
      .filter((o): o is Option => !!o && !o.dontKnow)
      .map((o) => ({ item: { ...o, priority: v && typeof v === 'object' && !Array.isArray(v) ? v[o.key] : undefined }, itemPart: pk }));
  }
  // free text on a long text: one requirement per non-empty paragraph
  if (/R9nn/i.test(t.id)) {
    const p = q.parts[0];
    const v = d.partValue(q, p);
    if (p.type === 'list' && Array.isArray(v) && v.length > 1) return v.map((row) => ({ row, rowPart: `${q.id}#${p.key}` }));
  }
  return [undefined];
}

export function shortTitle(t: string, n = 90): string {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function reasonLabel(bank: Bank, reason: string): string {
  const map: Record<string, string> = { flag_recommended: 'accepted_after_dispute', bulk_section: 'accepted_rest_of_section', prefilled_accepted: 'prefilled_rows' };
  const ch = (bank.exportSpec.raw?.chapters || []).find((c: any) => c.id === 'assumptions');
  const k = map[reason] || reason;
  return ch?.reasons?.find((r: any) => r.key === k)?.label || REASON_TEXT[reason] || reason;
}

/** Review gate (FR-15): export allowed only with no open flag and no slot without source. */
export function exportBlockers(g: GenResult): { flags: number } {
  return { flags: g.openFlags };
}
