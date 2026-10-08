// Build the requirements document (DocModel) from a generation result.
import type { Block, DocModel } from './docmodel';
import type { GenResult, Requirement } from './generate';
import { SOURCE_LABEL, shortTitle } from './generate';
import { formatPartValue, formatCell } from './slots';
import { buildAppendix, toYaml } from './appendix';
import { isoDate, displayDateTime, minutesBetween, formatMinutes, safeName } from './format';
import { keysOf } from './compute';

/** Remove markdown emphasis / code ticks from bank text so MD and DOCX show the same text. */
export function plain(s: string | undefined): string {
  return String(s ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/〔مصدر[^〕]*〕/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const DEFAULT_TITLES: Record<string, string> = {
  '1': 'الغلاف', '2': 'الملخص التنفيذي', '3': 'المتطلبات حسب الوحدة', '4': 'الجوانب المشتركة', '5': 'سجل الافتراضات', '6': 'سجل الورشة', '7': 'خارج النطاق', '8': 'الملحق المهيكل (YAML)',
  '3.x.1': 'المتطلبات', '3.x.2': 'سير العمل', '3.x.3': 'حقول البيانات', '3.x.4': 'قواعد العمل', '3.x.5': 'الاعتمادات', '3.x.6': 'التقارير', '3.x.7': 'التنبيهات', '3.x.8': 'إضافات حرة',
  '4.0': 'القواعد القياسية العامة', '4.1': 'الأدوار ومصفوفة الصلاحيات', '4.2': 'الإعدادات العامة', '4.3': 'لوحة المتابعة والتقارير العامة والتنبيهات العامة', '4.4': 'الربط مع الجهات', '4.5': 'نقل البيانات', '4.6': 'الضبط الإداري', '4.7': 'البنود النظامية المنطبقة', '4.8': 'قائمة التحقق للمنفّذ', '4.9': 'مهام الإعداد',
  'deferred-needs': 'احتياجات مسجلة لم تُجمع متطلباتها', 'free-text-needs': 'احتياجات مالية أو إدارية خارج الفهرس',
};

const REQ_HEAD = ['المعرّف', 'النص', 'الأولوية', 'المصدر', 'السؤال'];
const NONE = 'لا بنود.';

export function buildDocument(g: GenResult, now = new Date()): DocModel {
  const { d } = g;
  const { bank, ws } = d;
  const spec = bank.exportSpec;
  const T = (k: string) => plain(spec.chapterTitles[k] || DEFAULT_TITLES[k] || k);
  const X = (k: string, fallback: string) => plain(spec.texts[k] || fallback);
  const blocks: Block[] = [];
  const H = (level: 1 | 2 | 3 | 4, text: string) => blocks.push({ t: 'h', level, text });
  const P = (text: string) => { const t = plain(text); if (t) blocks.push({ t: 'p', text: t }); };
  const UL = (items: string[]) => { const it = items.map(plain).filter(Boolean); if (it.length) blocks.push({ t: 'ul', items: it }); else P(NONE); };
  const TABLE = (head: string[], rows: string[][]) => { if (rows.length) blocks.push({ t: 'table', head, rows: rows.map((r) => r.map((c) => plain(c) || '—')) }); else P(NONE); };
  const reqRow = (r: Requirement) => [r.id, r.tag ? `${r.text} (${r.tag})` : r.text, r.priorityLabel, SOURCE_LABEL[r.source] || r.source, r.question || '—'];
  const today = isoDate(now);
  const entity = ws.entityName || 'بدون اسم';

  // ---------- 1. cover ----------
  blocks.push({ t: 'title', text: `وثيقة المتطلبات — ${entity}` });
  H(1, `1. ${T('1')}`);
  TABLE(['البند', 'القيمة'], [
    ['اسم الكيان', entity],
    ['تاريخ التصدير', today],
    ['إصدار بنك الأسئلة', bank.version],
  ]);
  TABLE(['التاريخ', 'المدة', 'الميسّر', 'الحضور'], ws.sessions.map((s) => [
    displayDateTime(s.start),
    s.end ? formatMinutes(minutesBetween(s.start, s.end)) : 'لم تُنهَ',
    s.facilitator || '—',
    s.attendees.map((a) => (a.name ? `${a.name} (${a.role})` : a.role)).join('، ') || '—',
  ]));
  const tocIndex = blocks.length;

  // ---------- 2. executive summary ----------
  H(1, `2. ${T('2')}`);
  const prfSection = bank.sections.find((s) => s.kind === 'profile');
  H(2, 'ملف الكيان');
  const prfRows: string[][] = [];
  for (const q of bank.questionsBySection.get(prfSection?.id || 'PRF') || []) {
    if (!d.visibleQuestions.has(q.id)) continue;
    for (const p of q.parts) {
      if (!d.visibleParts.has(`${q.id}#${p.key}`)) continue;
      const v = formatPartValue(d, q, p, d.partValue(q, p));
      if (!v && /-099$/.test(q.id)) continue;
      prfRows.push([q.id + (q.parts.length > 1 ? ` (${p.label || p.key})` : ''), shortTitle(q.title, 120), v || '—']);
    }
  }
  TABLE(['السؤال', 'النص', 'الإجابة'], prfRows);

  const goalsQ = bank.questionById.get('PRF-011');
  if (goalsQ && d.visibleQuestions.has(goalsQ.id)) {
    H(2, 'الأهداف');
    const v = d.partValue(goalsQ, goalsQ.parts[0]);
    UL(keysOf(v).map((k) => formatPartValue(d, goalsQ, goalsQ.parts[0], [k])));
  }

  H(2, 'الوحدات المختارة وأولوياتها');
  const unitRows: string[][] = [];
  for (const sid of g.chapterSections) {
    const s = bank.sectionById.get(sid)!;
    const pr = d.unitPriority(sid);
    unitRows.push([s.title, sid, bank.priorities.find((p) => p.key === (pr || bank.defaultPriority))?.label || '—', s.autoAdded ? 'أُضيف تلقائياً' : s.kind === 'mini' ? 'قسم مصغّر' : 'مختارة']);
  }
  TABLE(['الوحدة', 'الرمز', 'الأولوية', 'ملاحظة'], unitRows);
  const phaseQ = bank.questionById.get('SCP-002');
  if (phaseQ && d.visibleQuestions.has(phaseQ.id)) P(`خطة المراحل (SCP-002): ${formatPartValue(d, phaseQ, phaseQ.parts[0], d.partValue(phaseQ, phaseQ.parts[0])) || '—'}`);

  H(2, T('deferred-needs'));
  const line = X('deferredNeedLine', '<الوحدة>: حاجة مسجلة؛ تُجمع متطلباتها في إصدار لاحق بعد إغلاقها');
  UL(g.deferredNeeds.map((n) => `${line.replace('<الوحدة>', `${n.title} (${n.id})`)} — الأولوية: ${n.priority}`));

  H(2, T('free-text-needs'));
  TABLE(REQ_HEAD, g.requirements.filter((r) => r.chapter === 'summary').map(reqRow));

  H(2, 'وصف النطاق');
  P(scopeParagraph(g));

  H(2, 'أرقام إجمالية');
  const byPr = new Map<string, number>();
  for (const r of g.requirements) byPr.set(r.priorityLabel, (byPr.get(r.priorityLabel) || 0) + 1);
  const bySrc = new Map<string, number>();
  for (const r of g.requirements) bySrc.set(r.source, (bySrc.get(r.source) || 0) + 1);
  bySrc.set('standard', (bySrc.get('standard') || 0) + g.rules.length);
  TABLE(['البند', 'العدد'], [
    ['المتطلبات (بمعرّف XXX-R)', String(g.requirements.length)],
    ...[...byPr.entries()].map(([k, n]) => [`الأولوية: ${k}`, String(n)]),
    ...['answer', 'assumption', 'free_text', 'standard'].map((k) => [`المصدر: ${SOURCE_LABEL[k]}`, String(bySrc.get(k) || 0)]),
    ['القواعد القياسية المطبّقة', String(g.rules.length)],
    ['الافتراضات المُعلنة', String(g.assumptions.length)],
  ]);
  const stdLine = X('standardRulesLine', 'طُبّقت القواعد القياسية لـ<الوحدة> ما لم تخالفها إجابة');
  const unitsWithRules = [...new Set(g.rules.map((r) => r.scope))].filter((s) => s !== 'GEN');
  UL(unitsWithRules.map((u) => stdLine.replace('<الوحدة>', bank.sectionById.get(u)?.title || u)));

  // ---------- 3. units ----------
  H(1, `3. ${T('3')}`);
  if (!g.chapterSections.length) P(NONE);
  g.chapterSections.forEach((sid, i) => {
    const s = bank.sectionById.get(sid)!;
    const n = `3.${i + 1}`;
    const sub = (k: number) => `${n}.${k} ${T(`3.x.${k}`)}`;
    H(2, `${n} ${s.title} (${sid})`);
    const reqs = g.requirements.filter((r) => r.chapter === sid);
    const fixed = reqs.filter((r) => r.source !== 'free_text');
    const free = reqs.filter((r) => r.source === 'free_text');
    H(3, sub(1));
    const tagged = fixed.filter((r) => r.tag);
    TABLE(REQ_HEAD, fixed.filter((r) => !r.tag).map(reqRow));
    if (tagged.length) {
      H(4, (bank.exportSpec.raw?.chapters || []).find((c: any) => c.id === 'units')?.taxSoonHeading?.title || 'خصائص تُبنى معطّلة وتُفعَّل عند التسجيل');
      TABLE(REQ_HEAD, tagged.map(reqRow));
    }
    const refList = (re: RegExp) => fixed.filter((r) => re.test(r.text)).map((r) => r.id);
    const refsPara = (ids: string[]) => P(ids.length ? `مدرجة في ${n}.1 بمعرّفاتها: ${ids.join('، ')}.` : NONE);
    H(3, sub(2));
    refsPara(refList(/تسلسل|خطوات|حالة|حالات|يُرحَّل|يُنشئ/));
    H(3, sub(3));
    refsPara(fixed.filter((r) => /حقل|حقول/.test(r.text) || /حقول/.test(bank.questionById.get(r.question)?.title || '')).map((r) => r.id));
    H(3, sub(4));
    const unitRules = g.rules.filter((r) => r.chapter === sid);
    const notes = d.notes.filter((c) => (c.scope || '') === sid);
    if (!unitRules.length && !notes.length) P(NONE);
    for (const r of unitRules) {
      H(4, `${r.id}${r.title ? ` — ${plain(r.title)}` : ''} (${SOURCE_LABEL.standard})`);
      for (const para of plain(r.text).split(/\n+/)) P(para);
    }
    for (const c of notes) {
      H(4, `${c.id}${c.title ? ` — ${plain(c.title)}` : ''}`);
      for (const para of plain(c.text).split(/\n+/)) P(para);
    }
    H(3, sub(5));
    TABLE(['العملية', 'المستوى', 'الشرط', 'الدور المعتمِد', 'عند الرفض', 'مدة التذكير'], approvalRows(g, sid));
    H(3, sub(6));
    refsPara(refList(/تقرير/));
    H(3, sub(7));
    refsPara(refList(/يُنبّه|ينبّه|تنبيه/));
    H(3, sub(8));
    TABLE(REQ_HEAD, free.map(reqRow));
  });

  // ---------- 4. shared ----------
  H(1, `4. ${T('4')}`);
  H(2, `4.0 ${T('4.0')}`);
  const gen = g.rules.filter((r) => r.chapter === '4.0');
  if (!gen.length) P(NONE);
  for (const r of gen) {
    H(3, `${r.id}${r.title ? ` — ${plain(r.title)}` : ''} (${SOURCE_LABEL.standard})`);
    for (const para of plain(r.text).split(/\n+/)) P(para);
  }
  const genNotes = d.notes.filter((c) => !c.scope || !g.chapterSections.includes(c.scope));
  for (const c of genNotes) {
    H(3, `${c.id}${c.title ? ` — ${plain(c.title)}` : ''}`);
    for (const para of plain(c.text).split(/\n+/)) P(para);
  }
  for (const ch of ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6']) {
    H(2, `${ch} ${T(ch)}`);
    if (ch === '4.1') {
      const multi = d.flags[bank.multiUserFlag];
      if (multi === false) P(X('singleUserLine', 'مستخدم واحد بصلاحيات كاملة'));
      const rq = bank.questionById.get(bank.rolesQid);
      if (rq && d.visibleQuestions.has(rq.id)) {
        const p = rq.parts.find((x) => x.type === 'list') || rq.parts[0];
        const rows = d.partValue(rq, p);
        if (Array.isArray(rows) && rows.length) TABLE((p.columns || []).map((c) => c.label), rows.map((r) => (p.columns || []).map((c) => formatCell(c, r[c.key]))));
      }
    }
    if (ch === '4.2') {
      const bq = bank.questionById.get(bank.branchesQid);
      if (bq && d.visibleQuestions.has(bq.id)) {
        const p = bq.parts.find((x) => x.type === 'list') || bq.parts[0];
        const rows = d.partValue(bq, p);
        if (Array.isArray(rows) && rows.length) { P('قائمة الفروع:'); TABLE((p.columns || []).map((c) => c.label), rows.map((r) => (p.columns || []).map((c) => formatCell(c, r[c.key])))); }
      }
    }
    // answers table for sections mapped to this chapter
    const secs = bank.sections.filter((s) => g.sharedChapter(s.id) === ch && d.visibleSections.has(s.id) && s.kind !== 'profile');
    const ansRows: string[][] = [];
    for (const s of secs) for (const q of bank.questionsBySection.get(s.id) || []) {
      if (q.section !== s.id || !d.visibleQuestions.has(q.id) || q.id === bank.rolesQid || q.id === bank.branchesQid) continue;
      const v = q.parts.filter((p) => d.visibleParts.has(`${q.id}#${p.key}`)).map((p) => formatPartValue(d, q, p, d.partValue(q, p))).filter(Boolean).join('؛ ');
      if (v) ansRows.push([q.id, shortTitle(q.title, 100), v]);
    }
    if (ansRows.length) TABLE(['السؤال', 'النص', 'الإجابة'], ansRows);
    const reqs = g.requirements.filter((r) => r.chapter === ch);
    if (reqs.length) TABLE(REQ_HEAD, reqs.map(reqRow));
    if (!ansRows.length && !reqs.length && !(ch === '4.1' && d.flags[bank.multiUserFlag] === false)) P(NONE);
  }
  H(2, `4.7 ${T('4.7')}`);
  TABLE(['البند', 'الحكم بحسب ملف الكيان', 'المرحلة', 'ملاحظة'], g.regulatory.map((r) => [r.item, r.ruling, r.phase || '—', r.note || '—']));
  H(2, `4.8 ${T('4.8')}`);
  TABLE(['البند', 'السؤال المرتبط', 'ما يجب التحقق منه'], g.verify.map((v) => [v.item, v.ref, v.what]));
  H(2, `4.9 ${T('4.9')}`);
  for (const [grp, title] of [['a', 'أ. ربط الحسابات'], ['b', 'ب. المهام غير المحاسبية']] as const) {
    const rows = g.setup.filter((r) => (r.group || 'a') === grp || (grp === 'a' && !['a', 'b'].includes(r.group)));
    H(3, title);
    TABLE(['#', 'المهمة', 'القائم بها', 'السؤال المرتبط', 'يُكتب عند'], rows.map((r) => [r.n, r.task, r.owner, r.ref, r.when]));
  }
  // remaining shared-chapter requirements not placed above (e.g. unknown section kinds)
  const placed = new Set(['summary', '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', ...g.chapterSections]);
  const rest = g.requirements.filter((r) => !placed.has(r.chapter));
  if (rest.length) { H(2, 'متطلبات أقسام أخرى'); TABLE(REQ_HEAD, rest.map(reqRow)); }

  // ---------- 5. assumptions ----------
  H(1, `5. ${T('5')}`);
  TABLE(['معرّف السؤال', 'نص السؤال مختصراً', 'القيمة المفترضة', 'سبب الافتراض'], g.assumptions.map((a) => [a.question, a.title, a.value, a.reasonText]));

  // ---------- 6. workshop log ----------
  H(1, `6. ${T('6')}`);
  H(2, 'الجلسات');
  TABLE(['البدء', 'الانتهاء', 'الميسّر', 'الحضور'], ws.sessions.map((s) => [displayDateTime(s.start), s.end ? displayDateTime(s.end) : '—', s.facilitator || '—', s.attendees.map((a) => (a.name ? `${a.name} (${a.role})` : a.role)).join('، ') || '—']));
  H(2, 'حضور الأقسام');
  const people = [...ws.sessions.flatMap((s) => s.attendees), ...ws.extraAttendees];
  const who = (id: string) => { const a = people.find((x) => x.id === id); return a ? (a.name ? `${a.name} (${a.role})` : a.role) : ''; };
  TABLE(['القسم', 'الحضور'], Object.entries(ws.sectionAttendance).filter(([, ids]) => ids.length).map(([sid, ids]) => [bank.sectionById.get(sid)?.title || sid, ids.map(who).filter(Boolean).join('، ')]));
  H(2, 'ملاحظات النقاش');
  const noteItems: string[] = [];
  for (const [sid, list] of Object.entries(ws.sectionNotes)) for (const n of list) if (n.text.trim()) noteItems.push(`${bank.sectionById.get(sid)?.title || sid} — ${n.date}: «${n.text.trim()}»`);
  UL(noteItems);
  H(2, 'تعليقات الأسئلة');
  UL(Object.entries(ws.comments).filter(([qid, c]) => c.trim() && bank.questionById.has(qid)).map(([qid, c]) => `${qid}: «${c.trim()}»`));
  H(2, 'البنود التي وُسمت «يحتاج حسماً»');
  const flagRows: string[][] = [];
  for (const f of ws.flags) flagRows.push([f.qid, f.reason, f.opinions || '—', f.decider || '—', statusLabel(f.status), f.resolution || '—']);
  for (const f of g.allFlags) flagRows.push([f.qid || '—', f.text, '—', 'تلقائي', statusLabel(f.status), f.resolution || '—']);
  TABLE(['السؤال', 'السبب', 'الآراء', 'من سيحسم', 'الحالة', 'كيف حُسم'], flagRows);

  // ---------- 7. out of scope ----------
  H(1, `7. ${T('7')}`);
  UL([...new Set(g.outOfScope)]);

  // ---------- 8. appendix ----------
  H(1, `8. ${T('8')}`);
  blocks.push({ t: 'code', lang: 'yaml', text: toYaml(buildAppendix(g, now)) });

  // TOC (static)
  const toc = blocks.filter((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level <= 2).map((b) => ({ level: b.level, text: b.text }));
  blocks.splice(tocIndex, 0, { t: 'h', level: 1, text: 'المحتويات' }, { t: 'toc', items: toc });

  return { title: `وثيقة المتطلبات — ${entity}`, entity, date: today, fileBase: `متطلبات-${safeName(entity)}-${today}`, blocks };
}

function statusLabel(s: string) {
  return s === 'open' ? 'مفتوحة' : s === 'answered' ? 'محسومة بإجابة' : 'مقبول فيها الموصى به افتراضاً مُعلناً';
}

function approvalRows(g: GenResult, sid: string): string[][] {
  const { d } = g;
  const rows: string[][] = [];
  for (const q of d.bank.questionsBySection.get(sid) || []) {
    if (!d.visibleQuestions.has(q.id)) continue;
    for (const p of q.parts) {
      if (!d.visibleParts.has(`${q.id}#${p.key}`)) continue;
      const cols = p.columns || [];
      const approver = cols.find((c) => /approver/.test(c.key) || (c.type === 'role' && /اعتماد|المعتمِد|المعتمد/.test(c.label)));
      if (!approver) continue;
      const rej = cols.find((c) => /reject/.test(c.key));
      const rem = cols.find((c) => /remind/.test(c.key));
      const lvl = cols.find((c) => /level/.test(c.key));
      const cond = cols.filter((c) => /from|to|condition|when|amount/.test(c.key));
      const v = d.partValue(q, p);
      const list: any[] = p.type === 'approvalRow' ? (v ? [v] : []) : Array.isArray(v) ? v : [];
      list.forEach((r, i) => {
        rows.push([
          `${p.label || shortTitle(q.title, 60)} (${q.id})`,
          lvl ? formatCell(lvl, r[lvl.key]) || String(i + 1) : String(i + 1),
          cond.map((c) => { const x = formatCell(c, r[c.key]); return x ? `${c.label}: ${x}` : ''; }).filter(Boolean).join('، ') || '—',
          formatCell(approver, r[approver.key]) || '—',
          rej ? formatCell(rej, r[rej.key]) || '—' : '—',
          rem ? formatCell(rem, r[rem.key]) || '—' : '—',
        ]);
      });
    }
  }
  return rows;
}

function scopeParagraph(g: GenResult): string {
  const { d } = g;
  const bank = d.bank;
  const val = (qid: string) => {
    const q = bank.questionById.get(qid);
    if (!q || !d.visibleQuestions.has(q.id)) return '';
    return formatPartValue(d, q, q.parts[0], d.partValue(q, q.parts[0]));
  };
  const bits: string[] = [];
  const type = val('PRF-002');
  bits.push(`نظام لـ«${d.ws.entityName || '—'}»${type ? ` (${type})` : ''}`);
  const users = val('PRF-004.ب') || val('PRF-004');
  if (users) bits.push(`عدد المستخدمين: ${users}`);
  const sites = val('PRF-005');
  if (sites) bits.push(`عدد المواقع: ${sites}`);
  const vat = val('PRF-003');
  if (vat) bits.push(vat);
  const units = g.chapterSections.map((s) => bank.sectionById.get(s)?.title || s);
  return `${bits.join('، ')}؛ يشمل: ${units.join('، ') || '—'}.`;
}
