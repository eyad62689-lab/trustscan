import { useEffect } from 'preact/hooks';
import { useStore, setState, getState } from './store';
import { StartScreen } from './StartScreen';
import { Workspace } from './Workspace';
import { ReviewScreen } from './ReviewScreen';
import { loadBank } from '../bank/source';

export function App() {
  const st = useStore();
  useEffect(() => {
    loadBank()
      .then(({ bank, demo }) => setState({ bank, demo }))
      .catch(() => setState({ loadError: 'تعذّر تحميل بنك الأسئلة.' }));
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (getState().ws && getState().dirtySinceExport) {
        e.preventDefault();
        e.returnValue = 'لديكم تعديلات لم تُصدَّر في ملف تقدّم.';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <>
      <a class="skip-link" href="#main">انتقل إلى المحتوى</a>
      {st.loadError && <p class="notice error" role="alert">{st.loadError}</p>}
      {!st.bank && !st.loadError && <p class="loading" role="status">جارٍ تحميل بنك الأسئلة…</p>}
      {st.bank && (!st.ws || st.screen === 'start') && <StartScreen st={st} />}
      {st.bank && st.ws && st.screen === 'workspace' && <Workspace st={st} />}
      {st.bank && st.ws && (st.screen === 'review' || st.screen === 'export') && <ReviewScreen st={st} />}
      <div class="toasts" aria-live="polite" role="status">
        {st.toasts.map((t) => (
          <p key={t.id} class={`toast ${t.kind || 'info'}`} role={t.kind === 'error' ? 'alert' : undefined}>{t.text}</p>
        ))}
      </div>
    </>
  );
}
