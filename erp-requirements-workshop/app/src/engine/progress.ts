// Progress file (FR-23, NFR-14): export with SHA-256 checksum; import treats the file as
// untrusted input — strict shape validation, size cap, no prototype keys, checksum check,
// bank-version migration with an import report. Nothing in it is ever executed or rendered as HTML.
import type { Bank, Workshop, ImportReport, QAnswer } from './types';
import { isoDate, hhmm, safeName } from './format';
import { uid } from './workshop';

export const PROGRESS_FORMAT = 'rw-progress';
export const PROGRESS_VERSION = 1;
export const MAX_PROGRESS_BYTES = 10 * 1024 * 1024;

export function canonical(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function exportProgress(ws: Workshop, bank: Pick<Bank, 'version' | 'questions'>): Promise<{ name: string; text: string }> {
  const workshop = { ...JSON.parse(JSON.stringify(ws)), knownQuestions: bank.questions.map((q) => q.id) };
  const checksum = 'sha256:' + (await sha256Hex(canonical(workshop)));
  const file = { format: PROGRESS_FORMAT, formatVersion: PROGRESS_VERSION, bankVersion: bank.version, exportedAt: new Date().toISOString(), workshop, checksum };
  const now = new Date();
  return { name: `تقدم-${safeName(ws.entityName)}-${isoDate(now)}-${hhmm(now)}.json`, text: JSON.stringify(file) };
}

export class ProgressError extends Error {}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_STR = 20000;
const MAX_LOGO = 1_500_000; // data URL of a ≤1 MB image

function check(cond: any, msg: string): asserts cond {
  if (!cond) throw new ProgressError(msg);
}

function isObj(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep scan: rejects prototype-polluting keys, functions, over-long strings, excessive depth. */
function scan(v: any, depth = 0, path = ''): void {
  check(depth < 40, `بنية متداخلة أكثر من اللازم عند ${path}`);
  if (typeof v === 'string') {
    const isLogo = v.startsWith('data:image/');
    check(v.length <= (isLogo ? MAX_LOGO : MAX_STR), `نص أطول من المسموح عند ${path}`);
    if (isLogo) check(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v), `صورة غير مقبولة عند ${path}`);
    return;
  }
  if (v === null || typeof v === 'number' || typeof v === 'boolean') {
    if (typeof v === 'number') check(Number.isFinite(v), `رقم غير صالح عند ${path}`);
    return;
  }
  check(typeof v === 'object', `قيمة غير مقبولة عند ${path}`);
  if (Array.isArray(v)) {
    check(v.length <= 5000, `قائمة أطول من المسموح عند ${path}`);
    v.forEach((x, i) => scan(x, depth + 1, `${path}[${i}]`));
    return;
  }
  for (const k of Object.keys(v)) {
    check(!BAD_KEYS.has(k), `مفتاح محظور «${k}» عند ${path}`);
    check(k.length <= 200, `مفتاح طويل عند ${path}`);
    scan(v[k], depth + 1, `${path}.${k}`);
  }
}

const str = (v: any, max = MAX_STR) => typeof v === 'string' && v.length <= max;
const optStr = (v: any, max = MAX_STR) => v === undefined || str(v, max);
const STATUS = ['open', 'answered', 'assumed'];
const SOURCES = ['answer', 'assumption', 'free_text', 'standard'];

function validateWorkshop(w: any): Workshop {
  check(isObj(w), 'لا توجد بيانات ورشة في الملف');
  check(str(w.id, 100) && optStr(w.entityName, 500), 'معرّف الورشة أو اسم الكيان غير صالح');
  check(str(w.createdAt, 40) && str(w.updatedAt, 40), 'تواريخ الورشة غير صالحة');
  check(isObj(w.answers), 'الإجابات غير صالحة');
  for (const [qid, a] of Object.entries<any>(w.answers)) {
    check(qid.length <= 60, 'معرّف سؤال غير صالح');
    check(isObj(a) && isObj(a.parts), `إجابة ${qid} غير صالحة`);
    check(SOURCES.includes(a.source), `مصدر إجابة ${qid} غير صالح`);
    check(a.other === undefined || isObj(a.other), `نص «أخرى» في ${qid} غير صالح`);
    if (a.other) for (const x of Object.values(a.other)) check(str(x), `نص «أخرى» في ${qid} غير صالح`);
  }
  check(isObj(w.comments) && Object.values(w.comments).every((c) => str(c)), 'التعليقات غير صالحة');
  check(Array.isArray(w.flags), 'العلامات غير صالحة');
  for (const f of w.flags) check(isObj(f) && str(f.id, 100) && str(f.qid, 60) && str(f.reason) && STATUS.includes(f.status), 'علامة غير صالحة');
  check(isObj(w.autoFlagResolutions ?? {}), 'حسم العلامات غير صالح');
  for (const r of Object.values<any>(w.autoFlagResolutions ?? {})) check(isObj(r) && STATUS.includes(r.status) && str(r.resolution ?? ''), 'حسم علامة غير صالح');
  check(Array.isArray(w.sessions), 'الجلسات غير صالحة');
  for (const s of w.sessions) {
    check(isObj(s) && str(s.id, 100) && str(s.start, 40) && optStr(s.end, 40) && str(s.facilitator ?? '', 300) && Array.isArray(s.attendees), 'جلسة غير صالحة');
    for (const a of s.attendees) check(isObj(a) && str(a.id, 100) && str(a.role, 300) && optStr(a.name, 300), 'حاضر غير صالح');
  }
  check(isObj(w.sectionAttendance ?? {}), 'حضور الأقسام غير صالح');
  for (const v of Object.values<any>(w.sectionAttendance ?? {})) check(Array.isArray(v) && v.every((x) => str(x, 100)), 'حضور الأقسام غير صالح');
  check(Array.isArray(w.extraAttendees ?? []), 'الحضور الإضافي غير صالح');
  check(isObj(w.sectionNotes ?? {}), 'الملاحظات غير صالحة');
  for (const v of Object.values<any>(w.sectionNotes ?? {})) check(Array.isArray(v) && v.every((n) => isObj(n) && str(n.text) && str(n.date, 40)), 'ملاحظة غير صالحة');
  check(Array.isArray(w.completedSections ?? []) && (w.completedSections ?? []).every((x: any) => str(x, 60)), 'الأقسام المكتملة غير صالحة');
  return {
    id: w.id, entityName: w.entityName ?? '', createdAt: w.createdAt, updatedAt: w.updatedAt, bankVersion: String(w.bankVersion ?? ''),
    answers: w.answers, comments: w.comments, flags: w.flags, autoFlagResolutions: w.autoFlagResolutions ?? {}, sessions: w.sessions,
    sectionAttendance: w.sectionAttendance ?? {}, extraAttendees: w.extraAttendees ?? [], sectionNotes: w.sectionNotes ?? {},
    completedSections: w.completedSections ?? [], lastSection: optStr(w.lastSection, 60) ? w.lastSection : undefined,
    lastQuestion: optStr(w.lastQuestion, 60) ? w.lastQuestion : undefined, newQuestions: Array.isArray(w.newQuestions) ? w.newQuestions.filter((x: any) => str(x, 60)) : [],
    lastExportedAt: optStr(w.lastExportedAt, 40) ? w.lastExportedAt : undefined,
  };
}

export interface ImportResult { workshop: Workshop; report?: ImportReport }

export async function importProgress(text: string, bank: Bank): Promise<ImportResult> {
  check(typeof text === 'string', 'الملف غير مقروء');
  check(new TextEncoder().encode(text).length <= MAX_PROGRESS_BYTES, 'حجم الملف يتجاوز 10 ميجابايت');
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new ProgressError('الملف ليس ملف تقدّم صالحاً (JSON غير صحيح)'); }
  check(isObj(raw), 'بنية الملف غير صحيحة');
  scan(raw);
  check(raw.format === PROGRESS_FORMAT, 'هذا ليس ملف تقدّم من «ورشة المتطلبات»');
  check(raw.formatVersion === PROGRESS_VERSION, 'إصدار صيغة الملف غير مدعوم');
  check(typeof raw.checksum === 'string' && raw.checksum.startsWith('sha256:'), 'الملف بلا بصمة سلامة');
  const expected = 'sha256:' + (await sha256Hex(canonical(raw.workshop)));
  check(expected === raw.checksum, 'بصمة السلامة لا تطابق المحتوى: الملف معطوب أو معدّل');
  const ws = validateWorkshop(raw.workshop);
  const fileBank = String(raw.bankVersion ?? ws.bankVersion ?? '');
  // migrate by question id
  const archived: ImportReport['archived'] = [];
  const answers: Record<string, QAnswer> = {};
  for (const [qid, a] of Object.entries(ws.answers)) {
    if (bank.questionById.has(qid)) answers[qid] = a;
    else archived.push({ qid, value: a.parts });
  }
  let report: ImportReport | undefined;
  const roleMappings: ImportReport['roleMappings'] = [];
  const aliases: Record<string, string> = bank.meta.roleAliases || { 'البائع': 'موظف المبيعات', 'المدير': 'المدير العام' };
  const remap = (v: any): any => {
    if (typeof v === 'string' && aliases[v]) { roleMappings.push({ from: v, to: aliases[v] }); return aliases[v]; }
    if (Array.isArray(v)) return v.map(remap);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
    return v;
  };
  for (const a of Object.values(answers)) a.parts = remap(a.parts);
  const known: string[] = Array.isArray(raw.workshop.knownQuestions) ? raw.workshop.knownQuestions.filter((x: any) => typeof x === 'string') : [];
  const newQuestions = fileBank !== bank.version && known.length ? [...new Set([...ws.newQuestions, ...bank.questions.filter((q) => !known.includes(q.id)).map((q) => q.id)])] : ws.newQuestions;
  if (fileBank !== bank.version || archived.length || roleMappings.length) {
    report = { fromBankVersion: fileBank, toBankVersion: bank.version, archived, newQuestions: fileBank !== bank.version ? newQuestions : [], roleMappings, at: new Date().toISOString() };
  }
  return { workshop: { ...ws, answers, bankVersion: bank.version, newQuestions: fileBank !== bank.version ? newQuestions : ws.newQuestions, importReport: report ?? ws.importReport }, report };
}

/** Same entity already on the device → caller asks replace / separate copy. */
export function asSeparateCopy(ws: Workshop): Workshop {
  return { ...ws, id: uid(), entityName: `${ws.entityName} (نسخة)` };
}
