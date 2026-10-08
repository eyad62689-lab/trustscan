// Reference parsing. Question ids may contain Arabic letters and dots (e.g. "PRF-003.ب"),
// so we split on "#" first; the part key and sub-key are Latin.
//   "QID"                  -> first/main part
//   "QID#part"             -> named part
//   "QID#part.sub"         -> column (list/approvalRow), row key (matrix/list), option key, "other", "<opt>_priority"
//   "QID#part[row].col"    -> cell (row = "row" for current row in forEachRow, a 1-based index, or a row key)

export interface Ref {
  qid: string;
  part?: string;
  sub?: string;
  row?: string;
  raw: string;
}

export function parseRef(raw: string, hasQuestion?: (id: string) => boolean): Ref {
  const s = String(raw).trim();
  const hash = s.indexOf('#');
  if (hash < 0) {
    // Tolerate "QID.part" when QID itself is unknown (bank-style dotted parts).
    if (hasQuestion && !hasQuestion(s)) {
      const dot = s.lastIndexOf('.');
      if (dot > 0 && hasQuestion(s.slice(0, dot))) return { qid: s.slice(0, dot), part: s.slice(dot + 1), raw: s };
    }
    return { qid: s, raw: s };
  }
  const qid = s.slice(0, hash);
  let rest = s.slice(hash + 1);
  let row: string | undefined;
  const br = rest.match(/^([^\[.]+)\[([^\]]*)\](?:\.(.+))?$/);
  // "QID#part.col[last]" (valueFrom style)
  const br2 = rest.match(/^([^\[.]+)\.([^\[.]+)\[([^\]]*)\]$/);
  if (br2) return { qid, part: br2[1], row: br2[3], sub: br2[2], raw: s };
  if (br) {
    return { qid, part: br[1], row: br[2], sub: br[3], raw: s };
  }
  const segs = rest.split('.');
  if (segs.length >= 3) return { qid, part: segs[0], row: segs[1], sub: segs.slice(2).join('.'), raw: s };
  if (segs.length === 2) return { qid, part: segs[0], sub: segs[1], row, raw: s };
  return { qid, part: rest, raw: s };
}

export function refKey(r: Ref): string {
  return r.part ? `${r.qid}#${r.part}` : r.qid;
}
