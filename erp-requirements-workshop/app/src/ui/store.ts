// Minimal global store. Every workshop mutation: derive → archive diff toast → synchronous save.
import { useEffect, useState } from 'preact/hooks';
import type { Bank, Workshop } from '../engine/types';
import { derive, type Derived } from '../engine/compute';
import { Storage, type IndexEntry } from '../engine/storage';
import { completion } from '../engine/time';

export type Screen = 'start' | 'workspace' | 'review' | 'export';

export interface Toast { id: number; text: string; kind?: 'info' | 'error' }

export interface AppState {
  bank: Bank | null;
  demo: boolean;
  loadError?: string;
  screen: Screen;
  ws: Workshop | null;
  d: Derived | null;
  sectionId?: string;
  focusQid?: string;
  save: { ok: boolean; at?: number; error?: string };
  presentation: boolean;
  guideOpen: boolean;
  toasts: Toast[];
  list: IndexEntry[];
  storageOk: boolean;
  dirtySinceExport: boolean;
}

const storage = Storage.browser();
let state: AppState = {
  bank: null,
  demo: false,
  screen: 'start',
  ws: null,
  d: null,
  save: { ok: true },
  presentation: false,
  guideOpen: false,
  toasts: [],
  list: storage.list(),
  storageOk: storage.available,
  dirtySinceExport: false,
};
const listeners = new Set<() => void>();
let toastSeq = 1;

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useStore(): AppState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: toastSeq++, text, kind };
  setState({ toasts: [...state.toasts, t] });
  setTimeout(() => setState({ toasts: state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 12000 : 6000);
}

function persist(ws: Workshop, d: Derived) {
  try {
    storage.save(ws, completion(d));
    setState({ save: { ok: true, at: Date.now() }, list: storage.list() });
  } catch (e) {
    setState({ save: { ok: false, error: 'تعذّر الحفظ على هذا الجهاز (قد تكون مساحة المتصفح ممتلئة أو التصفح خاصاً). صدّروا ملف التقدّم الآن حتى لا تفقدوا العمل.' } });
  }
}

/** Apply a workshop mutation. */
export function mutate(fn: (ws: Workshop, bank: Bank) => Workshop) {
  const { ws, bank, d: before } = state;
  if (!ws || !bank) return;
  const next = fn(ws, bank);
  if (next === ws) return;
  const d = derive(bank, next);
  const prevArchived = new Set(before?.archived || []);
  const newlyArchived = d.archived.filter((q) => !prevArchived.has(q));
  const restored = [...prevArchived].filter((q) => !d.archived.includes(q));
  setState({ ws: next, d, dirtySinceExport: true });
  persist(next, d);
  if (newlyArchived.length) toast(`أُخفيت ${newlyArchived.length} ${newlyArchived.length === 1 ? 'إجابة' : 'إجابات'} بسبب هذا التعديل، وحُفظت مؤرشفة وتعود إن عادت الإجابة.`);
  if (restored.length) toast(`أُعيدت ${restored.length} ${restored.length === 1 ? 'إجابة مؤرشفة' : 'إجابات مؤرشفة'}.`);
}

export function openWorkshop(ws: Workshop, screen: Screen = 'workspace') {
  const bank = state.bank!;
  const d = derive(bank, ws);
  const firstVisible = bank.sections.find((s) => d.visibleSections.has(s.id))?.id;
  const sectionId = ws.lastSection && d.visibleSections.has(ws.lastSection) ? ws.lastSection : firstVisible;
  setState({ ws, d, screen, sectionId, focusQid: ws.lastQuestion, dirtySinceExport: false });
  persist(ws, d);
}

export function closeWorkshop() {
  setState({ ws: null, d: null, screen: 'start', presentation: false, list: storage.list() });
}

export function loadStored(id: string): Workshop | null {
  return storage.load(id);
}

export function removeStored(id: string) {
  storage.remove(id);
  setState({ list: storage.list() });
}

export function saveImported(ws: Workshop) {
  const d = derive(state.bank!, ws);
  try {
    storage.save(ws, completion(d));
  } catch {
    /* surfaced on open */
  }
  setState({ list: storage.list() });
}

export function markExported() {
  const ws = state.ws;
  if (!ws) return;
  const next = { ...ws, lastExportedAt: new Date().toISOString() };
  setState({ ws: next, dirtySinceExport: false });
  if (state.d) persist(next, state.d);
}

export function goSection(sectionId: string, focusQid?: string) {
  setState({ sectionId, focusQid, screen: 'workspace' });
  const ws = state.ws;
  if (ws && ws.lastSection !== sectionId) {
    const next = { ...ws, lastSection: sectionId };
    setState({ ws: next });
    if (state.d) persist(next, state.d);
  }
}
