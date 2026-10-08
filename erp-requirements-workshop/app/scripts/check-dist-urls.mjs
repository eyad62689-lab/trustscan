#!/usr/bin/env node
// NFR-01: the built app must not fetch anything external. Scans dist/ for http(s) URLs.
// XML namespace identifiers used inside the .docx generator (schemas.openxmlformats.org, w3.org, …)
// are identifiers written into the file, never requested; they are reported separately.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(dist)) { console.error('dist/ not found — run the build first'); process.exit(1); }
const NS = /^https?:\/\/(schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.org|www\.w3\.org|ns\.adobe\.com|schemas\.openxmlformats\.org)\//;
const DOC_STRINGS = /^https?:\/\/(feross\.org|answers\.microsoft\.com|stuk\.github\.io|github\.com|reactjs\.org|preactjs\.com)/; // URLs inside library comments / error messages
const IGNORE_CTX = /(@license|@see|@link|\/\*!|license|github\.com\/[^ ]+\/issues|xmlns)/i;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(dist);
const bad = [];
let ns = 0;
let docs = 0;
for (const f of files) {
  if (!['.js', '.css', '.html', '.json', '.webmanifest', '.svg'].includes(extname(f))) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0];
    if (NS.test(url)) { ns++; continue; }
    if (DOC_STRINGS.test(url)) { docs++; continue; }
    const ctx = text.slice(Math.max(0, m.index - 80), m.index);
    if (IGNORE_CTX.test(ctx)) continue;
    if (/^http:\/\/www\.w3\.org\/2000\/svg$/.test(url)) { ns++; continue; }
    bad.push(`${f.replace(dist, '')}: ${url}`);
  }
}
console.log(`check-dist-urls: ${files.length} files, ${ns} XML namespace identifiers and ${docs} library documentation links in comments/messages (none are requested).`);
if (bad.length) {
  console.log('URLs found (review — must not be fetched at runtime):');
  for (const b of [...new Set(bad)]) console.log('  ' + b);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
console.log('OK: no external URLs.');
