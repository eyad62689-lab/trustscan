// Template slot parser + renderer.
// Grammar (inside template text):
//   {{Q:ref}}  {{SW:ref|k1=text|k2=text|*=text}} (branch texts may nest slots)
//   {{R:STD-…}}  {{IF:<json Expr>|text}}  {{MISSING:description}}  {{ITEM}} / {{ITEM.key}} / {{ITEM.priority}}
import type { Expr, Part, Question, Column } from './types';
import type { Derived, LocalCtx } from './compute';
import { isEmpty, keysOf } from './compute';
import { parseRef } from './refs';
import { findPart } from './load';

export type SlotNode =
  | { t: 'text'; v: string }
  | { t: 'Q'; ref: string }
  | { t: 'R'; id: string }
  | { t: 'MISSING'; desc: string }
  | { t: 'ITEM'; field?: string }
  | { t: 'IF'; expr: Expr; json: string; body: SlotNode[]; error?: string }
  | { t: 'SW'; ref: string; branches: { key: string; body: SlotNode[] }[] }
  | { t: 'BAD'; raw: string };

export interface ParseResult { nodes: SlotNode[]; errors: string[] }

export function parseTemplate(src: string): ParseResult {
  const errors: string[] = [];
  let i = 0;
  const s = String(src ?? '');

  function readJson(): string {
    // s[i] === '{'
    let depth = 0, inStr = false, esc = false;
    const start = i;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { i++; return s.slice(start, i); }
      }
    }
    errors.push(`unterminated JSON at ${start}`);
    return s.slice(start);
  }

  /** Parse nodes until one of the stop tokens at this nesting level ("}}" or "|"). */
  function parseSeq(stopAtPipe: boolean): SlotNode[] {
    const out: SlotNode[] = [];
    let buf = '';
    const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    while (i < s.length) {
      if (s.startsWith('}}', i)) break;
      if (stopAtPipe && s[i] === '|') break;
      if (s.startsWith('{{', i)) {
        flush();
        out.push(parseSlot());
        continue;
      }
      buf += s[i++];
    }
    flush();
    return out;
  }

  function readUntilClose(): string {
    const end = s.indexOf('}}', i);
    if (end < 0) { errors.push(`unterminated slot at ${i}`); const r = s.slice(i); i = s.length; return r; }
    const r = s.slice(i, end);
    i = end + 2;
    return r;
  }

  function parseSlot(): SlotNode {
    const start = i;
    i += 2;
    const m = /^([A-Za-z]+)(:|\.|}})?/.exec(s.slice(i));
    if (!m) { const raw = readUntilClose(); errors.push(`bad slot {{${raw}}}`); return { t: 'BAD', raw }; }
    const kind = m[1].toUpperCase();
    i += m[1].length;
    if (kind === 'ITEM') {
      if (s[i] === '.') { i++; return { t: 'ITEM', field: readUntilClose() }; }
      readUntilClose();
      return { t: 'ITEM' };
    }
    if (s[i] !== ':') { const raw = readUntilClose(); errors.push(`bad slot {{${kind}${raw}}}`); return { t: 'BAD', raw: kind + raw }; }
    i++; // ':'
    switch (kind) {
      case 'Q': return { t: 'Q', ref: readUntilClose().trim() };
      case 'R': return { t: 'R', id: readUntilClose().trim() };
      case 'MISSING': return { t: 'MISSING', desc: readUntilClose().trim() };
      case 'IF': {
        while (s[i] === ' ') i++;
        if (s[i] !== '{') { const raw = readUntilClose(); errors.push(`IF without JSON: ${raw}`); return { t: 'BAD', raw }; }
        const json = readJson();
        let expr: Expr = false;
        let error: string | undefined;
        try { expr = JSON.parse(json); } catch (e) { error = `bad IF JSON: ${json}`; errors.push(error); }
        if (s[i] === '|') i++;
        const body = parseSeq(false);
        if (s.startsWith('}}', i)) i += 2; else errors.push(`unterminated IF at ${start}`);
        return { t: 'IF', expr, json, body, error };
      }
      case 'SW': {
        let ref = '';
        while (i < s.length && s[i] !== '|' && !s.startsWith('}}', i)) ref += s[i++];
        const branches: { key: string; body: SlotNode[] }[] = [];
        while (s[i] === '|') {
          i++;
          let key = '';
          while (i < s.length && s[i] !== '=' && s[i] !== '|' && !s.startsWith('}}', i)) key += s[i++];
          if (s[i] === '=') i++;
          branches.push({ key: key.trim(), body: parseSeq(true) });
        }
        if (s.startsWith('}}', i)) i += 2; else errors.push(`unterminated SW at ${start}`);
        return { t: 'SW', ref: ref.trim(), branches };
      }
      default: {
        const raw = readUntilClose();
        errors.push(`unknown slot ${kind}`);
        return { t: 'BAD', raw: `${kind}:${raw}` };
      }
    }
  }

  const nodes = parseSeq(false);
  if (i < s.length) {
    // stray "}}" at top level: keep as text
    nodes.push({ t: 'text', v: s.slice(i) });
  }
  return { nodes, errors };
}

const cache = new Map<string, ParseResult>();
export function parseCached(src: string): ParseResult {
  let r = cache.get(src);
  if (!r) { r = parseTemplate(src); cache.set(src, r); }
  return r;
}

export interface RenderIssue { kind: 'missing' | 'unknown_ref' | 'empty' | 'dropped'; desc: string }
export interface RenderResult { text: string; issues: RenderIssue[]; refs: string[] }

// ---------- value formatting ----------
const BOOL: Record<string, string> = { true: 'نعم', false: 'لا', yes: 'نعم', no: 'لا' };

export function optionLabel(opts: { key: string; label: string; other?: boolean }[] | undefined, key: any, otherText?: string): string {
  const o = opts?.find((x) => x.key === key);
  if (!o) return key === true || key === false ? BOOL[String(key)] : String(key ?? '');
  if (o.other) return otherText ? `«${otherText}»` : o.label;
  return o.label;
}

export function formatCell(col: Column | undefined, v: any, d?: Derived): string {
  if (isEmpty(v)) return '';
  if (Array.isArray(v)) return v.map((x) => formatCell(col, x, d)).filter(Boolean).join('، ');
  if (col?.type === 'bool' || typeof v === 'boolean') {
    if (col?.options?.length && typeof v === 'string') return optionLabel(col.options, v);
    return BOOL[String(v)] ?? String(v);
  }
  if (col?.options?.length) return optionLabel(col.options, v);
  if (col?.type === 'number' && col.unit) return `${v} ${col.unit}`;
  return String(v);
}

export function formatRow(p: Part, row: any, d?: Derived): string {
  const cols = p.columns || [];
  const vals = cols.map((c) => formatCell(c, row?.[c.key], d)).filter((x) => x);
  if (!vals.length) return row?._label ? String(row._label) : '';
  if (p.type === 'matrix' && row?._label) return `${row._label}: ${vals.join('، ')}`;
  return vals.length === 1 ? vals[0] : `${vals[0]} (${vals.slice(1).join('، ')})`;
}

export function formatPartValue(d: Derived, q: Question, p: Part, v: any, unitRender?: (s: string) => string): string {
  if (isEmpty(v)) return '';
  const other = d.ws.answers[q.id]?.other?.[p.key];
  switch (p.type) {
    case 'single':
      return optionLabel(p.options, v, other);
    case 'multi':
    case 'multiPriority':
      return keysOf(v).filter((k) => !p.options?.find((o) => o.key === k)?.dontKnow).map((k) => optionLabel(p.options, k, other)).join('، ');
    case 'number': {
      const unit = p.unit ? (unitRender ? unitRender(p.unit) : p.unit) : '';
      return unit ? `${v} ${unit}` : String(v);
    }
    case 'list':
    case 'matrix': {
      const rows: any[] = Array.isArray(v) ? v : Object.entries(v).map(([k, x]) => ({ _k: k, _label: k, ...(typeof x === 'object' ? x : { value: x }) }));
      return rows.map((r) => formatRow(p, r, d)).filter(Boolean).join('؛ ');
    }
    case 'approvalRow': {
      const cols = p.columns || [];
      return cols.map((c) => { const x = formatCell(c, v?.[c.key], d); return x ? `${c.label}: ${x}` : ''; }).filter(Boolean).join('؛ ');
    }
    case 'logo':
      return 'شعار مرفوع';
    default:
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
  }
}

// ---------- rendering ----------
export interface RenderOptions {
  local?: LocalCtx;
  /** substitution for {{MISSING}} / empty slots that were resolved in review (key → text) */
  resolved?: (desc: string) => string | undefined;
}

export function renderTemplate(d: Derived, src: string, ro: RenderOptions = {}): RenderResult {
  const { nodes } = parseCached(src);
  const issues: RenderIssue[] = [];
  const refs: string[] = [];
  const hasQ = (id: string) => d.bank.questionById.has(id);
  const local = ro.local;

  const unitRender = (u: string) => {
    if (u.includes('{{')) return renderTemplate(d, u, ro).text;
    return u.replace(/\{([^{}]+)\}/g, (m, id) => (hasQ(id.trim()) ? qText(id.trim()) || m : m));
  };

  function qText(rawRef: string): string {
    const r = parseRef(rawRef, hasQ);
    refs.push(r.qid);
    const q = d.bank.questionById.get(r.qid);
    if (!q) { issues.push({ kind: 'unknown_ref', desc: rawRef }); return ''; }
    const p = findPart(q, r.part);
    if (!p) { issues.push({ kind: 'unknown_ref', desc: rawRef }); return ''; }
    const pk = `${q.id}#${p.key}`;
    if (!d.visibleQuestions.has(q.id) || !d.visibleParts.has(pk)) { issues.push({ kind: 'dropped', desc: rawRef }); return ''; }
    // current item (perItem)
    if (local?.item && local.itemPart === pk && !r.sub) {
      return local.item.other ? `«${d.ws.answers[q.id]?.other?.[p.key] || local.item.label}»` : local.item.label;
    }
    const v = d.partValue(q, p);
    let out = '';
    if (!r.sub && r.row === undefined) out = formatPartValue(d, q, p, v, unitRender);
    else {
      const sv = d.value(rawRef) as any;
      const cur = local?.rowPart === pk && local.row ? local.row : undefined;
      let x = sv;
      if (cur && r.sub && (r.row === undefined || r.row === 'row')) x = cur[r.sub];
      const col = p.columns?.find((c) => c.key === r.sub);
      if (r.sub === 'other') x = d.ws.answers[q.id]?.other?.[p.key];
      if (col) out = formatCell(col, x, d);
      else if (r.sub?.endsWith('_priority')) out = d.bank.priorities.find((pp) => pp.key === x)?.label ?? (x ? String(x) : '');
      else if (p.type === 'list' || p.type === 'matrix') out = Array.isArray(x) ? x.map((row) => (typeof row === 'object' ? formatRow(p, row, d) : String(row))).join('، ') : typeof x === 'object' && x ? formatRow(p, x, d) : formatCell(undefined, x);
      else if (p.options?.length && typeof x === 'string') out = optionLabel(p.options, x);
      else out = formatCell(undefined, x);
    }
    if (!out) {
      const fix = ro.resolved?.(rawRef);
      if (fix) return fix;
      issues.push({ kind: 'empty', desc: rawRef });
    }
    return out;
  }

  function run(list: SlotNode[]): string {
    let out = '';
    for (const n of list) {
      switch (n.t) {
        case 'text': out += n.v; break;
        case 'Q': out += qText(n.ref); break;
        case 'R': out += n.id; break;
        case 'ITEM': {
          const it = local?.item;
          if (!it) { issues.push({ kind: 'missing', desc: 'ITEM' }); break; }
          if (!n.field || n.field === 'label') out += it.label;
          else if (n.field === 'key') out += it.key;
          else if (n.field === 'priority') out += d.bank.priorities.find((p) => p.key === it.priority)?.label ?? '';
          else out += String((it as any)[n.field] ?? '');
          break;
        }
        case 'MISSING': {
          const fix = ro.resolved?.(n.desc);
          if (fix) out += fix;
          else { issues.push({ kind: 'missing', desc: n.desc }); out += `〈${n.desc}〉`; }
          break;
        }
        case 'IF':
          if (!n.error && d.evalExpr(n.expr, local)) out += run(n.body);
          break;
        case 'SW': {
          const r = parseRef(n.ref, hasQ);
          refs.push(r.qid);
          const q = d.bank.questionById.get(r.qid);
          if (!q) { issues.push({ kind: 'unknown_ref', desc: n.ref }); break; }
          const p = findPart(q, r.part);
          const pk = p ? `${q.id}#${p.key}` : '';
          let v: any = local?.item && local.itemPart === pk ? local.item.key : d.value(n.ref);
          if (local?.row && local.rowPart === pk && r.sub) v = local.row[r.sub];
          let keys = keysOf(v).map(String);
          const dk = p?.options?.find((o) => o.dontKnow)?.key;
          const ans = d.ws.answers[q.id];
          if (dk && (ans?.dontKnow || keysOf(ans?.parts?.[p!.key]).includes(dk))) keys = [dk, ...keys];
          const parts: string[] = [];
          const seen = new Set<string>();
          for (const k of keys) {
            const b = n.branches.find((x) => x.key === k);
            if (b) { if (!seen.has(b.key)) { parts.push(run(b.body)); seen.add(b.key); } if (k === dk) break; }
          }
          if (!parts.length && keys.length) {
            const def = n.branches.find((x) => x.key === '*');
            if (def) parts.push(run(def.body));
          }
          out += parts.filter(Boolean).join('؛ ');
          break;
        }
        case 'BAD': out += ''; issues.push({ kind: 'missing', desc: `صيغة خانة غير صحيحة: ${n.raw}` }); break;
      }
    }
    return out;
  }

  const text = run(nodes).replace(/[ \t]{2,}/g, ' ').replace(/ ([،؛.])/g, '$1').trim();
  return { text, issues, refs };
}

/** Plain text with all slots removed (for search / previews). */
export function stripSlots(src: string): string {
  return String(src ?? '').replace(/\{\{[^{}]*\}\}/g, '…');
}
