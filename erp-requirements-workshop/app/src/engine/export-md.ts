// DocModel → Markdown (GitHub / VS Code preview). User text is escaped so it cannot inject markup.
import type { DocModel } from './docmodel';

export function mdEscape(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_#\[\]|<>])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

function mdInline(s: string): string {
  // keep line structure for paragraphs, escape markup characters
  return String(s ?? '').split(/\r?\n/).map((l) => mdEscape(l)).join('  \n');
}

export function toMarkdown(m: DocModel): string {
  const out: string[] = [];
  for (const b of m.blocks) {
    switch (b.t) {
      case 'title': out.push(`# ${mdEscape(b.text)}`, ''); break;
      case 'h': out.push(`${'#'.repeat(Math.min(6, b.level + 1))} ${mdEscape(b.text)}`, ''); break;
      case 'p': out.push(mdInline(b.text), ''); break;
      case 'ul': out.push(...b.items.map((i) => `- ${mdEscape(i)}`), ''); break;
      case 'ol': out.push(...b.items.map((i, n) => `${n + 1}. ${mdEscape(i)}`), ''); break;
      case 'toc': out.push(...b.items.map((i) => `${'  '.repeat(i.level - 1)}- ${mdEscape(i.text)}`), ''); break;
      case 'table': {
        out.push(`| ${b.head.map(mdEscape).join(' | ')} |`);
        out.push(`|${b.head.map(() => '---').join('|')}|`);
        for (const r of b.rows) out.push(`| ${r.map(mdEscape).join(' | ')} |`);
        out.push('');
        break;
      }
      case 'code': {
        const fence = b.text.includes('```') ? '~~~~' : '```';
        out.push(fence + b.lang, b.text, fence, '');
        break;
      }
    }
  }
  return out.join('\n');
}

/** Markdown → plain text (used by the parity test). Code fences are kept verbatim. */
export function mdToPlain(md: string): string {
  const out: string[] = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (/^(```|~~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) { out.push(line); continue; }
    if (/^\|?(-{3}\|?)+$/.test(line)) continue;
    const t = /^#/.test(line) ? line.replace(/^#+\s*/, '') : line.replace(/^\s*(-|\d+\.)\s+/, '');
    out.push(t.replace(/\\([\\`*_#\[\]|<>])/g, '$1'));
  }
  return out.join('\n');
}
