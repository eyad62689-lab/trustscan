import { useState } from 'preact/hooks';
import { Dialog, PrivacyNotice } from './common';
import { mutate } from './store';
import { startSession, uid } from '../engine/workshop';
import type { Attendee, Workshop } from '../engine/types';
import { isoDate } from '../engine/format';

export function SessionDialog(props: { open: boolean; onClose: () => void; ws: Workshop }) {
  const prev = props.ws.sessions[props.ws.sessions.length - 1];
  const [facilitator, setFacilitator] = useState(prev?.facilitator || '');
  const [rows, setRows] = useState<Attendee[]>(prev?.attendees?.length ? prev.attendees.map((a) => ({ ...a })) : [{ id: uid(), role: '', name: '' }]);
  const upd = (i: number, k: 'role' | 'name', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Dialog open={props.open} title="بدء جلسة" onClose={props.onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          const att = rows.filter((r) => r.role.trim()).map((r) => ({ id: r.id, role: r.role.trim(), name: r.name?.trim() || undefined }));
          if (!facilitator.trim()) { e.preventDefault(); return; }
          mutate((w) => startSession(w, facilitator.trim(), att));
        }}
      >
        <p>التاريخ: <strong>{isoDate(new Date())}</strong> (يُسجَّل تلقائياً)</p>
        <label for="sess-fac">اسم الميسّر (إلزامي)</label>
        <input id="sess-fac" required maxLength={120} value={facilitator} onInput={(e) => setFacilitator((e.target as HTMLInputElement).value)} />
        <fieldset>
          <legend>الحضور — الصفة إلزامية والاسم اختياري</legend>
          {rows.map((r, i) => (
            <div class="inline-form" key={r.id}>
              <label for={`att-role-${i}`}>الصفة</label>
              <input id={`att-role-${i}`} maxLength={120} value={r.role} onInput={(e) => upd(i, 'role', (e.target as HTMLInputElement).value)} />
              <label for={`att-name-${i}`}>الاسم</label>
              <input id={`att-name-${i}`} maxLength={120} value={r.name || ''} onInput={(e) => upd(i, 'name', (e.target as HTMLInputElement).value)} />
              <button type="button" class="btn ghost small" aria-label={`حذف الحاضر ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>حذف</button>
            </div>
          ))}
          <button type="button" class="btn secondary" onClick={() => setRows([...rows, { id: uid(), role: '', name: '' }])}>+ حاضر</button>
        </fieldset>
        <p class="hint">لا يُطلب رقم هوية ولا جوال ولا بريد لأي شخص.</p>
        <PrivacyNotice />
        <div class="dialog-actions">
          <button type="submit" class="btn primary">ابدأ الجلسة</button>
        </div>
      </form>
    </Dialog>
  );
}
