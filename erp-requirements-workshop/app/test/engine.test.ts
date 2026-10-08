import { describe, it, expect } from 'vitest';
import { fixtureBank, fixtureFiles } from './helpers';
import { mergeBank } from '../src/engine/load';
import { derive } from '../src/engine/compute';
import { parseRef } from '../src/engine/refs';
import { parseTemplate, renderTemplate } from '../src/engine/slots';
import { generate } from '../src/engine/generate';
import { newWorkshop, setPart, setDontKnow, applyRecommended, completeSection, bulkCandidates, resolveAutoFlag, addFlag, resolveManualFlag } from '../src/engine/workshop';
import { planPath, MAX_SESSION_MIN } from '../src/engine/time';
import type { Bank, Workshop } from '../src/engine/types';

const bank = fixtureBank();
const set = (ws: Workshop, qid: string, part: string, v: any, b: Bank = bank) => setPart(b, ws, qid, part, v);

function multiUserVat(): Workshop {
  let ws = newWorkshop(bank, 'مؤسسة الاختبار');
  ws = set(ws, 'PRF-001', 'main', 'مؤسسة الاختبار');
  ws = set(ws, 'PRF-003', 'main', 'vat_registered');
  ws = set(ws, 'PRF-004', 'main', 'users_6_20');
  ws = set(ws, 'PRF-005', 'main', 'sites_2_3');
  ws = set(ws, 'PRF-007', 'main', 'yes');
  ws = set(ws, 'SCP-001', 'main', { sal: 'must_day_one' });
  return ws;
}

describe('refs', () => {
  it('parses Arabic/dotted ids and part/row/col forms', () => {
    expect(parseRef('PRF-003.ب')).toMatchObject({ qid: 'PRF-003.ب' });
    expect(parseRef('PRF-003.ب#approach_pct')).toMatchObject({ qid: 'PRF-003.ب', part: 'approach_pct' });
    expect(parseRef('SAL-008#approval.approver')).toMatchObject({ qid: 'SAL-008', part: 'approval', sub: 'approver' });
    expect(parseRef('PUR-008#main[3].to')).toMatchObject({ part: 'main', row: '3', sub: 'to' });
    expect(parseRef('ROL-002#main.owner.sal')).toMatchObject({ part: 'main', row: 'owner', sub: 'sal' });
    expect(parseRef('X-1#main[row]._label')).toMatchObject({ row: 'row', sub: '_label' });
  });
});

describe('loading', () => {
  it('resolves eqLabel/hasLabel to keys and reports unresolved ones', () => {
    const sal29 = bank.questionById.get('SAL-029')!;
    expect(sal29.condition).toEqual({ eq: ['SAL-018', 'cod'] });
    expect(bank.questionById.get('SAL-018')!.condition).toEqual({ has: ['SAL-001', 'delivery'] });
    const files: any = fixtureFiles();
    files['sal.json'].questions[0].condition = { eqLabel: ['PRF-003', 'خيار غير موجود'] };
    const b2 = mergeBank(files);
    expect(b2.report.unresolvedLabels.length).toBe(1);
    expect(b2.questionById.get('SAL-001')!.condition).toEqual({ unresolved: { eqLabel: ['PRF-003', 'خيار غير موجود'] } });
  });
  it('lists {"text"} conditions and treats them as true', () => {
    const files: any = fixtureFiles();
    files['sal.json'].questions[0].condition = { text: 'شرط نصي' };
    const b2 = mergeBank(files);
    expect(b2.report.textConditions.some((t) => t.detail === 'شرط نصي')).toBe(true);
  });
  it('section contains → alsoIn; meta order authoritative', () => {
    expect(bank.questionById.get('ROL-001')!.alsoIn).toContain('ROLES');
    expect(bank.sections.map((s) => s.id)).toEqual(['PRF', 'SCP', 'ROLES', 'GEN', 'SAL', 'TAX', 'ROL', 'ADM']);
  });
});

describe('expressions, flags, modules, visibility', () => {
  it('derives flags and modules; deferred unit is false; auto-added TAX', () => {
    const d = derive(bank, multiUserVat());
    expect(d.flags.F_VAT).toBe(true);
    expect(d.flags.F_MULTIUSER).toBe(true);
    expect(d.modules.SAL).toBe(true);
    expect(d.modules.POS).toBe(false);
    expect(d.visibleSections.has('TAX')).toBe(true);
    expect(d.visibleSections.has('ROLES')).toBe(true);
  });
  it('selecting a deferred unit records the need but keeps M(X) false', () => {
    let ws = multiUserVat();
    ws = set(ws, 'SCP-001', 'main', { sal: 'must_day_one', pos: 'later_phase' });
    const d = derive(bank, ws);
    expect(d.modules.POS).toBe(false);
    const g = generate(bank, ws);
    expect(g.deferredNeeds.map((x) => x.id)).toContain('POS');
  });
  it('dont-know uses the (dynamic) recommendation before evaluation', () => {
    let ws = multiUserVat();
    ws = setDontKnow(ws, 'PRF-003');
    const d = derive(bank, ws);
    expect(d.flags.F_VAT).toBe(true); // recommended vat_registered
    expect(d.autoFlags.some((f) => f.key === 'dk:PRF-003')).toBe(true); // ق-ت9
  });
  it('dynamic recommendation (FR-05)', () => {
    let ws = multiUserVat();
    const q = bank.questionById.get('SAL-008')!;
    expect(derive(bank, ws).rec(q, q.parts[0]).value).toBe('credit_block');
    ws = set(ws, 'PRF-004', 'main', 'one_person');
    expect(derive(bank, ws).rec(q, q.parts[0]).value).toBe('credit_warn');
    const n = bank.questionById.get('PRF-004.ب')!;
    ws = set(ws, 'PRF-004', 'main', 'users_6_20');
    expect(derive(bank, ws).rec(n, n.parts[0]).value).toBe(6);
  });
  it('detail questions appear on demand and part conditions apply', () => {
    let ws = multiUserVat();
    expect(derive(bank, ws).visibleQuestions.has('SAL-008')).toBe(false);
    ws = set(ws, 'SAL-001', 'main', ['credit', 'delivery']);
    const d = derive(bank, ws);
    expect(d.visibleQuestions.has('SAL-008')).toBe(true);
    expect(d.visibleQuestions.has('SAL-018')).toBe(true);
    expect(d.visibleParts.has('SAL-008#approval')).toBe(false);
    ws = set(ws, 'SAL-008', 'main', 'credit_block');
    expect(derive(bank, ws).visibleParts.has('SAL-008#approval')).toBe(true);
  });
  it('archives hidden answers and restores them (FR-09)', () => {
    let ws = multiUserVat();
    ws = set(ws, 'SAL-001', 'main', ['credit', 'delivery']);
    ws = set(ws, 'SAL-008', 'main', 'credit_block');
    ws = set(ws, 'SAL-018', 'main', 'cod');
    ws = set(ws, 'SAL-029', 'main', 'block');
    expect(derive(bank, ws).archived).toEqual([]);
    const hidden = set(ws, 'SAL-001', 'main', ['cash']);
    const dh = derive(bank, hidden);
    expect(dh.archived.sort()).toEqual(['SAL-008', 'SAL-018', 'SAL-029']);
    const back = set(hidden, 'SAL-001', 'main', ['credit', 'delivery']);
    const db = derive(bank, back);
    expect(db.archived).toEqual([]);
    expect(db.partValue(bank.questionById.get('SAL-029')!, bank.questionById.get('SAL-029')!.parts[0])).toBe('block');
  });
  it('ر-٢: credit limit + COD → shows SAL-029 and raises the bank conflict flag; export blocked', () => {
    let ws = multiUserVat();
    ws = set(ws, 'SAL-001', 'main', ['credit', 'delivery']);
    ws = set(ws, 'SAL-008', 'main', 'credit_block');
    ws = set(ws, 'SAL-018', 'main', 'cod');
    const t0 = performance.now();
    const d = derive(bank, ws);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(d.visibleQuestions.has('SAL-029')).toBe(true);
    const f = d.autoFlags.find((x) => x.key === 'conflict:تع-SAL-01')!;
    expect(f.qid).toBe('SAL-029');
    expect(f.text).toContain('اجتمع حد ائتمان');
    expect(generate(bank, ws).openFlags).toBeGreaterThan(0);
  });
  it('note conflicts are collected for the document', () => {
    let ws = multiUserVat();
    ws = set(ws, 'SAL-001', 'main', ['cash']);
    expect(derive(bank, ws).notes.map((n) => n.id)).toContain('تع-SAL-03');
  });
});

describe('roles (FR-07) and lists (FR-06)', () => {
  it('role options = ROL-001 rows + dynamic recipients; distribution fills users', () => {
    let ws = multiUserVat();
    ws = set(ws, 'PRF-004.ب', 'main', 8);
    const d = derive(bank, ws);
    const keys = d.roleOptions().map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['owner', 'accountant', 'sales_employee', 'document_creator', 'approver_concerned']));
    expect(d.roleLabel('owner')).toBe('المالك');
    const q = bank.questionById.get('ROL-001')!;
    const rows = d.listRows(q, q.parts[0]);
    expect(rows.reduce((a, r) => a + r.users, 0)).toBe(8);
    expect(rows.find((r) => r._k === 'sales_employee').users).toBe(6);
  });
  it('single user: «المستخدم الوحيد»', () => {
    let ws = multiUserVat();
    ws = set(ws, 'PRF-004', 'main', 'one_person');
    const d = derive(bank, ws);
    expect(d.roleOptions()[0]).toEqual({ key: 'sole_user', label: 'المستخدم الوحيد' });
    expect(d.visibleSections.has('ROLES')).toBe(false);
  });
});

describe('slots', () => {
  it('parses IF with JSON containing }} and nested slots in SW branches', () => {
    const r = parseTemplate('أ {{IF:{"not":{"flag":"F_VAT"}}|ب {{Q:GEN-001}}}} ج {{SW:SAL-018|cod=د {{Q:GEN-001}}|*=هـ}} {{MISSING:وصف}}');
    expect(r.errors).toEqual([]);
    expect(r.nodes.map((n) => n.t)).toEqual(['text', 'IF', 'text', 'SW', 'text', 'MISSING']);
  });
  it('renders values, roles, IF, SW; MISSING becomes an issue', () => {
    let ws = multiUserVat();
    ws = set(ws, 'SAL-001', 'main', ['credit', 'delivery']);
    ws = set(ws, 'SAL-008', 'main', 'credit_block');
    ws = set(ws, 'SAL-008', 'approval', { approver: 'owner', on_reject: 'return_to_creator', reminder_hours: 24 });
    ws = set(ws, 'GEN-013', 'a', 'incl_vat');
    const d = derive(bank, ws);
    const t = bank.questionById.get('SAL-008')!.templates![0].text;
    const out = renderTemplate(d, t);
    expect(out.text).toContain('شاملاً الضريبة');
    expect(out.text).toContain('«المالك»');
    expect(out.text).toContain('يعود للمُنشئ');
    expect(out.text).toContain('24 ساعة');
    expect(out.text).not.toContain('دون فصل الضريبة');
    const m = renderTemplate(d, 'x {{MISSING:مهلة}}');
    expect(m.issues).toEqual([{ kind: 'missing', desc: 'مهلة' }]);
    expect(renderTemplate(d, 'العملة {GEN-001}').text).toBe('العملة {GEN-001}'); // unanswered → verbatim
    const d2 = derive(bank, set(ws, 'GEN-001', 'main', 'sar'));
    expect(renderTemplate(d2, 'العملة {GEN-001}').text).toBe('العملة الريال السعودي');
  });
});

describe('generation', () => {
  function fullWs(): Workshop {
    let ws = multiUserVat();
    ws = set(ws, 'SAL-001', 'main', ['cash', 'credit']);
    ws = set(ws, 'SAL-008', 'main', 'credit_block');
    return ws;
  }
  it('priority from SCP-001, never «غير محددة»; perItem / forEach instance ids', () => {
    let ws = fullWs();
    ws = set(ws, 'SCP-001', 'main', { sal: 'later_phase' });
    const g = generate(bank, ws);
    const r8 = g.requirements.find((r) => r.id === 'SAL-R008')!;
    expect(r8.priorityLabel).toBe('مرحلة لاحقة');
    expect(r8.source).toBe('answer');
    expect(g.requirements.filter((r) => r.templateId === 'SAL-R001x').map((r) => r.id)).toEqual(['SAL-R001x-01', 'SAL-R001x-02']);
    const tiers = g.requirements.filter((r) => r.templateId === 'SAL-R009x');
    expect(tiers.map((r) => r.id)).toEqual(['SAL-R009x-01', 'SAL-R009x-02']);
    expect(tiers[1].text).toContain('أكبر من 5'); // last tier without upper bound (rule 11)
    expect(g.requirements.every((r) => r.priorityLabel && r.priorityLabel !== 'غير محددة')).toBe(true);
    const tax = g.requirements.find((r) => r.id === 'TAX-R001')!;
    expect(tax.priority).toBe('later_phase');
  });
  it('standard rules: unit rules in 3.x.4, general in 4.0, IF clauses applied', () => {
    const g = generate(bank, fullWs());
    expect(g.rules.find((r) => r.id === 'STD-SAL-01')!.chapter).toBe('SAL');
    expect(g.rules.find((r) => r.id === 'STD-SAL-01')!.text).toContain('فاتورة ضريبية');
    expect(g.rules.find((r) => r.id === 'STD-GEN-01')!.chapter).toBe('4.0');
    let ws = fullWs();
    ws = set(ws, 'PRF-004', 'main', 'one_person');
    expect(generate(bank, ws).rules.some((r) => r.id === 'STD-GEN-02')).toBe(false);
  });
  it('ر-٤: one open flag + 3 unanswered → gate closed; after resolution and bulk-recommended, assumptions list them', () => {
    let ws = fullWs();
    ws = addFlag(ws, 'SAL-008', 'خلاف على الحد', 'المالك');
    let g = generate(bank, ws);
    expect(g.openFlags).toBeGreaterThan(0);
    const un = g.unanswered.flatMap((u) => u.qids);
    expect(un.length).toBeGreaterThanOrEqual(3);
    ws = resolveManualFlag(ws, ws.flags[0].id, 'answered', 'قرر المالك الإبقاء على الحد');
    for (const f of generate(bank, ws).allFlags.filter((x) => x.status === 'open')) ws = resolveAutoFlag(ws, f.key, 'assumed', 'قُبل', 'قيمة');
    const three = un.slice(0, 3);
    ws = applyRecommended(bank, ws, three, 'unanswered');
    g = generate(bank, ws);
    expect(g.openFlags).toBe(0);
    for (const q of three) {
      const a = g.assumptions.find((x) => x.question === q);
      if (a) expect(a.reasonText).toBe('لم يُجب');
    }
    expect(three.some((q) => g.assumptions.some((a) => a.question === q))).toBe(true);
  });
  it('missing slot becomes a flag and its resolved value fills the slot', () => {
    let ws = fullWs();
    ws = set(ws, 'SAL-001', 'main', ['cash', 'credit', 'delivery']);
    ws = set(ws, 'SAL-018', 'main', 'cod');
    let g = generate(bank, ws);
    const f = g.slotFlags.find((x) => x.text.includes('مهلة التسليم'))!;
    expect(f).toBeTruthy();
    expect(f.text).toContain('خانة بلا مصدر في قالب');
    ws = resolveAutoFlag(ws, f.key, 'assumed', 'حدده المالك', 'يومان');
    g = generate(bank, ws);
    expect(g.requirements.find((r) => r.id === 'SAL-R029')!.text).toContain('يومان');
    expect(g.slotFlags.find((x) => x.key === f.key)!.status).toBe('assumed');
  });
  it('bulk accept for detail questions (FR-13) and prefilled rows at completion', () => {
    let ws = fullWs();
    const c = bulkCandidates(bank, ws, 'SAL');
    expect(c).toEqual(expect.arrayContaining(['SAL-008', 'SAL-009'].filter((x) => !ws.answers[x])));
    ws = completeSection(bank, ws, 'GEN');
    expect(ws.answers['GEN-003'].reason).toBe('prefilled_accepted');
    expect(ws.completedSections).toContain('GEN');
  });
  it('free text and scope "other" → R9nn ids with free_text source', () => {
    let ws = fullWs();
    ws = setPart(bank, ws, 'SCP-001', 'main', { sal: 'must_day_one', other: 'nice_to_have' }, { otherText: 'إدارة الاشتراكات' });
    ws = set(ws, 'SAL-099', 'main', 'نحتاج طباعة فاتورة مختصرة');
    const g = generate(bank, ws);
    const scp = g.requirements.find((r) => r.templateId === 'SCP-R9nn')!;
    expect(scp.id).toBe('SCP-R901');
    expect(scp.text).toContain('إدارة الاشتراكات');
    expect(scp.text).toContain('مستحسن إن أمكن');
    expect(scp.chapter).toBe('summary');
    const sal = g.requirements.find((r) => r.id === 'SAL-R901')!;
    expect(sal.source).toBe('free_text');
  });
});

describe('time (FR-12)', () => {
  it('splits sessions ≤ 180 minutes', () => {
    const p = planPath(derive(bank, multiUserVat()));
    expect(p.sessions.every((s) => s.minutes <= MAX_SESSION_MIN || s.sections.length === 1)).toBe(true);
    expect(p.total).toBeGreaterThan(0);
  });
});

describe('performance (NFR-04)', () => {
  it('derive over ~600 synthetic questions stays ≤ 100 ms', () => {
    const files: any = fixtureFiles();
    const extra: any[] = [];
    for (let i = 0; i < 600; i++) {
      extra.push({
        id: `SYN-${String(i).padStart(3, '0')}`, section: 'SAL', order: 200 + i, title: `سؤال ${i}`, detail: i % 2 === 1,
        condition: i % 2 ? { eq: [`SYN-${String(i - 1).padStart(3, '0')}`, 'a'] } : { module: 'SAL' },
        parts: [{ key: 'main', type: 'single', options: [{ key: 'a', label: 'أ' }, { key: 'b', label: 'ب' }], recommended: { value: 'a', when: [{ if: { flag: 'F_VAT' }, value: 'b' }] } }],
        templates: [{ id: `SYN-R${i}`, when: null, text: 'يجب {{Q:SYN-' + String(i).padStart(3, '0') + '}}' }],
      });
    }
    files['sal.json'].questions.push(...extra);
    const b = mergeBank(files);
    let ws = multiUserVat();
    for (let i = 0; i < 600; i += 2) ws.answers[`SYN-${String(i).padStart(3, '0')}`] = { parts: { main: 'a' }, source: 'answer', touched: true, updatedAt: '' };
    derive(b, ws);
    const times: number[] = [];
    for (let k = 0; k < 10; k++) { const t0 = performance.now(); derive(b, ws); times.push(performance.now() - t0); }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(100);
    const t1 = performance.now();
    generate(b, ws);
    expect(performance.now() - t1).toBeLessThan(5000);
  });
});
