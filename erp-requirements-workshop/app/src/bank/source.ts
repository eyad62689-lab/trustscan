// Loads bank-data/*.json as lazy chunks. When the folder has no JSON at build time, the demo
// fixtures are bundled instead and the UI shows a «بيانات تجريبية» banner.
import { mergeBank } from '../engine/load';
import type { Bank } from '../engine/types';

export async function loadBank(): Promise<{ bank: Bank; demo: boolean }> {
  let mods: Record<string, () => Promise<any>>;
  let demo = false;
  if (__HAS_BANK__) {
    mods = import.meta.glob('../../bank-data/*.json');
  } else {
    mods = import.meta.glob('../../test/fixtures/*.json');
    demo = true;
  }
  const entries = await Promise.all(Object.entries(mods).map(async ([k, f]) => [k, (await f()).default] as const));
  const bank = mergeBank(Object.fromEntries(entries));
  if (import.meta.env.DEV) {
    (globalThis as any).__bankReport = bank.report;
    console.groupCollapsed(`[bank] ${bank.version}: ${bank.questions.length} questions, ${bank.report.errors.length} errors, ${bank.report.unresolvedLabels.length} unresolved labels, ${bank.report.textConditions.length} text conditions`);
    console.log(bank.report);
    console.groupEnd();
  }
  return { bank, demo };
}
