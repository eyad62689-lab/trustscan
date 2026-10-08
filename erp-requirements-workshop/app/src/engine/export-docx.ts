// DocModel → .docx (loaded lazily). RTL paragraphs (bidi), RTL tables, complex-script font and
// size, header with entity + date, page numbers, static table of contents, YAML as LTR monospace.
import type { DocModel, Block } from './docmodel';

const FONT = 'Arial';
const MONO = 'Consolas';

export async function toDocx(m: DocModel): Promise<Blob> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, Header, Footer, PageNumber, HeadingLevel, ShadingType } = docx;

  const run = (text: string, o: { bold?: boolean; size?: number; mono?: boolean } = {}) =>
    new TextRun({
      text,
      bold: o.bold,
      boldComplexScript: o.bold,
      size: o.size ?? 22,
      sizeComplexScript: o.size ?? 22,
      rightToLeft: !o.mono,
      font: o.mono ? { ascii: MONO, hAnsi: MONO, cs: MONO } : { ascii: FONT, hAnsi: FONT, cs: FONT },
    });

  const para = (text: string, o: { bold?: boolean; size?: number; heading?: any; spacingAfter?: number } = {}) =>
    new Paragraph({
      bidirectional: true,
      heading: o.heading,
      spacing: { after: o.spacingAfter ?? 120 },
      children: [run(text, o)],
    });

  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

  const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const SIZES = [32, 28, 24, 22];

  const children: any[] = [];
  const add = (b: Block) => {
    switch (b.t) {
      case 'title':
        children.push(new Paragraph({ bidirectional: true, heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [run(b.text, { bold: true, size: 40 })] }));
        break;
      case 'h':
        children.push(para(b.text, { bold: true, size: SIZES[b.level - 1], heading: HEAD[b.level - 1], spacingAfter: 160 }));
        break;
      case 'p':
        for (const line of b.text.split('\n')) children.push(para(line, { bold: b.bold }));
        break;
      case 'ul':
        for (const it of b.items) children.push(new Paragraph({ bidirectional: true, bullet: { level: 0 }, spacing: { after: 60 }, children: [run(it)] }));
        break;
      case 'ol':
        b.items.forEach((it, i) => children.push(para(`${i + 1}. ${it}`)));
        break;
      case 'toc':
        for (const it of b.items) children.push(new Paragraph({ bidirectional: true, indent: { start: (it.level - 1) * 360 }, spacing: { after: 40 }, children: [run(it.text)] }));
        break;
      case 'table': {
        const cols = b.head.length;
        const mk = (cells: string[], header: boolean) =>
          new TableRow({
            tableHeader: header,
            cantSplit: false,
            children: cells.map(
              (c) =>
                new TableCell({
                  shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7EEF1' } : undefined,
                  children: String(c ?? '').split('\n').map((line) => para(line, { bold: header, size: 20, spacingAfter: 40 })),
                }),
            ),
          });
        children.push(
          new Table({
            visuallyRightToLeft: true,
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders,
            rows: [mk(b.head, true), ...b.rows.map((r) => mk(r.length === cols ? r : [...r, ...Array(Math.max(0, cols - r.length)).fill('')].slice(0, cols), false))],
          }),
        );
        children.push(para('', { spacingAfter: 120 }));
        break;
      }
      case 'code':
        for (const line of b.text.split('\n'))
          children.push(new Paragraph({ bidirectional: false, spacing: { after: 0 }, children: [run(line, { mono: true, size: 18 })] }));
        break;
    }
  };
  for (const b of m.blocks) add(b);

  const doc = new Document({
    creator: 'ورشة المتطلبات',
    title: m.title,
    styles: { default: { document: { run: { font: FONT, size: 22, rightToLeft: true } as any, paragraph: { } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        headers: { default: new Header({ children: [new Paragraph({ bidirectional: true, children: [run(`${m.entity} — ${m.date}`, { size: 18 })] })] }) },
        footers: {
          default: new Footer({
            children: [new Paragraph({ bidirectional: true, children: [new TextRun({ children: ['صفحة ', PageNumber.CURRENT, ' من ', PageNumber.TOTAL_PAGES], size: 18, sizeComplexScript: 18, rightToLeft: true, font: { ascii: FONT, hAnsi: FONT, cs: FONT } })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
