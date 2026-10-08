import { useState, useEffect, useRef } from 'preact/hooks';
import type { Question, Part } from '../engine/types';
import type { Derived } from '../engine/compute';
import { isEmpty } from '../engine/compute';
import { formatPartValue } from '../engine/slots';
import { mutate } from './store';
import { setPart, setDontKnow, addFlag, setComment, confirmList, resolveManualFlag } from '../engine/workshop';
import { SingleField, MultiField, NumberField, TextField, ListField, ApprovalRowField, LogoField } from './fields';
import { Dialog, RichText } from './common';
import { SOURCE_LABEL } from '../engine/generate';

export function QuestionCard(props: { q: Question; d: Derived; index: number; total: number; focus?: boolean; presentation: boolean }) {
  const { q, d } = props;
  const ws = d.ws;
  const a = ws.answers[q.id];
  const [flagOpen, setFlagOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(!!ws.comments[q.id]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.focus && ref.current) {
      ref.current.scrollIntoView({ block: 'start' });
      ref.current.focus({ preventScroll: true });
    }
  }, [props.focus]);

  const parts = q.parts.filter((p) => d.visibleParts.has(`${q.id}#${p.key}`));
  const main = parts[0];
  const rec = main ? d.rec(q, main) : { value: undefined };
  const isNew = ws.newQuestions.includes(q.id);
  const flags = ws.flags.filter((f) => f.qid === q.id);
  const openManual = flags.filter((f) => f.status === 'open');
  const auto = d.autoFlags.filter((f) => f.qid === q.id);
  const notes = d.notes.filter((n) => n.target && String(n.target).split('#')[0] === q.id && /تنبيه في الواجهة|يظهر تنبيه/.test(n.text));
  const answered = d.isAnswered(q.id);
  const dk = !!a?.dontKnow;
  const source = !answered ? null : a?.source === 'free_text' ? 'free_text' : d.isAssumed(q.id) ? 'assumption' : 'answer';
  const reviewDate = q.reviewDate || d.bank.reviewDate;
  const idBase = `q-${q.id.replace(/[^A-Za-z0-9-]/g, '_')}`;

  const field = (p: Part) => {
    const pid = `${idBase}-${p.key}`;
    const raw = a?.parts?.[p.key];
    const value = dk ? d.partValue(q, p) : raw;
    const r = d.rec(q, p).value;
    const common = {
      q, p, d, value, recommended: r, idBase: pid,
      otherText: a?.other?.[p.key],
      onChange: (v: any, other?: string) => mutate((w, b) => setPart(b, w, q.id, p.key, v, { otherText: other })),
    };
    switch (p.type) {
      case 'single': return <SingleField {...common} />;
      case 'multi': return <MultiField {...common} />;
      case 'multiPriority': return <MultiField {...common} priority />;
      case 'number': return <NumberField {...common} />;
      case 'longtext': return <TextField {...common} long />;
      case 'list': case 'matrix': return <ListField {...common} touched={!!a?.touched && !isEmpty(raw)} onConfirm={() => mutate((w, b) => confirmList(b, w, q.id, p.key))} />;
      case 'approvalRow': return <ApprovalRowField {...common} value={dk ? d.partValue(q, p) : raw ?? undefined} />;
      case 'logo': return <LogoField {...common} />;
      default: return <TextField {...common} />;
    }
  };

  const recText = (() => {
    if (!main) return '';
    if (rec.value === undefined || rec.value === null || (Array.isArray(rec.value) && !rec.value.length)) return '';
    if (main.type === 'list' || main.type === 'matrix') return '';
    return formatPartValue(d, q, main, rec.value);
  })();

  return (
    <article ref={ref} tabIndex={-1} class={`qcard${openManual.length || auto.some((f) => f.status === 'open') ? ' flagged' : ''}`} id={idBase} aria-labelledby={`${idBase}-title`}>
      <header class="qhead">
        <span class="qnum">{props.index} من {props.total}</span>
        <span class="qid" dir="ltr">{q.id}</span>
        <span class={`tag ${q.detail ? 'detail' : 'basic'}`}>{q.detail ? 'تفصيلي' : 'أساسي'}</span>
        {isNew && <span class="tag new">جديد</span>}
        {q.regulatory && <span class="tag reg">نظامي — آخر مراجعة: {reviewDate || 'لم تُحدَّد'}</span>}
        {source && <span class={`tag src-${source}`}>المصدر: {SOURCE_LABEL[source]}</span>}
      </header>
      <h3 id={`${idBase}-title`} class="qtitle">{q.title}</h3>
      {q.help && <p class="qhelp"><RichText text={q.help} /></p>}
      {q.workshopNote && !props.presentation && <p class="notice facilitator"><strong>للميسّر: </strong><RichText text={q.workshopNote} /></p>}
      {(rec.reason || recText || rec.text) && (
        <div class="rec-badge" role="note">
          <span class="rec-icon" aria-hidden="true">★</span>
          <strong>الموصى به{recText ? `: ${recText}` : ''}</strong>
          {rec.reason && <span class="rec-reason">السبب: <RichText text={rec.reason} /></span>}
          {!recText && rec.text && <span class="rec-reason"><RichText text={rec.text} /></span>}
        </div>
      )}
      {notes.map((n) => <p class="notice info" key={n.id}><RichText text={n.text} /></p>)}
      {dk && <p class="notice assumed" role="status">«لا أعلم»: طُبّق الموصى به ويُسجَّل افتراضاً مُعلناً.</p>}
      {parts.map((p) => (
        <fieldset class="part" key={p.key}>
          <legend id={`${idBase}-${p.key}-legend`} class={p.label ? '' : 'sr-only'}>{p.label || q.title}</legend>
          {field(p)}
        </fieldset>
      ))}
      <div class="qactions">
        <button type="button" class={`btn ${dk ? 'primary' : 'secondary'}`} aria-pressed={dk} onClick={() => mutate((w) => setDontKnow(w, q.id, !dk))}>
          لا أعلم — طبّق الموصى به
        </button>
        <button type="button" class="btn secondary" onClick={() => setFlagOpen(true)}>⚑ يحتاج حسماً</button>
        <button type="button" class="btn ghost" aria-expanded={commentOpen} aria-controls={`${idBase}-comment`} onClick={() => setCommentOpen(!commentOpen)}>💬 تعليق</button>
      </div>
      {commentOpen && (
        <div class="comment">
          <label for={`${idBase}-comment`}>تعليق على السؤال</label>
          <textarea id={`${idBase}-comment`} rows={2} maxLength={5000} value={ws.comments[q.id] || ''} onInput={(e) => mutate((w) => setComment(w, q.id, (e.target as HTMLTextAreaElement).value))} />
        </div>
      )}
      {(flags.length > 0 || auto.length > 0) && (
        <ul class="flag-list" aria-label="بنود تحتاج حسماً">
          {auto.map((f) => (
            <li key={f.key} class={`flag ${f.status}`}>
              <span class="flag-icon" aria-hidden="true">⚑</span> <strong>{f.status === 'open' ? 'يحتاج حسماً (تلقائي)' : 'حُسم'}:</strong> <RichText text={f.text} />
            </li>
          ))}
          {flags.map((f) => (
            <li key={f.id} class={`flag ${f.status}`}>
              <span class="flag-icon" aria-hidden="true">⚑</span> <strong>{f.status === 'open' ? 'يحتاج حسماً' : 'حُسم'}:</strong> {f.reason}
              {f.decider && <> — يحسمه: {f.decider}</>}
              {f.opinions && <> — الآراء: {f.opinions}</>}
              {f.status === 'open' && (
                <button type="button" class="btn ghost small" onClick={() => {
                  const how = prompt('كيف حُسم الأمر؟') || '';
                  if (how.trim()) mutate((w) => resolveManualFlag(w, f.id, 'answered', how.trim()));
                }}>حُسم بإجابة</button>
              )}
              {f.resolution && <> — {f.resolution}</>}
            </li>
          ))}
        </ul>
      )}
      <FlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} qid={q.id} />
    </article>
  );
}

function FlagDialog(props: { open: boolean; onClose: () => void; qid: string }) {
  const [reason, setReason] = useState('');
  const [decider, setDecider] = useState('');
  const [opinions, setOpinions] = useState('');
  return (
    <Dialog open={props.open} title={`يحتاج حسماً — ${props.qid}`} onClose={props.onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          if (!reason.trim()) { e.preventDefault(); return; }
          mutate((w) => addFlag(w, props.qid, reason.trim(), decider.trim() || undefined, opinions.trim() || undefined));
          setReason(''); setDecider(''); setOpinions('');
        }}
      >
        <label for="flag-reason">سبب الخلاف أو التردد (إلزامي)</label>
        <input id="flag-reason" required maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
        <label for="flag-decider">من سيحسمه (اسم أو صفة)</label>
        <input id="flag-decider" maxLength={200} value={decider} onInput={(e) => setDecider((e.target as HTMLInputElement).value)} />
        <label for="flag-opinions">الآراء المطروحة (اختياري)</label>
        <textarea id="flag-opinions" rows={3} maxLength={2000} value={opinions} onInput={(e) => setOpinions((e.target as HTMLTextAreaElement).value)} />
        <div class="dialog-actions">
          <button type="submit" class="btn primary">سجّل العلامة</button>
        </div>
      </form>
    </Dialog>
  );
}
