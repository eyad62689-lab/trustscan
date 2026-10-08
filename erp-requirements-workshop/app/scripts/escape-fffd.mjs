// Replace literal U+FFFD in built JS with the � escape (same runtime value); some hosts reject raw U+FFFD in uploads.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../dist/assets/', import.meta.url);
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const p = new URL(f, dir); const t = readFileSync(p, 'utf8');
  if (t.includes('�')) writeFileSync(p, t.replaceAll('�', '\\ufffd'));
}
