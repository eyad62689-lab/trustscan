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
  | { t: 'ITEMCELL'; ref: string }
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
      if (s[i] === '.' || s[i] === ':') { i++; return { t: 'ITEM', field: readUntilClose().trim() }; }
      readUntilClose();
      return { t: 'ITEM' };
    }
    if (s[i] !== ':') { const raw = readUntilClose(); errors.push(`bad slot {{${kind}${raw}}}`); return { t: 'BAD', raw: kind + raw }; }
    i++; // ':'
    switch (kind) {
      case 'Q': return { t: 'Q', ref: readUntilClose().trim() };
      case 'R': return { t: 'R', id: readUntilClose().trim() };
      case 'ITEMCELL': return { t: 'ITEMCELL', ref: readUntilClose().trim() };
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
  if (d && typeof v === 'string' && v.includes('{{')) return renderTemplate(d, v).text;
  if (col?.type === 'role') return d ? d.roleLabel(v) : Array.isArray(v) ? v.join('، ') : String(v);
  if (Array.isArray(v)) return v.map((x) => formatCell(col, x, d)).filter(Boolean).join('، ');
  if (d && col && (col.optionsFrom || col.rowsFrom) && typeof v === 'string') { const o = d.columnOptions(col).find((x) => x.key === v); if (o) return o.label; }
  if (col?.type === 'bool' || typeof v === 'boolean') {
    if (col?.options?.length && typeof v === 'string') return optionLabel(col.options, v);
    return BOOL[String(v)] ?? String(v);
  }
  if (col?.options?.length) return optionLabel(col.options, v);
  if (col?.type === 'number' && col.unit) return `${v} ${col.unit}`;
  return String(v);
}

export function formatRow(p: Part, row: any, d?: Derived): string {
  const cols = d ? d.visibleColumns(p) : p.columns || [];
  const vals = cols.map((c) => formatCell(c, row?.[c.key], d)).filter((x) => x);
  if (!vals.length) return row?._label ? String(row._label) : '';
  if (p.type === 'matrix' && row?._label) return `${row._label}: ${vals.join('، ')}`;
  return vals.length === 1 ? vals[0] : `${vals[0]} (${vals.slice(1).join('، ')})`;
}

export function formatPartValue(d: Derived, q: Question, p: Part, v: any, unitRender?: (s: string) => string): string {
  if (isEmpty(v)) return '';
  const other = d.ws.answers[q.id]?.other?.[p.key];
  const opts = p.optionsFrom ? d.allOptions(q, p) : p.options;
  const isRoleSrc = p.optionsFrom && String(p.optionsFrom).startsWith(d.bank.rolesQid);
  switch (p.type) {
    case 'single':
      return isRoleSrc ? d.roleLabel(v) : optionLabel(opts, v, other);
    case 'multi':
    case 'multiPriority':
      return keysOf(v).filter((k) => !opts?.find((o) => o.key === k)?.dontKnow).map((k) => (isRoleSrc ? d.roleLabel(k) : optionLabel(opts, k, other))).join('، ');
    case 'number': {
      let unit = p.unit ? (unitRender ? unitRender(p.unit) : p.unit) : '';
      const m = /^\{\{?Q?:?([^{}]+?)\}?\}$/.exec(unit);
      if (m && d.bank.questionById.has(m[1])) { const uq = d.bank.questionById.get(m[1])!; unit = formatPartValue(d, uq, uq.parts[0], d.partValue(uq, uq.parts[0])) || ''; }
      return unit ? `${v} ${unit}` : String(v);
    }
    case 'list':
    case 'matrix': {
      const rows: any[] = d.toRows(p, v);
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

  function itemText(field?: string): string {
    if (local?.row) {
      const p = partOfKey(local.rowPart);
      if (!field || field === 'label') return String(local.row._label ?? local.row[labelCol(p)] ?? '');
      if (field === 'key') return String(local.row._k ?? '');
      const col = p?.columns?.find((c) => c.key === field);
      return formatCell(col, local.row[field], d);
    }
    const it = local?.item;
    if (!it) return '';
    if (!field || field === 'label') return it.other ? `«${d.ws.answers[local!.itemPart!.split('#')[0]]?.other?.[local!.itemPart!.split('#')[1]] || it.label}»` : it.label;
    if (field === 'key') return it.key;
    if (field === 'priority') return d.bank.priorities.find((p) => p.key === it.priority)?.label ?? '';
    const x = (it as any)[field];
    if (field === 'recipient' || /role|approver|reader/.test(field)) return d.roleLabel(x);
    return x === undefined || x === null ? '' : Array.isArray(x) ? x.join('، ') : String(x);
  }
  function partOfKey(pk?: string): Part | undefined {
    if (!pk) return undefined;
    const [qid, key] = pk.split('#');
    return findPart(d.bank.questionById.get(qid), key);
  }
  function labelCol(p?: Part): string {
    const cols = p?.columns || [];
    return (cols.find((c) => ['name', 'role', 'title', 'label', 'list', 'entity_name', 'item', 'type', 'report', 'event', 'document'].includes(c.key)) || cols.find((c) => c.type === 'text') || cols[0])?.key || 'name';
  }

  function qText(rawRef: string): string {
    if (rawRef.startsWith('@item')) return itemText(rawRef.slice(6) || undefined);
    const r = parseRef(rawRef, hasQ);
    refs.push(r.qid);
    const q = d.bank.questionById.get(r.qid);
    if (!q) {
      if (d.bank.deferredIds.has(r.qid.split('-')[0])) { issues.push({ kind: 'dropped', desc: rawRef }); return ''; }
      issues.push({ kind: 'unknown_ref', desc: rawRef });
      return '';
    }
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
    if (!r.sub && r.row === undefined) out = p.type === 'number' ? (isEmpty(v) ? '' : String(v)) : formatPartValue(d, q, p, v, unitRender);
    else {
      const sv = d.value(rawRef, local) as any;
      const cur = local?.rowPart === pk && local.row ? local.row : undefined;
      let x = sv;
      if (cur && r.sub && (r.row === undefined || r.row === 'row')) x = cur[r.sub];
      const col = p.columns?.find((c) => c.key === r.sub);
      if (r.sub === 'other') x = d.ws.answers[q.id]?.other?.[p.key];
      if ((r.sub === 'row' || r.sub === '_label') && cur) out = String(cur._label ?? cur[labelCol(p)] ?? '');
      else if (col) out = formatCell(col, x, d);
      else if (r.sub?.endsWith('_priority')) out = d.bank.priorities.find((pp) => pp.key === x)?.label ?? (x ? String(x) : '');
      else if (p.type === 'list' || p.type === 'matrix') out = Array.isArray(x) ? x.map((row) => (typeof row === 'object' ? formatRow(p, row, d) : String(row))).join('، ') : typeof x === 'object' && x ? formatRow(p, x, d) : formatCell(undefined, x);
      else if (p.type === 'approvalRow') out = formatCell(undefined, x);
      else if (typeof x === 'string' && (p.options?.length || p.optionsFrom)) out = optionLabel(d.allOptions(q, p), x);
      else out = formatCell(undefined, x);
    }
    if (!out && (r.sub === 'to' || r.sub === 'from') && (p.type === 'list' || p.type === 'matrix')) {
      const cur2 = local?.rowPart === pk ? local.row : undefined;
      const rows = d.toRows(p, v);
      if (cur2 && r.sub === 'from' && isEmpty(cur2.to)) return '\u0003';
      if (cur2 && r.sub === 'to' && isEmpty(cur2.from)) return '\u0002';
      if (cur2 && rows.length && rows[rows.length - 1]._k === cur2._k) return rows.length === 1 ? '\u0002' : '\u0001';
    }
    if (!out) {
      const fix = ro.resolved?.(rawRef);
      if (fix) { issues.push({ kind: 'empty', desc: rawRef }); return fix; }
      issues.push({ kind: 'empty', desc: rawRef });
    }
    return out;
  }

  /** Leftover bank-style single-brace refs like {GEN-001}: answer if resolvable, else verbatim. */
  function singleBrace(t: string): string {
    if (!t.includes('{')) return t;
    return t.replace(/\{([A-Z]{2,4}-\d{3}[^{}\s]*)\}/g, (m, ref) => {
      const r = parseRef(ref, hasQ);
      if (!hasQ(r.qid) || !d.visibleQuestions.has(r.qid)) return m;
      const q = d.bank.questionById.get(r.qid)!;
      const p = findPart(q, r.part && /^[a-z_]+$/.test(r.part) ? r.part : undefined);
      if (!p) return m;
      const txt = formatPartValue(d, q, p, d.partValue(q, p));
      return txt || m;
    });
  }

  function run(list: SlotNode[]): string {
    let out = '';
    for (const n of list) {
      switch (n.t) {
        case 'text': out += singleBrace(n.v); break;
        case 'Q': out += qText(n.ref); break;
        case 'R': out += n.id; break;
        case 'ITEM': {
          if (!local?.item && !local?.row) { issues.push({ kind: 'missing', desc: 'ITEM' }); break; }
          out += itemText(n.field);
          break;
        }
        case 'ITEMCELL': {
          const r = parseRef(n.ref, hasQ);
          const key = local?.item?.key ?? local?.row?._k;
          const q = d.bank.questionById.get(r.qid);
          const p = findPart(q, r.part);
          if (!q || !p || key === undefined) break;
          const rows = d.toRows(p, d.partValue(q, p));
          const row = rows.find((x) => x._k === key);
          const col = p.columns?.find((c) => c.key === r.sub) || p.columns?.[0];
          const txt = row && col ? formatCell(col, row[col.key], d) : '';
          if (!txt) issues.push({ kind: d.visibleParts.has(`${q.id}#${p.key}`) ? 'empty' : 'dropped', desc: n.ref });
          out += txt;
          break;
        }
        case 'MISSING': {
          if (local?.cell && /عمود الخلية|الوحدة/.test(n.desc) && /الخلية/.test(n.desc)) { out += local.cell.label; break; }
          if (local?.cell && /قيمة الخلية/.test(n.desc)) { out += local.cell.value; break; }
          const fix = ro.resolved?.(n.desc);
          if (fix) { out += fix; issues.push({ kind: 'missing', desc: n.desc }); }
          else { issues.push({ kind: 'missing', desc: n.desc }); out += `〈${n.desc}〉`; }
          break;
        }
        case 'IF':
          if (!n.error && d.evalExpr(n.expr, local)) out += run(n.body);
          break;
        case 'SW': {
          let keys: string[];
          let dk: string | undefined;
          if (n.ref.startsWith('@item')) {
            keys = keysOf(d.value(n.ref, local)).map(String);
          } else {
            const r = parseRef(n.ref, hasQ);
            refs.push(r.qid);
            const q = d.bank.questionById.get(r.qid);
            if (!q) { if (!d.bank.deferredIds.has(r.qid.split('-')[0])) issues.push({ kind: 'unknown_ref', desc: n.ref }); keys = []; }
            else {
              const p = findPart(q, r.part);
              const pk = p ? `${q.id}#${p.key}` : '';
              let v: any = local?.item && local.itemPart === pk && !r.sub ? local.item.key : d.value(n.ref, local);
              if (local?.row && local.rowPart === pk && r.sub) v = local.row[r.sub];
              if (v === true) v = 'yes';
              if (v === false) v = 'no';
              keys = keysOf(v).map(String);
              dk = p?.options?.find((o) => o.dontKnow)?.key;
              const ans = d.ws.answers[q.id];
              if (dk && (ans?.dontKnow || keysOf(ans?.parts?.[p!.key]).includes(dk))) keys = [dk, ...keys];
            }
          }
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

  const text = tiers(run(nodes)).replace(/[ \t]{2,}/g, ' ').replace(/ ([،؛.])/g, '$1').trim();
  return { text, issues, refs };
}

/** STD-GEN-07 / rule 11: the last tier has no upper bound; a single tier applies to any value. */
function tiers(t: string): string {
  if (!/[\u0001\u0002\u0003]/.test(t)) return t;
  return t
    .replace(/(?:أكبر من|من)?\s*\u0003\s*(?:إلى|حتى)?(?:\s+وتشمل)?\s*[\u0001\u0002](?:\s*\S*ريال\S*)?/g, 'أياً كانت قيمته')
    .replace(/(?:من|أكبر من)\s+(\S+)\s+(?:إلى|حتى)(?:\s+وتشمل)?\s*\u0002(?:\s*\S*ريال\S*)?/g, 'أياً كانت قيمته')
    .replace(/(?:من|أكبر من)\s+(\S+)\s+(?:إلى|حتى)(?:\s+وتشمل)?\s*\u0001/g, 'أكبر من $1')
    .replace(/[\u0001\u0002\u0003]/g, '');
}

/** Plain text with all slots removed (for search / previews). */
export function stripSlots(src: string): string {
  return String(src ?? '').replace(/\{\{[^{}]*\}\}/g, '…');
}
