// localStorage repository: rw:index (list) + rw:ws:<id> (one workshop). Saves synchronously.
import type { Workshop } from './types';

export interface IndexEntry { id: string; entityName: string; updatedAt: string; completion: number; lastExportedAt?: string }

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const IDX = 'rw:index';
const WS = (id: string) => `rw:ws:${id}`;

export class Storage {
  constructor(private kv: KV | null) {}

  static browser(): Storage {
    try {
      const ls = globalThis.localStorage;
      const probe = 'rw:probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return new Storage(ls);
    } catch {
      return new Storage(null);
    }
  }

  get available(): boolean {
    return !!this.kv;
  }

  list(): IndexEntry[] {
    if (!this.kv) return [];
    try {
      const v = JSON.parse(this.kv.getItem(IDX) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : [];
    } catch {
      return [];
    }
  }

  load(id: string): Workshop | null {
    if (!this.kv) return null;
    try {
      const raw = this.kv.getItem(WS(id));
      return raw ? (JSON.parse(raw) as Workshop) : null;
    } catch {
      return null;
    }
  }

  /** Throws on failure (quota, private mode) so the caller can alert immediately. */
  save(ws: Workshop, completion: number): void {
    if (!this.kv) throw new Error('storage-unavailable');
    this.kv.setItem(WS(ws.id), JSON.stringify(ws));
    const list = this.list().filter((x) => x.id !== ws.id);
    list.unshift({ id: ws.id, entityName: ws.entityName, updatedAt: ws.updatedAt, completion, lastExportedAt: ws.lastExportedAt });
    this.kv.setItem(IDX, JSON.stringify(list));
  }

  remove(id: string): void {
    if (!this.kv) return;
    this.kv.removeItem(WS(id));
    this.kv.setItem(IDX, JSON.stringify(this.list().filter((x) => x.id !== id)));
  }
}
