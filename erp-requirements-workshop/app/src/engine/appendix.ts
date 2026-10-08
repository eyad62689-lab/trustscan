// Structured appendix (FR-20): English keys, option keys as values, emitted as YAML.
import type { GenResult } from './generate';
import { questionSource } from './generate';
import { answerHasContent } from './compute';
import { isoLocal, isoDate } from './format';
import { renderTemplate } from './slots';

export function buildAppendix(g: GenResult, exportedAt = new Date()): any {
  const { d } = g;
  const { bank, ws } = d;
  renderCtx = (s: string) => renderTemplate(d, s).text;
  const flaggedQ = new Set([...ws.flags.map((f) => f.qid), ...g.allFlags.map((f) => f.qid)]);
  const answers: Record<string, any> = {};
  for (const q of bank.questions) {
    if (!d.visibleQuestions.has(q.id)) continue;
    const { source, reason } = questionSource(d, q);
    if (/-099$/.test(q.id) && !answerHasContent(ws.answers[q.id])) continue;
    const parts: Record<string, any> = {};
    for (const p of q.parts) {
      if (!d.visibleParts.has(`${q.id}#${p.key}`)) continue;
      const v = d.partValue(q, p);
      if (v === undefined) continue;
      parts[p.key] = cleanValue(v);
      const other = ws.answers[q.id]?.other?.[p.key];
      if (other) parts[`${p.key}_other`] = other;
    }
    const keys = Object.keys(parts);
    if (!keys.length) continue;
    const entry: any = { value: keys.length === 1 && keys[0] === q.parts[0].key ? parts[keys[0]] : parts, source };
    entry.flagged = flaggedQ.has(q.id);
    if (source === 'assumption' && reason) entry.assumption_reason = reason;
    answers[q.id] = entry;
  }
  const modules: Record<string, any> = {};
  for (const [m, sel] of Object.entries(d.modules)) {
    const pr = d.unitPriority(m);
    modules[m] = sel ? { selected: true, priority: pr || bank.defaultPriority } : { selected: false };
  }
  for (const n of g.deferredNeeds) modules[n.id] = { selected: false, deferred_need: true, priority: n.priority };
  return {
    meta: {
      bank_version: bank.version,
      entity_name: ws.entityName,
      exported_at: isoLocal(exportedAt),
      sessions: ws.sessions.map((s) => ({
        date: isoDate(s.start),
        facilitator: s.facilitator,
        attendees: s.attendees.map((a) => ({ name: a.name || '', role: a.role })),
      })),
    },
    flags: Object.fromEntries(bank.flags.filter((f) => !f.dropped).map((f) => [f.id, d.flags[f.id]])),
    modules,
    answers,
    requirements: g.requirements.map((r) => ({ id: r.id, priority: r.priority, source: r.source, question: r.question })),
    standard_rules: g.rules.map((r) => ({ id: r.id, source: 'standard' })),
    assumptions: g.assumptions.map((a) => ({ question: a.question, value: cleanValue(a.valueRaw), reason: a.reason })),
  };
}

let renderCtx: ((s: string) => string) | undefined;
function cleanValue(v: any): any {
  if (typeof v === 'string' && v.includes('{{') && renderCtx) return renderCtx(v);
  if (Array.isArray(v)) return v.map(cleanValue);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '_label') continue;
      o[k === '_k' ? 'row' : k] = cleanValue(x);
    }
    return o;
  }
  return v;
}

// ---------- YAML emitter ----------
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_\-.]*$/;

function scalar(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  const s = String(v);
  if (/^[a-z][a-z0-9_]*$/.test(s) && !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(s)) return s;
  return JSON.stringify(s); // double-quoted, escapes newlines and quotes
}

function key(k: string): string {
  return PLAIN_KEY.test(k) && !['true', 'false', 'null', 'yes', 'no'].includes(k) ? k : JSON.stringify(k);
}

export function toYaml(v: any, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return v
      .map((x) => {
        if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length) {
          const body = toYaml(x, indent + 1).replace(/^\s+/, '');
          return `${pad}- ${body}`;
        }
        return `${pad}- ${x && typeof x === 'object' ? toYaml(x, indent + 1).trim() : scalar(x)}`;
      })
      .join('\n');
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v);
    if (!entries.length) return '{}';
    return entries
      .map(([k, x]) => {
        if (x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length)) return `${pad}${key(k)}:\n${toYaml(x, indent + 1)}`;
        if (x && typeof x === 'object') return `${pad}${key(k)}: ${Array.isArray(x) ? '[]' : '{}'}`;
        return `${pad}${key(k)}: ${scalar(x)}`;
      })
      .join('\n');
  }
  return pad + scalar(v);
}
