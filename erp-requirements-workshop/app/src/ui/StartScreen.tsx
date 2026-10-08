import { useState } from 'preact/hooks';
import type { AppState } from './store';
import { openWorkshop, loadStored, removeStored, saveImported, toast } from './store';
import { Dialog, PrivacyNotice, download } from './common';
import { newWorkshop, setPart } from '../engine/workshop';
import { importProgress, asSeparateCopy, exportProgress, ProgressError } from '../engine/progress';
import { displayDateTime } from '../engine/format';
import type { Workshop } from '../engine/types';

export function StartScreen(props: { st: AppState }) {
  const { st } = props;
  const bank = st.bank!;
  const [name, setName] = useState('');
  const [del, setDel] = useState<{ id: string; name: string; exportFirst: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const [conflict, setConflict] = useState<Workshop | null>(null);
  const [importErr, setImportErr] = useState('');

  const reviewDate = bank.reviewDate || bank.date;
  const ageDays = reviewDate ? Math.floor((Date.now() - new Date(reviewDate).getTime()) / 86400000) : null;

  const create = () => {
    let ws = newWorkshop(bank, name.trim());
    if (name.trim() && bank.questionById.has('PRF-001')) ws = setPart(bank, ws, 'PRF-001', bank.questionById.get('PRF-001')!.parts[0].key, name.trim());
    ws = { ...ws, entityName: name.trim() };
    openWorkshop(ws);
  };

  const exportOne = async (id: string) => {
    const ws = loadStored(id);
    if (!ws) return;
    const f = await exportProgress(ws, bank);
    download(f.name, f.text, 'application/json');
  };

  const onImport = async (file: File) => {
    setImportErr('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new ProgressError('حجم الملف يتجاوز 10 ميجابايت');
      const text = await file.text();
      const { workshop, report } = await importProgress(text, bank);
      const same = st.list.find((x) => x.entityName === workshop.entityName || x.id === workshop.id);
      if (same) { setConflict(workshop); return; }
      saveImported(workshop);
      openWorkshop(workshop);
      if (report) toast(`استُورد الملف. ${report.newQuestions.length} سؤالاً جديداً، و${report.archived.length} إجابة مؤرشفة.`);
    } catch (e) {
      setImportErr(e instanceof ProgressError ? e.message : 'تعذّر قراءة الملف. تأكدوا أنه ملف تقدّم صادر من هذا التطبيق.');
    }
  };

  return (
    <main id="main" class="start" tabIndex={-1}>
      <h1>ورشة المتطلبات</h1>
      <p class="lead">جمع متطلبات نظام إدارة المنشأة في ورشة، وتصدير وثيقة متطلبات جاهزة للمنفّذ.</p>
      {st.demo && <p class="notice warn">بيانات تجريبية: لم تُضمَّن ملفات البنك في هذا البناء.</p>}
      <PrivacyNotice />
      {!st.storageOk && <p class="notice error" role="alert">لا يتيح هذا المتصفح الحفظ على الجهاز (ربما التصفح الخاص). ستعمل الورشة، لكن صدّروا ملف التقدّم باستمرار.</p>}
      {ageDays !== null && ageDays > 180 && (
        <p class="notice warn" role="status">مضى على آخر مراجعة نظامية لبنك الأسئلة ({reviewDate}) أكثر من 180 يوماً. تحقّقوا من البنود النظامية قبل الاعتماد عليها.</p>
      )}
      <p class="hint">إصدار بنك الأسئلة: <span dir="ltr">{bank.version}</span>{reviewDate ? ` — تاريخه ${reviewDate}` : ''}</p>

      <section class="card" aria-labelledby="new-title">
        <h2 id="new-title">ابدأ ورشة جديدة</h2>
        <form class="inline-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <label for="entity-name">اسم الكيان</label>
          <input id="entity-name" maxLength={200} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button type="submit" class="btn primary">ابدأ ورشة جديدة</button>
        </form>
      </section>

      <section class="card" aria-labelledby="list-title">
        <h2 id="list-title">الورش المحفوظة على هذا الجهاز</h2>
        {!st.list.length && <p class="hint">لا ورش محفوظة بعد.</p>}
        {st.list.length > 0 && (
          <table class="ws-table">
            <thead><tr><th scope="col">اسم الكيان</th><th scope="col">آخر تعديل</th><th scope="col">الاكتمال</th><th scope="col"><span class="sr-only">إجراءات</span></th></tr></thead>
            <tbody>
              {st.list.map((w) => (
                <tr key={w.id}>
                  <td data-label="اسم الكيان">{w.entityName || 'بلا اسم'}</td>
                  <td data-label="آخر تعديل">{displayDateTime(w.updatedAt)}</td>
                  <td data-label="الاكتمال">{w.completion}%</td>
                  <td class="actions">
                    <button type="button" class="btn primary small" onClick={() => { const ws = loadStored(w.id); if (ws) openWorkshop(ws); else toast('تعذّر فتح الورشة.', 'error'); }}>استكمل من حيث توقفتم</button>
                    <button type="button" class="btn secondary small" onClick={() => exportOne(w.id)}>صدّر ملف التقدّم</button>
                    <button type="button" class="btn ghost small" onClick={() => { setTyped(''); setDel({ id: w.id, name: w.entityName, exportFirst: false }); }}>احذف</button>
                    <button type="button" class="btn ghost small" onClick={() => { setTyped(''); setDel({ id: w.id, name: w.entityName, exportFirst: true }); }}>صدّر ثم احذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card" aria-labelledby="import-title">
        <h2 id="import-title">استيراد ملف تقدّم</h2>
        <label for="import-file">اختر ملف التقدّم (JSON)</label>
        <input id="import-file" type="file" accept="application/json,.json" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onImport(f); (e.target as HTMLInputElement).value = ''; }} />
        {importErr && <p class="notice error" role="alert">رُفض الملف: {importErr}</p>}
      </section>

      <Dialog open={!!del} title={del?.exportFirst ? 'صدّر ملف التقدّم ثم احذف من هذا الجهاز' : 'حذف الورشة'} onClose={() => setDel(null)}>
        {del && (
          <form method="dialog" onSubmit={async (e) => {
            if (typed !== (del.name || '')) { e.preventDefault(); return; }
            if (del.exportFirst) await exportOne(del.id);
            removeStored(del.id);
            toast('حُذفت الورشة من هذا الجهاز.');
          }}>
            <p>لا يمكن التراجع عن الحذف. للتأكيد اكتبوا اسم الكيان كما هو: <strong>{del.name || '(فارغ)'}</strong></p>
            <label for="del-confirm">اسم الكيان</label>
            <input id="del-confirm" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
            <div class="dialog-actions">
              <button type="submit" class="btn danger" disabled={typed !== (del.name || '')}>{del.exportFirst ? 'صدّر ثم احذف' : 'احذف نهائياً'}</button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog open={!!conflict} title="توجد ورشة بالاسم نفسه" onClose={() => setConflict(null)}>
        {conflict && (
          <form method="dialog">
            <p>توجد على هذا الجهاز ورشة باسم «{conflict.entityName}». ماذا تريدون؟</p>
            <div class="dialog-actions">
              <button type="submit" class="btn primary" onClick={() => {
                const same = st.list.find((x) => x.entityName === conflict.entityName || x.id === conflict.id);
                if (same) removeStored(same.id);
                saveImported(conflict); openWorkshop(conflict);
              }}>استبدال</button>
              <button type="submit" class="btn secondary" onClick={() => { const c = asSeparateCopy(conflict); saveImported(c); openWorkshop(c); }}>فتح نسخة منفصلة</button>
            </div>
          </form>
        )}
      </Dialog>
    </main>
  );
}
