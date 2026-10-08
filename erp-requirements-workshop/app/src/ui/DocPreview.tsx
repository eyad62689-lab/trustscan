import type { DocModel } from '../engine/docmodel';

/** Renders the DocModel as text-only DOM (no innerHTML). */
export function DocPreview(props: { doc: DocModel }) {
  return (
    <div class="doc-preview">
      {props.doc.blocks.map((b, i) => {
        switch (b.t) {
          case 'title': return <h1 key={i}>{b.text}</h1>;
          case 'h': {
            const H = (['h2', 'h3', 'h4', 'h5'] as const)[b.level - 1];
            return <H key={i}>{b.text}</H>;
          }
          case 'p': return <p key={i}>{b.text}</p>;
          case 'ul': return <ul key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>;
          case 'ol': return <ol key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>;
          case 'toc': return <ul key={i} class="toc">{b.items.map((x, j) => <li key={j} class={`toc-${x.level}`}>{x.text}</li>)}</ul>;
          case 'table':
            return (
              <div class="table-wrap" key={i}>
                <table>
                  <thead><tr>{b.head.map((h, j) => <th scope="col" key={j}>{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          case 'code': return <pre key={i} dir="ltr" class="code">{b.text}</pre>;
        }
      })}
    </div>
  );
}
