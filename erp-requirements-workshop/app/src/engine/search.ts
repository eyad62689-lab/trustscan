// FR-28: text search over visible questions.
import type { Derived } from './compute';
import { normAr } from './normalize';

export function searchQuestions(d: Derived, query: string, limit = 20): { qid: string; title: string; section: string }[] {
  const n = normAr(query);
  if (n.length < 2) return [];
  const out: { qid: string; title: string; section: string }[] = [];
  for (const q of d.bank.questions) {
    if (!d.visibleQuestions.has(q.id)) continue;
    const hay = normAr(`${q.id} ${q.title} ${q.help || ''}`);
    if (hay.includes(n) || q.id.toLowerCase().includes(query.trim().toLowerCase())) {
      const sec = [q.section, ...(q.alsoIn || [])].find((s) => d.visibleSections.has(s)) || q.section;
      out.push({ qid: q.id, title: q.title, section: sec });
      if (out.length >= limit) break;
    }
  }
  return out;
}
