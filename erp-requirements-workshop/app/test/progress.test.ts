import { describe, it, expect } from 'vitest';
import { fixtureBank, fixtureFiles } from './helpers';
import { mergeBank } from '../src/engine/load';
import { exportProgress, importProgress, canonical, sha256Hex } from '../src/engine/progress';
import { newWorkshop, setPart, startSession, addFlag, setComment, setSectionNote, setAttendance } from '../src/engine/workshop';
import { Storage } from '../src/engine/storage';
import type { Workshop } from '../src/engine/types';

const bank = fixtureBank();

function big(): Workshop {
  let ws = newWorkshop(bank, 'كيان الاختبار');
  ws = startSession(ws, 'الميسّر', [{ id: 'p1', role: 'المالك' }]);
  ws = setPart(bank, ws, 'PRF-003', 'main', 'vat_registered');
  for (let i = 0; i < 149; i++) ws.answers[`SAL-${900 + i}`] = { parts: { main: `v${i}` }, source: 'answer', touched: true, updatedAt: new Date().toISOString() };
  ws = addFlag(ws, 'PRF-003', 'سبب');
  ws = setComment(ws, 'PRF-003', 'تعليق');
  ws = setSectionNote(ws, 'PRF', 'ملاحظة', '2026-10-08');
  ws = setAttendance(ws, 'PRF', ['p1']);
  ws.lastQuestion = 'PRF-003';
  return ws;
}

async function reseal(file: any) {
  file.checksum = 'sha256:' + (await sha256Hex(canonical(file.workshop)));
  return JSON.stringify(file);
}

describe('progress file (FR-23, NFR-14)', () => {
  it('ر-٣: 150 answers, flags, notes, attendance round-trip; last position kept', async () => {
    const ws = big();
    expect(Object.keys(ws.answers).length).toBe(150);
    const { name, text } = await exportProgress(ws, bank);
    expect(name).toMatch(/^تقدم-كيان-الاختبار-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    // same bank but unknown SAL-9xx ids are archived; use a bank that knows them
    const files: any = fixtureFiles();
    for (let i = 0; i < 149; i++) files['sal.json'].questions.push({ id: `SAL-${900 + i}`, section: 'SAL', order: 900 + i, title: 'x', parts: [{ key: 'main', type: 'text' }] });
    const b2 = mergeBank(files);
    const { workshop } = await importProgress(text, b2);
    expect(Object.keys(workshop.answers).length).toBe(150);
    expect(workshop.flags.length).toBe(1);
    expect(workshop.comments['PRF-003']).toBe('تعليق');
    expect(workshop.sectionNotes.PRF[0].text).toBe('ملاحظة');
    expect(workshop.sectionAttendance.PRF).toEqual(['p1']);
    expect(workshop.lastQuestion).toBe('PRF-003');
  });

  it('rejects tampered content (checksum mismatch)', async () => {
    const { text } = await exportProgress(big(), bank);
    const f = JSON.parse(text);
    f.workshop.entityName = 'معدّل';
    await expect(importProgress(JSON.stringify(f), bank)).rejects.toThrow(/بصمة السلامة/);
  });

  it('rejects malformed / foreign / oversize files', async () => {
    await expect(importProgress('not json', bank)).rejects.toThrow(/JSON/);
    await expect(importProgress(JSON.stringify({ format: 'other' }), bank)).rejects.toThrow();
    await expect(importProgress('x'.repeat(10 * 1024 * 1024 + 1), bank)).rejects.toThrow(/10/);
    const { text } = await exportProgress(big(), bank);
    const f = JSON.parse(text);
    f.workshop.flags = 'bad';
    await expect(importProgress(await reseal(f), bank)).rejects.toThrow();
  });

  it('rejects prototype-polluting keys even with a valid checksum', async () => {
    const { text } = await exportProgress(big(), bank);
    const evil = text.replace('"answers":{', '"answers":{"__proto__":{"polluted":true},');
    const f = JSON.parse(evil);
    await expect(importProgress(await reseal(f), bank)).rejects.toThrow(/محظور/);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('script-like content stays inert text', async () => {
    let ws = big();
    ws = setComment(ws, 'PRF-003', '<img src=x onerror=alert(1)><script>alert(1)</script>');
    const { text } = await exportProgress(ws, bank);
    const { workshop } = await importProgress(text, bank);
    expect(workshop.comments['PRF-003']).toBe('<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(typeof workshop.comments['PRF-003']).toBe('string');
  });

  it('bank version mismatch: answers matched by id, removed questions archived, new questions tagged, roles mapped', async () => {
    let ws = big();
    ws.answers['OLD-001'] = { parts: { main: 'x' }, source: 'answer', touched: true, updatedAt: '' };
    ws.answers['SAL-009'] = { parts: { main: [{ _k: '1', approver: 'البائع' }] }, source: 'answer', touched: true, updatedAt: '' };
    const old = { version: 'old-0.0', questions: bank.questions.filter((q) => q.id !== 'TAX-001') };
    const { text } = await exportProgress(ws, old as any);
    const { workshop, report } = await importProgress(text, bank);
    expect(report!.fromBankVersion).toBe('old-0.0');
    expect(report!.archived.map((a) => a.qid)).toContain('OLD-001');
    expect(workshop.newQuestions).toContain('TAX-001');
    expect(workshop.answers['PRF-003'].parts.main).toBe('vat_registered');
    expect(report!.roleMappings).toEqual([{ from: 'البائع', to: 'موظف المبيعات' }]);
  });
});

describe('storage (FR-22, NFR-03)', () => {
  it('saves synchronously and lists workshops', () => {
    const mem = new Map<string, string>();
    const s = new Storage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
    const ws = big();
    s.save(ws, 40);
    expect(s.list()[0]).toMatchObject({ id: ws.id, entityName: 'كيان الاختبار', completion: 40 });
    expect(s.load(ws.id)!.answers['PRF-003'].parts.main).toBe('vat_registered');
    s.remove(ws.id);
    expect(s.list()).toEqual([]);
  });
  it('throws on quota errors so the UI can alert immediately', () => {
    const s = new Storage({ getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); }, removeItem: () => {} });
    expect(() => s.save(big(), 0)).toThrow();
    expect(new Storage(null).available).toBe(false);
  });
});
