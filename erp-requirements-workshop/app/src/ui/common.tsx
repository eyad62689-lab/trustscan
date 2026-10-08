import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { getState } from './store';

type HostDownloads = { save(req: { filename: string; data: Blob | string }): Promise<unknown> };
type HostClaude = { use(name: string): Promise<unknown> };

/** Inside a claude.ai Artifact viewer, files are offered through the host's `downloads` capability; elsewhere a normal browser download. */
export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const host = (window as unknown as { claude?: HostClaude }).claude;
  if (host?.use) {
    host.use('downloads').then((d) => {
      const dl = d as HostDownloads | null;
      if (dl) return dl.save({ filename: name, data: blob });
      browserDownload(name, blob);
    }).catch(() => undefined);
    return;
  }
  browserDownload(name, blob);
}

function browserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Modal dialog on the native <dialog> element; returns focus to the opener on close. */
export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; describedBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (props.open && !el.open) {
      opener.current = document.activeElement;
      el.showModal();
    } else if (!props.open && el.open) {
      el.close();
    }
  }, [props.open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClose = () => {
      props.onClose();
      const o = opener.current as HTMLElement | null;
      if (o && typeof o.focus === 'function') o.focus();
    };
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, [props.onClose]);
  const id = useRef('dlg-' + Math.random().toString(36).slice(2)).current;
  return (
    <dialog ref={ref} class={props.wide ? 'dialog wide' : 'dialog'} aria-labelledby={id} aria-describedby={props.describedBy}>
      {props.open && (
        <div class="dialog-body">
          <div class="dialog-head">
            <h2 id={id}>{props.title}</h2>
            <button type="button" class="btn ghost" onClick={() => ref.current?.close()} aria-label="إغلاق">
              ✕
            </button>
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}

export const DEFAULT_PRIVACY = 'بياناتكم تُحفظ على هذا الجهاز وهذا المتصفح فقط، ولا تُرسل إلى أي جهة. مسح بيانات المتصفح يحذفها نهائياً. صدّروا ملف التقدّم واحتفظوا به.';

export function PrivacyNotice() {
  const text = getState().bank?.exportSpec.privacy || DEFAULT_PRIVACY;
  return (
    <p class="notice privacy" role="note">
      <span aria-hidden="true">🔒 </span>
      {text}
    </p>
  );
}

/** Renders bank text with **bold** and `code` markers as plain text segments (never as HTML). */
export function RichText(props: { text?: string | null; class?: string }) {
  if (!props.text) return null;
  const parts = String(props.text).replace(/〔مصدر[^〕]*〕/g, '').split(/(\*\*[^*]+\*\*)/g);
  return (
    <span class={props.class}>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2).replace(/`/g, '')}</strong> : p.replace(/`/g, '')))}
    </span>
  );
}
