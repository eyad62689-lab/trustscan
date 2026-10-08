import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..');
const run = (dir: string) => {
  try {
    return { code: 0, out: execFileSync('node', ['scripts/validate-bank.mjs', '--dir', dir], { cwd: root, encoding: 'utf8' }) };
  } catch (e: any) {
    return { code: e.status as number, out: String(e.stdout) };
  }
};

describe('validate-bank.mjs', () => {
  it('passes on the fixtures', () => {
    const r = run('test/fixtures');
    expect(r.code).toBe(0);
    expect(r.out).toContain('OK: no errors');
  });
  it('fails on a broken copy (unknown option key, bad slot, provenance tag, bad JSON)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-bank-'));
    for (const f of readdirSync(join(root, 'test/fixtures'))) writeFileSync(join(dir, f), readFileSync(join(root, 'test/fixtures', f)));
    const sal = JSON.parse(readFileSync(join(dir, 'sal.json'), 'utf8'));
    sal.questions[0].condition = { eq: ['PRF-003', 'no_such_key'] };
    sal.questions[0].templates[0].text = 'يجب {{Q:NOPE-001}} {{IF:{bad json}|x}} 〔مصدر: x〕';
    sal.questions[0].unknownField = 1;
    writeFileSync(join(dir, 'sal.json'), JSON.stringify(sal));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('unknown option no_such_key');
    expect(r.out).toContain('unknown question NOPE-001');
    expect(r.out).toContain('bad IF JSON');
    expect(r.out).toContain('provenance tag');
    expect(r.out).toContain('invalid JSON');
    expect(r.out).toContain('unknownField');
  });
});
