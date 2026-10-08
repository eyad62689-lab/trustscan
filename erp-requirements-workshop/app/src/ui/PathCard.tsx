import type { Derived } from '../engine/compute';
import { planPath, MAX_SESSION_MIN } from '../engine/time';
import { formatMinutes } from '../engine/format';

/** «مساركم»: visible sections, estimate, proposed session split (≤ 3 h each). */
export function PathCard(props: { d: Derived }) {
  const { d } = props;
  const plan = planPath(d);
  const title = (id: string) => d.bank.sectionById.get(id)?.title || id;
  return (
    <div class="card path-card" aria-labelledby="path-title">
      <h3 id="path-title">مساركم</h3>
      <p>
        الأقسام الظاهرة: <strong>{plan.sections.length}</strong> — المدة التقديرية: <strong>{formatMinutes(plan.total)}</strong> — المتبقي: <strong>{formatMinutes(plan.remaining)}</strong>
      </p>
      <ol class="path-sessions">
        {plan.sessions.map((s, i) => (
          <li key={i}>
            <strong>الجلسة {i + 1}</strong> ({formatMinutes(s.minutes)}{s.minutes > MAX_SESSION_MIN ? ' — قسم طويل يُقسَّم بين جلستين' : ''}): {s.sections.map(title).join('، ')}
          </li>
        ))}
      </ol>
      {Object.entries(d.modules).some(([m, v]) => v && d.bank.sectionById.get(m)?.autoAdded) && (
        <p class="hint">أُضيف تلقائياً: {Object.entries(d.modules).filter(([m, v]) => v && d.bank.sectionById.get(m)?.autoAdded).map(([m]) => title(m)).join('، ')}</p>
      )}
    </div>
  );
}
