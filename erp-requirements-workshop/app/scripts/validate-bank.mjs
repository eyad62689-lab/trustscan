#!/usr/bin/env node
// Validates bank-data/*.json (or --dir <folder>). Exit 1 on errors. Never crashes on unknown fields.
// Usage: node scripts/validate-bank.mjs [--dir test/fixtures] [--verbose]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'bank-data';
const verbose = args.includes('--verbose');
const dir = resolve(root, dirArg);
if (!existsSync(dir)) { console.error(`folder not found: ${dir}`); process.exit(1); }

const out = await build({ entryPoints: [join(root, 'src/engine/validate.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const files = {};
let parseErrors = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  try { files[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
  catch (e) { console.log(`ERROR  ${f}: invalid JSON — ${e.message}`); parseErrors++; }
}
if (!Object.keys(files).length) { console.log(`no JSON files in ${dirArg}`); process.exit(parseErrors ? 1 : 0); }

const { bank, findings, counts } = mod.validateBank(files);
console.log(`bank ${bank.version} — ${Object.keys(files).length} files, ${bank.questions.length} questions, ${bank.rules.length} rules, ${bank.conflicts.length} conflicts, ${bank.sections.length} sections\n`);
console.log('file'.padEnd(22) + ['questions', 'parts', 'options', 'templates', 'rules', 'conflicts'].map((h) => h.padStart(10)).join(''));
for (const [f, c] of Object.entries(counts)) console.log(f.padEnd(22) + ['questions', 'parts', 'options', 'templates', 'rules', 'conflicts'].map((h) => String(c[h]).padStart(10)).join(''));
console.log('');
const by = (s) => findings.filter((x) => x.severity === s);
for (const sev of ['error', 'warning', 'info']) {
  const list = by(sev);
  if (!list.length) continue;
  const show = sev === 'info' && !verbose ? list.filter((x) => !/^\{"text"\}|^MISSING/.test(x.detail)).slice(0, 40) : list;
  console.log(`${sev.toUpperCase()} (${list.length})`);
  for (const x of show) console.log(`  ${x.where}: ${x.detail}`);
  if (sev === 'info') {
    const tc = list.filter((x) => x.detail.startsWith('{"text"}')).length;
    const ms = list.filter((x) => x.detail.startsWith('MISSING')).length;
    console.log(`  … ${tc} {"text"} conditions and ${ms} MISSING slots (use --verbose to list)`);
  }
  console.log('');
}
const errors = by('error').length + parseErrors;
console.log(errors ? `FAILED: ${errors} error(s)` : 'OK: no errors');
process.exit(errors ? 1 : 0);
