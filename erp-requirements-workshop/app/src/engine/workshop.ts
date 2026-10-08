// Pure workshop mutations (used by the UI store and tests).
import type { Bank, Workshop, QAnswer, AssumptionReason, Session, Attendee, ManualFlag } from './types';
import { derive, isEmpty, answerHasContent } from './compute';

export function uid(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newWorkshop(bank: Bank, entityName = ''): Workshop {
  const now = new Date().toISOString();
  return {
    id: uid(),
    entityName,
    createdAt: now,
    updatedAt: now,
    bankVersion: bank.version,
    answers: {},
    comments: {},
    flags: [],
    autoFlagResolutions: {},
    sessions: [],
    sectionAttendance: {},
    extraAttendees: [],
    sectionNotes: {},
    completedSections: [],
    newQuestions: [],
  };
}

function touch(ws: Workshop): Workshop {
  const now = new Date().toISOString();
  return { ...ws, updatedAt: now, lastChangeAt: now };
}

/** Set one part of a question. source = 'answer' (user picked it, even if it equals the recommendation). */
export function setPart(bank: Bank, ws: Workshop, qid: string, partKey: string, value: any, extra?: { otherText?: string }): Workshop {
  const q = bank.questionById.get(qid);
  const prev: QAnswer = ws.answers[qid] || { parts: {}, source: 'answer', touched: false, updatedAt: '' };
  const parts = { ...prev.parts, [partKey]: value };
  if (isEmpty(value)) delete parts[partKey];
  const other = { ...(prev.other || {}) };
  if (extra?.otherText !== undefined) other[partKey] = extra.otherText;
  const isFree = /-099$/.test(qid);
  const a: QAnswer = {
    parts,
    other,
    dontKnow: false,
    source: isFree ? 'free_text' : 'answer',
    touched: true,
    updatedAt: new Date().toISOString(),
  };
  const answers = { ...ws.answers };
  if (!answerHasContent(a) && !Object.values(other).some(Boolean)) delete answers[qid];
  else answers[qid] = a;
  const newQuestions = ws.newQuestions.filter((x) => x !== qid);
  return touch({ ...ws, answers, newQuestions, lastQuestion: qid, lastSection: q?.section ?? ws.lastSection });
}

export function setOtherText(ws: Workshop, qid: string, partKey: string, text: string): Workshop {
  const prev: QAnswer = ws.answers[qid] || { parts: {}, source: 'answer', touched: true, updatedAt: '' };
  return touch({ ...ws, answers: { ...ws.answers, [qid]: { ...prev, other: { ...(prev.other || {}), [partKey]: text }, updatedAt: new Date().toISOString() } } });
}

/** «لا أعلم — طبّق الموصى به»: the effective value follows the (dynamic) recommendation. */
export function setDontKnow(ws: Workshop, qid: string, on = true): Workshop {
  const answers = { ...ws.answers };
  if (on) answers[qid] = { parts: {}, dontKnow: true, source: 'assumption', reason: 'dont_know', touched: true, updatedAt: new Date().toISOString() };
  else delete answers[qid];
  return touch({ ...ws, answers, lastQuestion: qid });
}

/** Write the recommended values as an assumption (bulk / flag resolution / prefilled acceptance). */
export function applyRecommended(bank: Bank, ws: Workshop, qids: string[], reason: AssumptionReason): Workshop {
  const d = derive(bank, ws);
  const answers = { ...ws.answers };
  for (const qid of qids) {
    const q = bank.questionById.get(qid);
    if (!q) continue;
    const parts: Record<string, any> = {};
    for (const p of q.parts) {
      if (!d.visibleParts.has(`${qid}#${p.key}`)) continue;
      const r = d.rec(q, p).value;
      if (!isEmpty(r)) parts[p.key] = JSON.parse(JSON.stringify(r));
    }
    if (!Object.keys(parts).length) continue;
    answers[qid] = { parts, source: 'assumption', reason, touched: false, updatedAt: new Date().toISOString() };
  }
  return touch({ ...ws, answers });
}

/** «أؤكد» on a prefilled list: rows become the user's answer. */
export function confirmList(bank: Bank, ws: Workshop, qid: string, partKey: string): Workshop {
  const d = derive(bank, ws);
  const q = bank.questionById.get(qid)!;
  const p = q.parts.find((x) => x.key === partKey)!;
  return setPart(bank, ws, qid, partKey, d.listRows(q, p));
}

export function startSession(ws: Workshop, facilitator: string, attendees: Attendee[]): Workshop {
  const s: Session = { id: uid(), start: new Date().toISOString(), facilitator, attendees };
  return touch({ ...ws, sessions: [...ws.sessions, s] });
}

export function endSession(ws: Workshop): Workshop {
  const sessions = ws.sessions.map((s, i) => (i === ws.sessions.length - 1 && !s.end ? { ...s, end: new Date().toISOString() } : s));
  return touch({ ...ws, sessions });
}

export function currentSession(ws: Workshop): Session | undefined {
  const s = ws.sessions[ws.sessions.length - 1];
  return s && !s.end ? s : undefined;
}

export function addFlag(ws: Workshop, qid: string, reason: string, decider?: string, opinions?: string): Workshop {
  const f: ManualFlag = { id: uid(), qid, reason, decider, opinions, status: 'open', createdAt: new Date().toISOString(), sessionId: currentSession(ws)?.id };
  return touch({ ...ws, flags: [...ws.flags, f] });
}

export function resolveManualFlag(ws: Workshop, id: string, status: 'answered' | 'assumed', resolution: string): Workshop {
  return touch({ ...ws, flags: ws.flags.map((f) => (f.id === id ? { ...f, status, resolution, resolvedAt: new Date().toISOString() } : f)) });
}

export function resolveAutoFlag(ws: Workshop, key: string, status: 'answered' | 'assumed', resolution: string, value?: string): Workshop {
  return touch({ ...ws, autoFlagResolutions: { ...ws.autoFlagResolutions, [key]: { status, resolution, value, resolvedAt: new Date().toISOString() } } });
}

export function setComment(ws: Workshop, qid: string, text: string): Workshop {
  const comments = { ...ws.comments, [qid]: text };
  if (!text) delete comments[qid];
  return touch({ ...ws, comments });
}

export function setSectionNote(ws: Workshop, sectionId: string, text: string, date: string): Workshop {
  const sid = currentSession(ws)?.id;
  const list = [...(ws.sectionNotes[sectionId] || [])];
  const i = list.findIndex((n) => n.sessionId === sid);
  if (i >= 0) list[i] = { ...list[i], text };
  else list.push({ sessionId: sid, date, text });
  return touch({ ...ws, sectionNotes: { ...ws.sectionNotes, [sectionId]: list } });
}

export function setAttendance(ws: Workshop, sectionId: string, ids: string[]): Workshop {
  return touch({ ...ws, sectionAttendance: { ...ws.sectionAttendance, [sectionId]: ids } });
}

/** «أكملنا هذا القسم»: untouched prefilled lists become «صفوف معبّأة قُبلت كما هي». */
export function completeSection(bank: Bank, ws: Workshop, sectionId: string): Workshop {
  const d = derive(bank, ws);
  let next = ws;
  const listQs: string[] = [];
  for (const q of bank.questionsBySection.get(sectionId) || []) {
    if (!d.visibleQuestions.has(q.id) || d.isAnswered(q.id)) continue;
    if (q.parts.some((p) => (p.type === 'list' || p.type === 'matrix') && d.listRows(q, p).length)) listQs.push(q.id);
  }
  if (listQs.length) next = applyRecommended(bank, next, listQs, 'prefilled_accepted');
  const completed = [...new Set([...next.completedSections, sectionId])];
  return touch({ ...next, completedSections: completed });
}

export function reopenSection(ws: Workshop, sectionId: string): Workshop {
  return touch({ ...ws, completedSections: ws.completedSections.filter((s) => s !== sectionId) });
}

/** Detail questions of the section that are still unanswered (FR-13). */
export function bulkCandidates(bank: Bank, ws: Workshop, sectionId: string, onlyDetail = true): string[] {
  const d = derive(bank, ws);
  return (bank.questionsBySection.get(sectionId) || [])
    .filter((q) => d.visibleQuestions.has(q.id) && !d.isAnswered(q.id) && (!onlyDetail || q.detail) && !/-099$/.test(q.id))
    .map((q) => q.id);
}
