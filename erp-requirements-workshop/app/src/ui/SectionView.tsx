import { useState } from 'preact/hooks';
import type { Section } from '../engine/types';
import type { Derived } from '../engine/compute';
import { mutate, toast, setState } from './store';
import { QuestionCard } from './QuestionCard';
import { RichText } from './common';
import { applyRecommended, bulkCandidates, completeSection, reopenSection, setAttendance, setSectionNote, currentSession, uid } from '../engine/workshop';
import { normAr } from '../engine/normalize';
import { isoDate, formatMinutes } from '../engine/format';
import { planPath, sectionMinutes } from '../engine/time';
import { PathCard } from './PathCard';

export function SectionView(props: { section: Section; d: Derived; focusQid?: string; presentation: boolean }) {
  const { section: s, d } = props;
  const ws = d.ws;
  const qs = (d.bank.questionsBySection.get(s.id) || []).filter((q) => d.visibleQuestions.has(q.id) && (q.section === s.id || !d.visibleSections.has(q.section)));
  const done = ws.completedSections.includes(s.id);
  const sess = currentSession(ws);
  const people = [...(sess?.attendees || []), ...ws.extraAttendees.filter((x) => !(sess?.attendees || []).some((a) => a.id === x.id))];
  const present = ws.sectionAttendance[s.id] || [];
  const mandatory = s.opening?.mandatory || [];
  const missingMandatory = mandatory.filter((m) => {
    const presentRoles = people.filter((p) => present.includes(p.id)).map((p) => normAr(p.role));
    const nm = normAr(m);
    return !presentRoles.some((r) => r && (nm.includes(r) || r.includes(nm) || nm.split(' أو ').some((x) => x.includes(r) || r.includes(x))));
  });
  const bulk = bulkCandidates(d.bank, ws, s.id);
  const [newRole, setNewRole] = useState('');
  const [newName, setNewName] = useState('');
  const note = (ws.sectionNotes[s.id] || []).find((n) => n.sessionId === sess?.id)?.text || '';
  const plan = planPath(d);
  const remaining = plan.remaining;
  const absentText = d.bank.exportSpec.texts.mandatoryAbsentNotice;

  return (
    <section class="section-view" aria-labelledby="section-title">
      <h2 id="section-title" class="section-title">{s.title} <span class="qid" dir="ltr">{s.id}</span></h2>
      {!props.presentation && s.opening && (
        <div class="opening card">
          <h3>بطاقة افتتاح القسم</h3>
          {s.opening.attendees && <p><strong>الحضور المقترح: </strong><RichText text={s.opening.attendees} />{mandatory.length ? <> — <strong>إلزامي: </strong>{mandatory.join('، ')}</> : null}</p>}
          <p><strong>المدة التقديرية: </strong>{s.opening.duration || formatMinutes(sectionMinutes(d.bank, s))} — <strong>المتبقي للورشة كلها: </strong>{formatMinutes(remaining)}</p>
          {s.opening.discussion?.length ? (
            <>
              <p><strong>محاور النقاش (تُقرأ بصوت مسموع):</strong></p>
              <ol>{s.opening.discussion.map((x, i) => <li key={i}><RichText text={x} /></li>)}</ol>
            </>
          ) : null}
          {s.opening.notice && <p class="notice info"><RichText text={s.opening.notice} /></p>}
          <fieldset class="attendance">
            <legend>حضور القسم</legend>
            {!people.length && <p class="hint">لا حضور مسجّلاً في الجلسة الحالية. ابدأ جلسة أو أضف شخصاً.</p>}
            {people.map((p) => (
              <label class="chip" key={p.id}>
                <input type="checkbox" checked={present.includes(p.id)} onChange={(e) => mutate((w) => setAttendance(w, s.id, (e.target as HTMLInputElement).checked ? [...present, p.id] : present.filter((x) => x !== p.id)))} />
                {p.name ? `${p.name} (${p.role})` : p.role}
              </label>
            ))}
            <div class="inline-form">
              <label for={`add-role-${s.id}`}>إضافة حاضر — الصفة</label>
              <input id={`add-role-${s.id}`} value={newRole} maxLength={120} onInput={(e) => setNewRole((e.target as HTMLInputElement).value)} />
              <label for={`add-name-${s.id}`}>الاسم (اختياري)</label>
              <input id={`add-name-${s.id}`} value={newName} maxLength={120} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
              <button type="button" class="btn secondary" disabled={!newRole.trim()} onClick={() => {
                const p = { id: uid(), role: newRole.trim(), name: newName.trim() || undefined };
                mutate((w) => setAttendance({ ...w, extraAttendees: [...w.extraAttendees, p] }, s.id, [...present, p.id]));
                setNewRole(''); setNewName('');
              }}>أضف</button>
            </div>
          </fieldset>
          {missingMandatory.length > 0 && (
            <p class="notice warn" role="status">
              {absentText ? absentText.replace('أمين المستودع', missingMandatory.join('، ')) : `يُنصح بحضور ${missingMandatory.join('، ')} لهذا القسم. هل تريدون المتابعة أم تأجيل القسم؟`} (المتابعة متاحة دائماً)
            </p>
          )}
        </div>
      )}
      {s.kind === 'scope' && <PathCard d={d} />}
      {qs.map((q, i) => (
        <QuestionCard key={q.id} q={q} d={d} index={i + 1} total={qs.length} focus={props.focusQid === q.id} presentation={props.presentation} />
      ))}
      {!qs.length && <p class="hint">لا أسئلة ظاهرة في هذا القسم بحسب الإجابات الحالية.</p>}
      <div class="section-end card">
        {bulk.length > 0 && (
          <button type="button" class="btn secondary" onClick={() => { mutate((w, b) => applyRecommended(b, w, bulk, 'bulk_section')); toast(`طُبّق الموصى به على ${bulk.length} من الأسئلة التفصيلية، وسُجّل كل منها افتراضاً مُعلناً.`); }}>
            قبول الموصى به لباقي أسئلة هذا القسم ({bulk.length})
          </button>
        )}
        {!props.presentation && (
          <div class="notes">
            <label for={`notes-${s.id}`}>ملاحظات النقاش {sess ? `(جلسة ${isoDate(sess.start)})` : ''}</label>
            <textarea id={`notes-${s.id}`} rows={3} maxLength={10000} value={note} onInput={(e) => mutate((w) => setSectionNote(w, s.id, (e.target as HTMLTextAreaElement).value, isoDate(sess?.start || new Date())))} />
          </div>
        )}
        {done ? (
          <button type="button" class="btn ghost" onClick={() => mutate((w) => reopenSection(w, s.id))}>إعادة فتح القسم</button>
        ) : (
          <button type="button" class="btn primary" onClick={() => {
            mutate((w, b) => completeSection(b, w, s.id));
            const visible = d.bank.sections.filter((x) => d.visibleSections.has(x.id));
            const idx = visible.findIndex((x) => x.id === s.id);
            const next = visible[idx + 1];
            if (next) setState({ sectionId: next.id, focusQid: undefined });
            toast(`اكتمل قسم «${s.title}».`);
          }}>أكملنا هذا القسم</button>
        )}
      </div>
    </section>
  );
}
