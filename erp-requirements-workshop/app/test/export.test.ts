import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { fixtureBank } from './helpers';
import { generate } from '../src/engine/generate';
import { buildDocument } from '../src/engine/doc';
import { toMarkdown, mdToPlain } from '../src/engine/export-md';
import { toDocx } from '../src/engine/export-docx';
import { docPlainText } from '../src/engine/docmodel';
import { buildAppendix, toYaml } from '../src/engine/appendix';
import { newWorkshop, setPart, startSession, addFlag, resolveManualFlag, setComment, setSectionNote, endSession } from '../src/engine/workshop';

const bank = fixtureBank();
function ws() {
  let w = newWorkshop(bank, 'مؤسسة | النموذج <b>');
  w = startSession(w, 'إياد', [{ id: 'a1', role: 'المالك', name: 'سعد' }, { id: 'a2', role: 'المحاسب' }]);
  for (const [q, p, v] of [
    ['PRF-001', 'main', 'مؤسسة | النموذج <b>'], ['PRF-003', 'main', 'vat_registered'], ['PRF-004', 'main', 'users_6_20'], ['PRF-005', 'main', 'sites_2_3'],
    ['PRF-007', 'main', 'yes'], ['SCP-001', 'main', { sal: 'must_day_one', hr: 'later_phase' }], ['SAL-001', 'main', ['cash', 'credit']], ['SAL-008', 'main', 'credit_warn'],
    ['SAL-099', 'main', 'نص حر فيه `علامات` و*نجوم* و|أنابيب|'],
  ] as const) w = setPart(bank, w, q, p, v as any);
  w = addFlag(w, 'SAL-008', 'تردد');
  w = resolveManualFlag(w, w.flags[0].id, 'answered', 'حسمه المالك');
  w = setComment(w, 'SAL-001', 'تعليق');
  w = setSectionNote(w, 'SAL', 'ملاحظة النقاش', '2026-10-08');
  w = endSession(w);
  return w;
}

const norm = (s: string) => s.replace(/\s+/g, '');

describe('document export', () => {
  const g = generate(bank, ws());
  const doc = buildDocument(g, new Date('2026-10-08T10:00:00'));

  it('has the approved structure and no unresolved slots', () => {
    const heads = doc.blocks.filter((b) => b.t === 'h' && b.level === 1).map((b: any) => b.text);
    expect(heads).toEqual(['1. الغلاف', 'المحتويات', '2. الملخص التنفيذي', '3. المتطلبات حسب الوحدة', '4. الجوانب المشتركة', '5. سجل الافتراضات', '6. سجل الورشة', '7. خارج النطاق', '8. الملحق المهيكل (YAML)']);
    const md = toMarkdown(doc);
    expect(md).not.toMatch(/\{\{|غير محددة/);
    expect(md).toContain('شؤون الموظفين (HR): حاجة مسجلة');
    expect(md).toContain('ضريبة القيمة المضافة | ينطبق | الآن');
    expect(doc.fileBase).toMatch(/^متطلبات-/);
  });

  it('Markdown escapes user text (no table/HTML injection)', () => {
    const md = toMarkdown(doc).replace(/```yaml[\s\S]*?```/, '');
    expect(md).toContain('مؤسسة \\| النموذج \\<b\\>');
    expect(md).not.toMatch(/<b>/);
  });

  it('Word and Markdown have identical text content (NFR-10)', async () => {
    const blob = await toDocx(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('w:bidi');
    expect(xml).toContain('w:bidiVisual');
    expect(xml).toContain('w:rtl');
    const docxText = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const modelText = docPlainText(doc).join('');
    expect(norm(docxText)).toBe(norm(modelText));
    const mdText = mdToPlain(toMarkdown(doc)).replace(/\|/g, '');
    expect(norm(mdText)).toBe(norm(modelText.replace(/\|/g, '')));
  });

  it('YAML appendix uses English keys and option keys', () => {
    const y = toYaml(buildAppendix(g));
    expect(y).toContain('bank_version: "test-0.1"');
    expect(y).toMatch(/PRF-003:\n\s+value: vat_registered\n\s+source: answer/);
    expect(y).toContain('F_VAT: true');
    expect(y).toMatch(/SAL:\n\s+selected: true\n\s+priority: must_day_one/);
    expect(y).toMatch(/requirements:\n\s+- id: /);
  });
});
