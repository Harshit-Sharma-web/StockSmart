import { AlertCircle, Archive, Box, ChevronLeft, ChevronRight, Layers3, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import type { Page } from '../api/types';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span className="brand-mark"><Layers3 size={23} /></span>{!compact && <strong>Stock<span>Smart</span></strong>}</span>;
}
export function Header({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}
export function Issue({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="issue" role="alert"><AlertCircle size={18} /><span>{errorMessage(error)}</span>{retry && <button className="button small" onClick={retry}>Retry</button>}</div>;
}
export function Empty({ title = 'No results found', detail = 'New records will appear here.' }: { title?: string; detail?: string }) {
  return <div className="empty"><span><Archive size={24} /></span><strong>{title}</strong><p>{detail}</p></div>;
}
export function Loading({ label = 'Loading data' }: { label?: string }) {
  return <div className="loading" role="status" aria-label={label}>{[1, 2, 3].map((key) => <div key={key} />)}</div>;
}
export function Badge({ value }: { value: unknown }) {
  const text = typeof value === 'boolean' ? value ? 'active' : 'inactive' : String(value ?? '');
  return <span className={'badge badge-' + text}>{text.replaceAll('_', ' ') || '—'}</span>;
}
export function format(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat().format(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
export function ProductPhoto({ src, alt }: { src?: string; alt?: string }) {
  return <div className="product-photo">{src ? <img src={src} alt={alt || ''} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}<Box aria-hidden size={32} /></div>;
}
export function Pager({ data, page, setPage }: { data: Page<unknown>; page: number; setPage: (page: number) => void }) {
  if (!data.count) return null;
  return <div className="pagination"><span>{data.count.toLocaleString()} records · Page {page}</span><div>
    <button className="button small icon" type="button" aria-label="Previous page" disabled={!data.previous} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button>
    <button className="button small icon" type="button" aria-label="Next page" disabled={!data.next} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button>
  </div></div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  function close() {
    if (!ref.current?.querySelector('form[aria-busy="true"]')) onClose();
  }
  return <dialog ref={ref} aria-label={title} className="modal" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === ref.current) close(); }}>
    <div className="modal-body"><div className="modal-header"><h2>{title}</h2><button className="button icon" onClick={close} aria-label="Close dialog"><X size={18} /></button></div>{children}</div>
  </dialog>;
}
export function Missing({ denied = false }: { denied?: boolean }) {
  return <main className="missing"><Brand /><h1>{denied ? 'Access restricted' : 'Page not found'}</h1><p>{denied ? 'Your account does not have access to this workspace.' : 'The requested page could not be found.'}</p><Link className="button primary" to="/">Back to StockSmart</Link></main>;
}
