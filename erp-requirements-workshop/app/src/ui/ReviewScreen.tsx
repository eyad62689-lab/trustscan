import { useMemo, useState } from 'preact/hooks';
import type { AppState } from './store';
import { setState, mutate, goSection, toast } from './store';
import { generate, type GenResult } from '../engine/generate';
import { buildDocument } from '../engine/doc';
import { applyRecommended, resolveAutoFlag, resolveManualFlag } from '../engine/workshop';
import type { AutoFlag } from '../engine/compute';
import type { ManualFlag } from '../engine/types';
import { Dialog, RichText, PrivacyNotice, download } from './common';
import { DocPreview } from './DocPreview';
import { toMarkdown } from '../engine/export-md';
import { exportProgressFile } from './Workspace';

type AnyFlag = { key: string; qid: string; text: string; manual?: ManualFlag; auto?: AutoFlag };

export function ReviewScreen(props: { st: AppState }) {
  const { st } = props;
  const bank = st.bank!;
  const ws = st.ws!;
  const g: GenResult = useMemo(() => generate(bank, ws), [ws]);
  const [how, setHow] = useState<Record<string, string>>({});
  const [slotVal, setSlotVal] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const open: AnyFlag[] = [
    ...ws.flags.filter((f) => f.status === 'open').map((f) => ({ key: `m:${f.id}`, qid: f.qid, text: `${f.reason}${f.decider ? ` — يحسمه: ${f.decider}` : ''}${f.opinions ? ` — الآراء: ${f.opinions}` : ''}`, manual: f })),
    ...g.allFlags.filter((f) => f.status === 'open').map((f) => ({ key: f.key, qid: f.qid, text: f.text, auto: f })),
  ];
  const resolved = ws.flags.filter((f) => f.status !== 'open').length + g.allFlags.filter((f) => f.status !== 'open').length;
  const sectionOf = (qid: string) => {
    const q = bank.questionById.get(qid);
    if (!q) return undefined;
    return [q.section, ...(q.alsoIn || [])].find((s) => g.d.visibleSections.has(s)) || q.section;
  };

  const resolve = (f: AnyFlag, mode: 'answered' | 'assumed') => {
    const line = (how[f.key] || '').trim();
    if (!line) { toast('اكتبوا سطر «كيف حُسم الأمر» أولاً.', 'error'); return; }
    if (f.manual) {
      mutate((w, b) => {
        let next = resolveManualFlag(w, f.manual!.id, mode, line);
        if (mode === 'assumed' && b.questionById.has(f.qid) && !g.d.isAnswered(f.qid)) next = applyRecommended(b, next, [f.qid], 'flag_recommended');
        return next;
      });
    } else if (f.auto) {
      const val = f.auto.kind === 'missing_slot' ? (slotVal[f.key] || '').trim() : undefined;
      if (f.auto.kind === 'missing_slot' && !val) { toast('اكتبوا القيمة التي حُسمت لهذه الخانة.', 'error'); return; }
      mutate((w, b) => {
        let next = resolveAutoFlag(w, f.key, f.auto!.kind === 'missing_slot' ? 'assumed' : mode, line, val);
        if (mode === 'assumed' && f.auto!.kind !== 'missing_slot' && b.questionById.has(f.qid) && (!g.d.isAnswered(f.qid) || f.auto!.kind === 'dont_know')) next = applyRecommended(b, next, [f.qid], 'flag_recommended');
        return next;
      });
    }
  };

  const allUnanswered = g.unanswered.flatMap((u) => u.qids);
  const sectionsPct = bank.sections.filter((s) => g.d.visibleSections.has(s.id)).map((s) => {
    const qs = (bank.questionsBySection.get(s.id) || []).filter((q) => g.d.visibleQuestions.has(q.id) && !/-099$/.test(q.id));
    const a = qs.filter((q) => st.d!.isAnswered(q.id)).length;
    return { id: s.id, title: s.title, pct: qs.length ? Math.round((100 * a) / qs.length) : 100 };
  });

  const doExport = async (kind: 'md' | 'docx') => {
    setBusy(true);
    try {
      const doc = buildDocument(g);
      if (kind === 'md') download(`${doc.fileBase}.md`, toMarkdown(doc), 'text/markdown;charset=utf-8');
      else {
        const { toDocx } = await import('../engine/export-docx');
        download(`${doc.fileBase}.docx`, await toDocx(doc));
      }
      toast('نُزّلت الوثيقة. تذكّروا تصدير ملف التقدّم أيضاً.');
    } catch {
      toast('تعذّر إنشاء الملف.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const gateOpen = open.length === 0;

  return (
    <main id="main" class="review" tabIndex={-1}>
      <div class="review-head">
        <h1>مراجعة ما قبل التصدير</h1>
        <button type="button" class="btn ghost" onClick={() => setState({ screen: 'workspace' })}>العودة إلى الورشة</button>
      </div>

      <section class="card" aria-labelledby="sum-title">
        <h2 id="sum-title">الملخص</h2>
        <ul class="stats">
          <li>الأسئلة المُجابة: <strong>{Object.keys(ws.answers).filter((q) => g.d.visibleQuestions.has(q)).length}</strong></li>
          <li>الافتراضات المُعلنة: <strong>{g.assumptions.length}</strong></li>
          <li>البنود المحسومة بعد خلاف: <strong>{resolved}</strong></li>
          <li>المتطلبات المولّدة: <strong>{g.requirements.length}</strong> — القواعد القياسية المطبّقة: <strong>{g.rules.length}</strong></li>
        </ul>
        <table class="pct-table">
          <caption>نسبة اكتمال كل قسم</caption>
          <thead><tr><th scope="col">القسم</th><th scope="col">الاكتمال</th></tr></thead>
          <tbody>{sectionsPct.map((s) => <tr key={s.id}><td>{s.title}</td><td>{s.pct}%</td></tr>)}</tbody>
        </table>
      </section>

      <section class="card" aria-labelledby="flags-title">
        <h2 id="flags-title">العلامات المفتوحة ({open.length})</h2>
        {!open.length && <p class="ok">لا علامات مفتوحة.</p>}
        <ul class="review-flags">
          {open.map((f) => (
            <li key={f.key} class="flag open">
              <p><span class="qid" dir="ltr">{f.qid || '—'}</span> <RichText text={f.text} /></p>
              {f.auto?.kind === 'missing_slot' && (
                <>
                  <label for={`slot-${f.key}`}>القيمة التي حُسمت لهذه الخانة</label>
                  <input id={`slot-${f.key}`} maxLength={500} value={slotVal[f.key] || ''} onInput={(e) => setSlotVal({ ...slotVal, [f.key]: (e.target as HTMLInputElement).value })} />
                </>
              )}
              <label for={`how-${f.key}`}>كيف حُسم الأمر</label>
              <input id={`how-${f.key}`} maxLength={500} value={how[f.key] || ''} onInput={(e) => setHow({ ...how, [f.key]: (e.target as HTMLInputElement).value })} />
              <div class="row-actions">
                {f.qid && bank.questionById.has(f.qid) && (
                  <button type="button" class="btn secondary small" onClick={() => goSection(sectionOf(f.qid)!, f.qid)}>اختيار إجابة الآن</button>
                )}
                {f.auto?.kind !== 'missing_slot' && <button type="button" class="btn secondary small" onClick={() => resolve(f, 'answered')}>حُسم بإجابة</button>}
                <button type="button" class="btn secondary small" onClick={() => resolve(f, 'assumed')}>{f.auto?.kind === 'missing_slot' ? 'اعتماد القيمة افتراضاً مُعلناً' : 'قبول الموصى به افتراضاً مُعلناً'}</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section class="card" aria-labelledby="un-title">
        <h2 id="un-title">الأسئلة غير المُجابة ({allUnanswered.length})</h2>
        {allUnanswered.length > 0 && (
          <button type="button" class="btn secondary" onClick={() => mutate((w, b) => applyRecommended(b, w, allUnanswered, 'unanswered'))}>طبّق الموصى به على الكل</button>
        )}
        {g.unanswered.map((u) => (
          <details key={u.section}>
            <summary>{bank.sectionById.get(u.section)?.title || u.section} ({u.qids.length})</summary>
            <button type="button" class="btn ghost small" onClick={() => mutate((w, b) => applyRecommended(b, w, u.qids, 'unanswered'))}>طبّق الموصى به على هذا القسم</button>
            <ul>
              {u.qids.map((qid) => (
                <li key={qid}>
                  <button type="button" class="link" onClick={() => goSection(u.section, qid)}><span class="qid" dir="ltr">{qid}</span> {bank.questionById.get(qid)?.title}</button>
                </li>
              ))}
            </ul>
          </details>
        ))}
        <p class="hint">ما لم يُجب عنه يدخل الوثيقة بالموصى به ويُسجَّل في سجل الافتراضات بسبب «لم يُجب».</p>
      </section>

      <section class="card" aria-labelledby="as-title">
        <h2 id="as-title">ملخص الافتراضات ({g.assumptions.length})</h2>
        <details>
          <summary>عرض الجدول</summary>
          <table>
            <thead><tr><th scope="col">السؤال</th><th scope="col">القيمة المفترضة</th><th scope="col">السبب</th></tr></thead>
            <tbody>{g.assumptions.map((a, i) => <tr key={i}><td dir="ltr">{a.question}</td><td>{a.value}</td><td>{a.reasonText}</td></tr>)}</tbody>
          </table>
        </details>
      </section>

      <section class="card" aria-labelledby="ex-title">
        <h2 id="ex-title">التصدير</h2>
        {!gateOpen && <p class="notice warn" role="status">التصدير متاح بعد حسم كل العلامات المفتوحة ({open.length}).</p>}
        <div class="row-actions">
          <button type="button" class="btn secondary" onClick={() => setPreview(true)}>معاينة الوثيقة</button>
          <button type="button" class="btn primary" disabled={!gateOpen} aria-disabled={!gateOpen} onClick={() => setExportOpen(true)}>تصدير الوثيقة</button>
        </div>
      </section>

      <Dialog open={preview} title="معاينة الوثيقة" wide onClose={() => setPreview(false)}>
        {preview && <DocPreview doc={buildDocument(g)} />}
      </Dialog>

      <Dialog open={exportOpen} title="تصدير وثيقة المتطلبات" onClose={() => setExportOpen(false)}>
        <PrivacyNotice />
        <p>المحتوى متطابق في الصيغتين؛ والفرق في التنسيق فقط.</p>
        <div class="row-actions">
          <button type="button" class="btn primary" disabled={busy} onClick={() => doExport('docx')}>Word (.docx)</button>
          <button type="button" class="btn primary" disabled={busy} onClick={() => doExport('md')}>Markdown (.md)</button>
        </div>
        <p class="notice info">تذكير: صدّروا ملف التقدّم أيضاً واحفظوه في مكان آمن.</p>
        <button type="button" class="btn secondary" onClick={() => exportProgressFile(st)}>صدّر ملف التقدّم</button>
      </Dialog>
    </main>
  );
}
