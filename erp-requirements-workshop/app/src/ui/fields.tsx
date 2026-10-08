// Answer field components (FR-02). All controls have programmatic labels (WCAG 2.2 AA).
import { useState } from 'preact/hooks';
import type { Part, Question, Column, Option } from '../engine/types';
import type { Derived, KeyLabel } from '../engine/compute';
import { isEmpty, keysOf } from '../engine/compute';
import { renderTemplate } from '../engine/slots';

export interface FieldProps {
  q: Question;
  p: Part;
  d: Derived;
  value: any;
  otherText?: string;
  recommended: any;
  onChange: (v: any, otherText?: string) => void;
  idBase: string;
}

const unitText = (d: Derived, u?: string | null) => {
  if (!u) return '';
  if (u.includes('{{')) return renderTemplate(d, u).text;
  return u.replace(/\{([^{}]+)\}/g, (m, id) => {
    const q = d.bank.questionById.get(id);
    if (!q) return m;
    const v = d.partValue(q, q.parts[0]);
    const o = q.parts[0].options?.find((x) => x.key === v);
    return o?.label || m;
  });
};

function RecMark(props: { on: boolean }) {
  return props.on ? (
    <span class="rec-mark" title="الموصى به">
      <span aria-hidden="true">★</span> الموصى به
    </span>
  ) : null;
}

export function SingleField(props: FieldProps) {
  const { q, p, d, value, onChange, idBase } = props;
  const opts = d.visibleOptions(q, p);
  const rec = props.recommended;
  return (
    <div class="options" role="radiogroup" aria-labelledby={`${idBase}-legend`}>
      {opts.map((o) => {
        const id = `${idBase}-${o.key}`;
        const checked = value === o.key;
        return (
          <div class={`option${checked ? ' checked' : ''}`} key={o.key}>
            <input type="radio" id={id} name={idBase} checked={checked} onChange={() => onChange(o.key, o.other ? props.otherText : undefined)} />
            <label for={id}>
              <span>{o.label}</span>
              <RecMark on={rec === o.key} />
              {o.hint && <span class="hint">{o.hint}</span>}
            </label>
            {o.other && checked && (
              <input class="other-text" type="text" aria-label="حدّد" value={props.otherText || ''} maxLength={500} onInput={(e) => onChange(o.key, (e.target as HTMLInputElement).value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MultiField(props: FieldProps & { priority?: boolean }) {
  const { q, p, d, value, onChange, idBase } = props;
  const opts = d.visibleOptions(q, p);
  const priorities = p.priorities?.length ? p.priorities : d.bank.priorities;
  const isObj = props.priority;
  const sel: string[] = keysOf(value);
  const recKeys = keysOf(props.recommended);
  const max = p.max ?? undefined;
  const toggle = (o: Option, on: boolean) => {
    let next = on ? [...sel, o.key] : sel.filter((k) => k !== o.key);
    if (on && (o.exclusive || o.dontKnow)) next = [o.key];
    else if (on) next = next.filter((k) => { const x = opts.find((y) => y.key === k); return !(x?.exclusive || x?.dontKnow); });
    if (isObj) {
      const cur = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const recObj = props.recommended && typeof props.recommended === 'object' && !Array.isArray(props.recommended) ? props.recommended : {};
      const def = o.deferred ? p.deferredDefaultPriority || 'later_phase' : recObj[o.key] || (q.id === d.bank.scopeQid ? p.defaultPriority || d.bank.defaultPriority : d.unitPriority(q.section) || d.bank.defaultPriority);
      onChange(Object.fromEntries(next.map((k) => [k, cur[k] ?? (k === o.key ? def : d.bank.defaultPriority)])), props.otherText);
    } else onChange(next, props.otherText);
  };
  return (
    <div class="options" role="group" aria-labelledby={`${idBase}-legend`}>
      {max ? <p class="hint">اختر حتى {max}.</p> : null}
      {opts.map((o) => {
        const id = `${idBase}-${o.key}`;
        const checked = sel.includes(o.key);
        const disabled = !checked && !!max && sel.length >= max && !o.dontKnow;
        return (
          <div class={`option${checked ? ' checked' : ''}${o.deferred ? ' deferred' : ''}`} key={o.key}>
            <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={(e) => toggle(o, (e.target as HTMLInputElement).checked)} />
            <label for={id}>
              <span>{o.label}</span>
              {o.module && <span class="tag">{o.module}</span>}
              {o.deferred && <span class="tag later">في إصدار لاحق — تُجمع متطلباتها لاحقاً</span>}
              <RecMark on={recKeys.includes(o.key)} />
              {o.desc && <span class="hint">{o.desc}</span>}
              {o.hint && <span class="hint">{o.hint}</span>}
            </label>
            {isObj && checked && !o.dontKnow && (
              <select aria-label={`أولوية ${o.label}`} value={value?.[o.key] || ''} onChange={(e) => onChange({ ...value, [o.key]: (e.target as HTMLSelectElement).value || null }, props.otherText)}>
                <option value="">— الأولوية —</option>
                {priorities.map((pr) => (
                  <option value={pr.key} key={pr.key}>{pr.label}</option>
                ))}
              </select>
            )}
            {o.other && checked && (
              <input class="other-text" type="text" aria-label="حدّد" value={props.otherText || ''} maxLength={500} onInput={(e) => onChange(value, (e.target as HTMLInputElement).value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NumberField(props: FieldProps) {
  const { p, d, value, onChange, idBase } = props;
  const [err, setErr] = useState('');
  const unit = unitText(d, p.unit);
  return (
    <div class="number-field">
      <input
        id={`${idBase}-input`}
        type="number"
        inputMode="decimal"
        aria-labelledby={`${idBase}-legend`}
        aria-describedby={err ? `${idBase}-err` : undefined}
        aria-invalid={err ? 'true' : undefined}
        min={p.min ?? undefined}
        max={p.maxValue ?? undefined}
        value={value ?? ''}
        placeholder={props.recommended !== undefined && props.recommended !== null ? `الموصى به: ${props.recommended}` : ''}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          if (raw === '') { setErr(''); onChange(undefined); return; }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          let msg = '';
          if (p.min !== null && p.min !== undefined && n < p.min) msg = `أقل قيمة مقبولة ${p.min}.`;
          if (p.maxValue !== null && p.maxValue !== undefined && n > p.maxValue) msg = `أكبر قيمة مقبولة ${p.maxValue}.`;
          if (p.rangeFrom) {
            const v = d.value(p.rangeFrom.ref);
            const r = p.rangeFrom.ranges?.[v];
            if (r && (n < r[0] || (r[1] !== null && n > r[1]))) msg = `القيمة خارج النطاق المختار سابقاً (${r[0]}${r[1] !== null ? `–${r[1]}` : ' فأكثر'}).`;
          }
          setErr(msg);
          onChange(n);
        }}
      />
      {unit && <span class="unit">{unit}</span>}
      {err && <p id={`${idBase}-err`} class="field-error" role="alert">{err}</p>}
    </div>
  );
}

export function TextField(props: FieldProps & { long?: boolean }) {
  const { value, onChange, idBase, p } = props;
  return props.long ? (
    <textarea id={`${idBase}-input`} aria-labelledby={`${idBase}-legend`} rows={4} maxLength={10000} value={value ?? ''} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />
  ) : (
    <input id={`${idBase}-input`} type={p.inputType === 'time' ? 'time' : 'text'} aria-labelledby={`${idBase}-legend`} maxLength={1000} value={value ?? ''} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
  );
}

// ---------- cells ----------
function CellEditor(props: { d: Derived; col: Column; value: any; onChange: (v: any) => void; label: string; readOnly?: boolean }) {
  const { d, col, value, onChange, label } = props;
  if (props.readOnly || col.readOnly) return <span class="cell-ro">{typeof value === 'string' ? value : Array.isArray(value) ? value.join('، ') : String(value ?? '')}</span>;
  const opts: KeyLabel[] = col.type === 'role' || col.type === 'branch' || col.optionsFrom || col.rowsFrom ? d.columnOptions(col) : (col.options || []).filter((o) => o.condition === undefined || o.condition === null || d.evalExpr(o.condition));
  const multiple = col.type === 'multi' || col.multiple;
  if (col.type === 'bool' && !(col.options && col.options.length)) {
    return <input type="checkbox" aria-label={label} checked={value === true || value === 'yes'} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />;
  }
  if (col.type === 'bool') {
    const v = value === true ? 'yes' : value === false ? 'no' : value;
    return (
      <select aria-label={label} value={v ?? ''} onChange={(e) => { const x = (e.target as HTMLSelectElement).value; onChange(x === 'yes' ? true : x === 'no' ? false : x || null); }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    );
  }
  if (opts.length || col.type === 'role' || col.type === 'branch' || col.type === 'single') {
    // role values may be stored as Arabic labels in older recommendations: map to keys
    const norm = (x: any) => opts.find((o) => o.key === x)?.key ?? opts.find((o) => o.label === x)?.key ?? x;
    if (multiple) {
      const sel = (Array.isArray(value) ? value : isEmpty(value) ? [] : typeof value === 'string' && !opts.some((o) => o.key === value || o.label === value) ? value.split(/،\s*|,\s*/) : [value]).map(norm);
      return (
        <fieldset class="cell-multi">
          <legend class="sr-only">{label}</legend>
          {opts.map((o) => (
            <label key={o.key} class="chip">
              <input type="checkbox" checked={sel.includes(o.key)} onChange={(e) => onChange((e.target as HTMLInputElement).checked ? [...sel, o.key] : sel.filter((k: string) => k !== o.key))} />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    const v = norm(value);
    const known = opts.some((o) => o.key === v);
    return (
      <select aria-label={label} value={v ?? ''} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}>
        <option value="">—</option>
        {!known && !isEmpty(v) && <option value={String(v)}>{String(v)}</option>}
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    );
  }
  if (col.type === 'number') {
    return <input type="number" aria-label={label} value={value ?? ''} min={col.min ?? undefined} onInput={(e) => { const r = (e.target as HTMLInputElement).value; onChange(r === '' ? null : Number(r)); }} />;
  }
  const shown = typeof value === 'string' && value.includes('{{') ? renderTemplate(d, value).text : value ?? '';
  return <input type="text" aria-label={label} value={shown} maxLength={1000} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />;
}

export function ListField(props: FieldProps & { onConfirm?: () => void; touched: boolean }) {
  const { q, p, d, onChange, idBase } = props;
  const rows: any[] = d.listRows(q, p);
  const cols = d.visibleColumns(p);
  const fixed = !!(p.fixedRows || p.rowsFixed || p.rowsFrom || p.type === 'matrix');
  const setCell = (i: number, key: string, v: any) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const rowLabel = (r: any, i: number) => r._label ?? r[cols[0]?.key] ?? `${i + 1}`;
  return (
    <div class="list-field">
      <table class="list-table">
        <caption class="sr-only">{p.label || q.title}</caption>
        <thead>
          <tr>
            {p.type === 'matrix' && <th scope="col">البند</th>}
            {cols.map((c) => <th scope="col" key={c.key}>{c.label}</th>)}
            {!fixed && <th scope="col"><span class="sr-only">إجراء</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r._k ?? i}>
              {p.type === 'matrix' && <th scope="row">{r._label ?? r._k}</th>}
              {cols.map((c) => (
                <td key={c.key} data-label={c.label}>
                  <CellEditor d={d} col={c} value={r[c.key]} label={`${c.label} — ${rowLabel(r, i)}`} readOnly={fixed && c.key === (p.rowsFromColumn || '') } onChange={(v) => setCell(i, c.key, v)} />
                </td>
              ))}
              {!fixed && (
                <td>
                  <button type="button" class="btn ghost small" aria-label={`حذف الصف ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>حذف</button>
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={cols.length + 2} class="hint">لا صفوف بعد.</td></tr>
          )}
        </tbody>
      </table>
      <div class="row-actions">
        {!fixed && (
          <button type="button" class="btn secondary" onClick={() => onChange([...rows, { _k: `r${Date.now().toString(36)}` }])}>+ إضافة صف</button>
        )}
        {!props.touched && rows.length > 0 && props.onConfirm && (
          <button type="button" class="btn secondary" onClick={props.onConfirm}>أؤكد الصفوف كما هي</button>
        )}
      </div>
    </div>
  );
}

export function ApprovalRowField(props: FieldProps) {
  const { p, d, value, onChange } = props;
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cols = d.visibleColumns(p);
  return (
    <div class="approval-row">
      {p.conditionLabel && <p class="hint">{p.conditionLabel}</p>}
      {cols.map((c) => (
        <div class="approval-cell" key={c.key}>
          <span class="cell-label" aria-hidden="true">{c.label}</span>
          <CellEditor d={d} col={c} value={v[c.key]} label={c.label} onChange={(x) => onChange({ ...v, [c.key]: x })} />
        </div>
      ))}
    </div>
  );
}

export function LogoField(props: FieldProps) {
  const { value, onChange, idBase } = props;
  const [err, setErr] = useState('');
  return (
    <div class="logo-field">
      <input
        id={`${idBase}-input`}
        type="file"
        accept="image/png,image/jpeg"
        aria-labelledby={`${idBase}-legend`}
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr('يُقبل PNG أو JPEG فقط.');
          if (f.size > 1024 * 1024) return setErr('حجم الصورة يتجاوز 1 ميجابايت.');
          const r = new FileReader();
          r.onload = () => { setErr(''); onChange(String(r.result)); };
          r.readAsDataURL(f);
        }}
      />
      {err && <p class="field-error" role="alert">{err}</p>}
      {typeof value === 'string' && /^data:image\/(png|jpeg);base64,/.test(value) && (
        <div class="logo-preview">
          <img src={value} alt="الشعار المرفوع" />
          <button type="button" class="btn ghost small" onClick={() => onChange(undefined)}>إزالة الشعار</button>
        </div>
      )}
    </div>
  );
}
