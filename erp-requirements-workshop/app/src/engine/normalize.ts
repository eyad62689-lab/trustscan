// Arabic text normalisation used for label matching and search.
const HARAKAT = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const QUOTES = /[«»"“”'‘’()（）\[\]]/g;

export function normAr(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(HARAKAT, '')
    .replace(TATWEEL, '')
    .replace(QUOTES, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[–—-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
