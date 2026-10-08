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
  if (br) {
    return { qid, part: br[1], row: br[2], sub: br[3], raw: s };
  }
  const dot = rest.indexOf('.');
  if (dot >= 0) return { qid, part: rest.slice(0, dot), sub: rest.slice(dot + 1), row, raw: s };
  return { qid, part: rest, raw: s };
}

export function refKey(r: Ref): string {
  return r.part ? `${r.qid}#${r.part}` : r.qid;
}
