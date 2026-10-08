// Smoke tests against the real bank-data/*.json (skipped if the folder has no JSON).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBank, checkExprRefs } from '../src/engine/load';
import { derive } from '../src/engine/compute';
import { generate } from '../src/engine/generate';
import { buildDocument } from '../src/engine/doc';
import { toMarkdown } from '../src/engine/export-md';
import { newWorkshop, setPart, applyRecommended } from '../src/engine/workshop';
import { planPath } from '../src/engine/time';

const dir = join(__dirname, '..', 'bank-data');
const files: Record<string, unknown> = {};
if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) files[f] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
const has = Object.keys(files).length > 0;

describe.skipIf(!has)('real bank', () => {
  const bank = mergeBank(files);

  it('loads with no duplicate ids and resolves labels', () => {
    expect(bank.questions.length).toBeGreaterThan(100);
    expect(bank.report.errors.filter((e) => e.kind === 'duplicate')).toEqual([]);
    // report unresolved for visibility (not a hard failure here; validate-bank lists them)
    console.log('questions', bank.questions.length, 'rules', bank.rules.length, 'conflicts', bank.conflicts.length, 'unresolved labels', bank.report.unresolvedLabels.length, 'text conditions', bank.report.textConditions.length);
    const refs = checkExprRefs(bank);
    console.log('expr ref errors', refs.filter((r) => r.severity === 'error').length, 'warnings', refs.filter((r) => r.severity === 'warning').length);
  });

  it('persona ر-١: VAT, 2 branches, 12 users, six core units → TAX auto-added, path ≤ 6h', () => {
    let ws = newWorkshop(bank, 'مؤسسة النموذج');
    ws = setPart(bank, ws, 'PRF-001', 'main', 'مؤسسة النموذج');
    ws = setPart(bank, ws, 'PRF-002', 'main', 'company');
    ws = setPart(bank, ws, 'PRF-003', 'main', 'vat_registered');
    ws = setPart(bank, ws, 'PRF-004', 'main', 'users_6_20');
    ws = setPart(bank, ws, 'PRF-004.ب', 'main', 12);
    ws = setPart(bank, ws, 'PRF-005', 'main', 'sites_2_3');
    ws = setPart(bank, ws, 'PRF-007', 'main', 'yes');
    ws = setPart(bank, ws, 'PRF-008', 'main', 'emp_6_20');
    ws = setPart(bank, ws, 'PRF-006', 'main', ['trade']);
    ws = setPart(bank, ws, 'PRF-010', 'main', ['individuals', 'companies']);
    ws = setPart(bank, ws, 'SCP-001', 'main', { acc: 'must_day_one', sal: 'must_day_one', pur: 'must_day_one', inv: 'must_day_one', exp: 'later_phase', trs: 'must_day_one' });
    const t0 = performance.now();
    const d = derive(bank, ws);
    const ms = performance.now() - t0;
    console.log('derive ms', ms.toFixed(1), 'iterations', d.iterations, 'visible q', d.visibleQuestions.size);
    expect(d.visibleSections.has('TAX')).toBe(true);
    expect(d.flags.F_VAT).toBe(true);
    expect(d.modules.SAL).toBe(true);
    expect(d.visibleSections.has('ROLES')).toBe(true);
    const plan = planPath(d);
    console.log('path minutes', plan.total, 'sessions', plan.sessions.map((s) => s.minutes));
    expect(plan.total).toBeLessThanOrEqual(360);
    expect(plan.sessions.every((s) => s.minutes <= 180)).toBe(true);
    // fill everything with recommended and generate
    const all = bank.questions.filter((q) => d.visibleQuestions.has(q.id) && !ws.answers[q.id]).map((q) => q.id);
    ws = applyRecommended(bank, ws, all, 'unanswered');
    const t1 = performance.now();
    const g = generate(bank, ws);
    const doc = buildDocument(g);
    const md = toMarkdown(doc);
    const genMs = performance.now() - t1;
    console.log('generate+doc ms', genMs.toFixed(0), 'requirements', g.requirements.length, 'rules', g.rules.length, 'assumptions', g.assumptions.length, 'slot flags', g.slotFlags.length, 'auto flags', g.d.autoFlags.length, 'md KB', (md.length / 1024).toFixed(0));
    for (const f of g.slotFlags.slice(0, 40)) console.log('  slot', f.key);
    for (const f of g.d.autoFlags) console.log('  auto', f.key, f.text.slice(0, 140));
    expect(g.requirements.length).toBeGreaterThan(50);
    expect(md).not.toMatch(/غير محددة/);
    expect(md).not.toMatch(/\{\{/);
  });
});
