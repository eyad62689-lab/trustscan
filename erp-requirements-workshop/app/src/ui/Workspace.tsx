import { useEffect, useState } from 'preact/hooks';
import type { AppState } from './store';
import { setState, goSection, closeWorkshop, mutate, markExported, toast } from './store';
import { SectionView } from './SectionView';
import { SessionDialog } from './SessionDialog';
import { Dialog, download, RichText } from './common';
import { PathCard } from './PathCard';
import { planPath, completion } from '../engine/time';
import { formatMinutes } from '../engine/format';
import { searchQuestions } from '../engine/search';
import { currentSession, endSession } from '../engine/workshop';
import { exportProgress } from '../engine/progress';

export async function exportProgressFile(st: AppState) {
  if (!st.ws || !st.bank) return;
  const f = await exportProgress(st.ws, st.bank);
  download(f.name, f.text, 'application/json');
  markExported();
  toast('صُدّر ملف التقدّم. احفظوه في مكان آمن؛ فيه معلومات حساسة عن المنشأة.');
}

function sectionStatus(st: AppState, sid: string): { label: string; cls: string } {
  const d = st.d!;
  const ws = st.ws!;
  const qs = (d.bank.questionsBySection.get(sid) || []).filter((q) => d.visibleQuestions.has(q.id));
  const flagged = ws.flags.some((f) => f.status === 'open' && qs.some((q) => q.id === f.qid)) || d.autoFlags.some((f) => f.status === 'open' && qs.some((q) => q.id === f.qid));
  if (flagged) return { label: 'فيه بنود تحتاج حسماً', cls: 'st-flag' };
  if (ws.completedSections.includes(sid)) return { label: 'مكتمل', cls: 'st-done' };
  if (qs.some((q) => d.isAnswered(q.id))) return { label: 'جارٍ', cls: 'st-progress' };
  return { label: 'لم يبدأ', cls: 'st-new' };
}

function SaveIndicator(props: { st: AppState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const s = props.st.save;
  if (!s.ok) return <p class="save err" role="alert">{s.error} <button type="button" class="btn small" onClick={() => exportProgressFile(props.st)}>صدّر ملف التقدّم</button></p>;
  const secs = s.at ? Math.max(0, Math.round((Date.now() - s.at) / 1000)) : null;
  return (
    <p class="save ok" aria-live="polite">
      <span aria-hidden="true">✓ </span>محفوظ على هذا الجهاز{secs !== null ? ` — قبل ${secs < 5 ? 'ثوانٍ' : secs < 60 ? `${secs} ثانية` : `${Math.round(secs / 60)} دقيقة`}` : ''}
    </p>
  );
}

export function Workspace(props: { st: AppState }) {
  const { st } = props;
  const d = st.d!;
  const ws = st.ws!;
  const bank = d.bank;
  const visible = bank.sections.filter((s) => d.visibleSections.has(s.id));
  const section = visible.find((s) => s.id === st.sectionId) || visible[0];
  const [sessionOpen, setSessionOpen] = useState(!currentSession(ws));
  const [pathOpen, setPathOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const plan = planPath(d);
  const pct = completion(d);

  useEffect(() => {
    if (!st.focusQid) window.scrollTo({ top: 0 });
  }, [section?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && st.presentation) exitPresentation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.presentation]);

  const enterPresentation = () => {
    setState({ presentation: true });
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitPresentation = () => {
    setState({ presentation: false });
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  };

  const results = searchOpen ? searchQuestions(d, query) : [];
  const sess = currentSession(ws);

  return (
    <div class={`workspace${st.presentation ? ' presentation' : ''}${st.guideOpen ? ' with-guide' : ''}`}>
      <header class="topbar">
        <div class="topbar-row">
          <strong class="entity">{ws.entityName || 'ورشة بلا اسم'}</strong>
          <div class="progress" role="group" aria-label="التقدم العام">
            <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="نسبة الأسئلة الأساسية المُجابة">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span>{pct}% — المتبقي التقديري: {formatMinutes(plan.remaining)}</span>
          </div>
          <SaveIndicator st={st} />
        </div>
        {!st.presentation ? (
          <nav class="toolbar" aria-label="أدوات الورشة">
            <button type="button" class="btn ghost" onClick={() => setPathOpen(true)}>مساركم</button>
            <button type="button" class="btn ghost" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>بحث</button>
            <button type="button" class="btn ghost" aria-expanded={st.guideOpen} onClick={() => setState({ guideOpen: !st.guideOpen })}>دليل الميسّر</button>
            <button type="button" class="btn ghost" onClick={enterPresentation}>وضع العرض</button>
            <button type="button" class="btn ghost" onClick={() => exportProgressFile(st)}>صدّر ملف التقدّم</button>
            {sess ? (
              <button type="button" class="btn ghost" onClick={() => { mutate((w) => endSession(w)); toast('انتهت الجلسة. يُقترح تصدير ملف التقدّم الآن.'); exportProgressFile(st); }}>أنهِ الجلسة</button>
            ) : (
              <button type="button" class="btn ghost" onClick={() => setSessionOpen(true)}>ابدأ جلسة</button>
            )}
            <button type="button" class="btn primary" onClick={() => setState({ screen: 'review' })}>المراجعة والتصدير</button>
            <button type="button" class="btn ghost" onClick={() => closeWorkshop()}>الورش</button>
          </nav>
        ) : (
          <nav class="toolbar" aria-label="وضع العرض">
            <button type="button" class="btn ghost" onClick={exitPresentation}>الخروج من وضع العرض</button>
          </nav>
        )}
        {searchOpen && !st.presentation && (
          <div class="search" role="search">
            <label for="q-search">ابحث في الأسئلة</label>
            <input id="q-search" type="search" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-describedby="q-search-count" />
            <p id="q-search-count" class="sr-only" aria-live="polite">{query.length >= 2 ? `${results.length} نتيجة` : ''}</p>
            <ul class="search-results">
              {results.map((r) => (
                <li key={r.qid}>
                  <button type="button" class="link" onClick={() => { goSection(r.section, r.qid); setSearchOpen(false); }}>
                    <span dir="ltr" class="qid">{r.qid}</span> {r.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>
      <div class="ws-body">
        {!st.presentation && (
          <nav class="sidenav" aria-label="الأقسام">
            <label for="sec-select" class="sr-only">القسم</label>
            <select id="sec-select" class="sec-select" value={section?.id} onChange={(e) => goSection((e.target as HTMLSelectElement).value)}>
              {visible.map((s) => <option key={s.id} value={s.id}>{s.title} — {sectionStatus(st, s.id).label}</option>)}
            </select>
            <ol class="sec-list">
              {visible.map((s) => {
                const stt = sectionStatus(st, s.id);
                const p = plan.sections.find((x) => x.id === s.id);
                return (
                  <li key={s.id}>
                    <button type="button" class={`sec-item ${stt.cls}`} aria-current={s.id === section?.id ? 'page' : undefined} onClick={() => goSection(s.id)}>
                      <span class="sec-name">{s.title}</span>
                      <span class="sec-meta"><span class="dot" aria-hidden="true" /> {stt.label}{p ? ` · ${formatMinutes(p.minutes)}` : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <main id="main" class="ws-main" tabIndex={-1}>
          {st.demo && <p class="notice warn">بيانات تجريبية: لم تُضمَّن ملفات البنك في هذا البناء.</p>}
          {ws.importReport && !st.presentation && ws.importReport.archived.length + ws.importReport.newQuestions.length + ws.importReport.roleMappings.length > 0 && (
            <details class="notice info">
              <summary>تقرير الاستيراد (البنك {ws.importReport.fromBankVersion} ← {ws.importReport.toBankVersion})</summary>
              <p>أسئلة جديدة: {ws.importReport.newQuestions.length}. إجابات مؤرشفة لأسئلة حُذفت: {ws.importReport.archived.map((a) => a.qid).join('، ') || 'لا شيء'}.</p>
              {ws.importReport.roleMappings.length > 0 && <p>مطابقة أسماء أدوار: {ws.importReport.roleMappings.map((m) => `${m.from} ← ${m.to}`).join('، ')}</p>}
            </details>
          )}
          {section && <SectionView section={section} d={d} focusQid={st.focusQid} presentation={st.presentation} />}
        </main>
        {st.guideOpen && !st.presentation && <GuidePanel st={st} />}
      </div>
      <SessionDialog open={sessionOpen} onClose={() => setSessionOpen(false)} ws={ws} />
      <Dialog open={pathOpen} title="مساركم" onClose={() => setPathOpen(false)}>
        <PathCard d={d} />
      </Dialog>
    </div>
  );
}

function GuidePanel(props: { st: AppState }) {
  const guide = props.st.bank!.exportSpec.guide;
  return (
    <aside class="guide" aria-labelledby="guide-title">
      <div class="guide-head">
        <h2 id="guide-title">دليل الميسّر</h2>
        <button type="button" class="btn ghost" aria-label="إغلاق الدليل" onClick={() => setState({ guideOpen: false })}>✕</button>
      </div>
      {!guide.length && <p class="hint">لا يتضمن البنك نص الدليل.</p>}
      {guide.map((g, i) => (
        <section key={i}>
          {g.title && <h3>{g.title}</h3>}
          {g.body.split('\n').map((line, j) => <p key={j}><RichText text={line.replace(/^- /, '• ')} /></p>)}
        </section>
      ))}
    </aside>
  );
}
