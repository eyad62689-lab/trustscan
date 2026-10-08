// Format-neutral document model. Markdown and Word are rendered from the same blocks,
// so their textual content is identical (NFR-10).
export type Block =
  | { t: 'title'; text: string }
  | { t: 'h'; level: 1 | 2 | 3 | 4; text: string; id?: string }
  | { t: 'p'; text: string; bold?: boolean }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'toc'; items: { level: number; text: string }[] };

export interface DocModel {
  title: string;
  entity: string;
  date: string;
  fileBase: string;
  blocks: Block[];
}

/** Canonical plain text of the document, used for MD/DOCX parity checks. */
export function docPlainText(m: DocModel): string[] {
  const out: string[] = [];
  for (const b of m.blocks) {
    switch (b.t) {
      case 'title': case 'h': case 'p': out.push(b.text); break;
      case 'ul': case 'ol': out.push(...b.items); break;
      case 'table': out.push(...b.head, ...b.rows.flat()); break;
      case 'code': out.push(...b.text.split('\n')); break;
      case 'toc': out.push(...b.items.map((i) => i.text)); break;
    }
  }
  return out;
}
