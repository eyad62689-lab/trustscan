import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBank } from '../src/engine/load';
import type { Bank } from '../src/engine/types';

export function fixtureFiles(): Record<string, unknown> {
  const dir = join(__dirname, 'fixtures');
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) out[f] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return out;
}

export function fixtureBank(): Bank {
  return mergeBank(fixtureFiles());
}
