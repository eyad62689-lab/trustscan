// Dates are Gregorian with Latin digits (NFR-07).
const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function isoLocal(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  const off = -x.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${isoDate(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export function hhmm(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${pad(x.getHours())}${pad(x.getMinutes())}`;
}

export function displayDateTime(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${isoDate(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function minutesBetween(a: string, b?: string): number {
  if (!b) return 0;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${r} دقيقة`;
  if (!r) return `${h} ساعة`;
  return `${h} ساعة و${r} دقيقة`;
}

/** Safe file-name fragment (keeps Arabic letters). */
export function safeName(s: string): string {
  return String(s || 'بدون-اسم').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
}
