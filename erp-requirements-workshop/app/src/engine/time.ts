// Remaining time estimate and session split (FR-12): sessions ≤ 180 minutes.
import type { Bank, Section } from './types';
import type { Derived } from './compute';

export const MAX_SESSION_MIN = 180;

/** Section estimate: the lower bound of the bank's range («35–45 دقيقة» → 35), since the
 *  range's upper bound is the allowance for discussion; falls back to opening.minutes. */
export function sectionMinutes(bank: Bank, s: Section): number {
  const dur = s.opening?.duration || bank.meta?.durations?.[s.id];
  if (typeof dur === 'string') {
    const nums = dur.match(/\d+/g)?.map(Number) || [];
    if (nums.length) return Math.min(...nums) * (/ساع/.test(dur) ? 60 : 1);
  }
  if (s.opening?.minutes) return s.opening.minutes;
  return s.kind === 'mini' || s.kind === 'roles' ? 10 : 30;
}

export interface PathPlan {
  sections: { id: string; title: string; minutes: number; remaining: number }[];
  total: number;
  remaining: number;
  sessions: { sections: string[]; minutes: number }[];
}

export function planPath(d: Derived): PathPlan {
  const { bank, ws } = d;
  const sections = bank.sections
    .filter((s) => d.visibleSections.has(s.id))
    .map((s) => {
      const minutes = sectionMinutes(bank, s);
      const qs = (bank.questionsBySection.get(s.id) || []).filter((q) => d.visibleQuestions.has(q.id));
      const done = ws.completedSections.includes(s.id);
      const answered = qs.filter((q) => d.isAnswered(q.id)).length;
      const share = done ? 0 : qs.length ? 1 - answered / qs.length : 1;
      return { id: s.id, title: s.title, minutes, remaining: Math.round(minutes * share) };
    });
  const sessions: PathPlan['sessions'] = [];
  let cur: { sections: string[]; minutes: number } = { sections: [], minutes: 0 };
  for (const s of sections) {
    if (cur.minutes + s.minutes > MAX_SESSION_MIN && cur.sections.length) {
      sessions.push(cur);
      cur = { sections: [], minutes: 0 };
    }
    cur.sections.push(s.id);
    cur.minutes += s.minutes;
  }
  if (cur.sections.length) sessions.push(cur);
  return {
    sections,
    total: sections.reduce((a, s) => a + s.minutes, 0),
    remaining: sections.reduce((a, s) => a + s.remaining, 0),
    sessions,
  };
}

/** Share of visible basic (non-detail) questions answered, 0..100. */
export function completion(d: Derived): number {
  const qs = d.bank.questions.filter((q) => d.visibleQuestions.has(q.id) && !q.detail && !/-099$/.test(q.id));
  if (!qs.length) return 0;
  return Math.round((100 * qs.filter((q) => d.isAnswered(q.id)).length) / qs.length);
}
