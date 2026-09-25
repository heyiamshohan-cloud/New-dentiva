import React, { useEffect, useRef } from 'react';
import { IconClose, IconWarning } from '../icons';

/* --------------------------------------------------------- toast system */
export type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
let pushToastGlobal: (t: Omit<Toast, 'id'>) => void = () => {};

export const toast = {
  success: (text: string) => pushToastGlobal({ kind: 'success', text }),
  error: (text: string) => pushToastGlobal({ kind: 'error', text }),
  info: (text: string) => pushToastGlobal({ kind: 'info', text })
};

export function ToastHost() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    let next = 1;
    pushToastGlobal = (t) => {
      const id = next++;
      setToasts((cur) => [...cur, { ...t, id }]);
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 4500);
    };
    return () => { pushToastGlobal = () => {}; };
  }, []);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

/* -------------------------------------------------------------- buttons */
export const Button: React.FC<{
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'danger-soft' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  'aria-label'?: string;
}> = ({ variant = 'secondary', size = 'md', loading, busy, disabled, type = 'button', onClick, children, icon, title, ...rest }) => (
  <button
    type={type}
    title={title}
    className={`btn ${variant} ${size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''}`}
    disabled={disabled || loading || busy}
    onClick={onClick}
    {...(rest as Record<string, unknown>)}
  >
    {loading || busy ? <span className="spin" aria-hidden /> : icon}
    {children}
  </button>
);

/* ---------------------------------------------------------------- badge */
export const Badge: React.FC<{ tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span className={`badge ${tone}`}>{children}</span>
);

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  scheduled: 'info', confirmed: 'info', arrived: 'warning', in_progress: 'warning',
  completed: 'success', cancelled: 'danger', no_show: 'danger',
  waiting: 'warning', called: 'info', skipped: 'danger',
  issued: 'danger', partially_paid: 'warning', paid: 'success', void: 'neutral', draft: 'neutral',
  pending: 'warning', proposed: 'info', accepted: 'success', active: 'success', inactive: 'neutral'
};
export const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>
);

/* ------------------------------------------------------------ form bits */
export const Field: React.FC<{ label: string; required?: boolean; error?: string; helper?: string; hint?: string; width?: 2 | 3 | 4 | 5 | 6 | 8 | 12; children: React.ReactNode }> = ({ label, required, error, helper, hint, width = 6, children }) => (
  <div className={`field w${width}`}>
    <label>{label}{required && <span className="req">*</span>}</label>
    {children}
    {error ? <span className="error-text" role="alert">{error}</span> : (helper ?? hint) ? <span className="helper">{helper ?? hint}</span> : null}
  </div>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ invalid, ...props }, ref) => <input ref={ref} className={`input${invalid ? ' invalid' : ''}`} {...props} />
);
Input.displayName = 'Input';

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }> = ({ invalid, children, ...props }) => (
  <select className={`select${invalid ? ' invalid' : ''}`} {...props}>{children}</select>
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => <textarea className="textarea" {...props} />;

/* --------------------------------------------------------------- dialog */
export function Dialog(props: {
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, select, textarea, button.btn.primary')?.focus(); }, []);
  const sizeClass = props.size === 'lg' || props.size === 'xl' ? props.size : '';
  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={`dialog ${sizeClass}`.trim()} role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <div className="dlg-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close dialog"><IconClose size={16} /></button>
        </div>
        <div className="dlg-body">{props.children}</div>
        {props.footer && <div className="dlg-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = React.useState('');
  const blocked = props.requireText ? typed.trim().toLowerCase() !== props.requireText.toLowerCase() : false;
  return (
    <Dialog title={props.title} onClose={props.onCancel} footer={
      <>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant={props.danger ? 'danger' : 'primary'} loading={props.loading} disabled={blocked} onClick={props.onConfirm}>
          {props.confirmLabel ?? 'Confirm'}
        </Button>
      </>
    }>
      <div style={{ display: 'flex', gap: 10 }}>
        {props.danger && <span style={{ color: 'var(--danger)', flex: '0 0 auto' }}><IconWarning size={20} /></span>}
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--text-1)', lineHeight: 1.5 }}>{props.message}</div>
      </div>
      {props.requireText && (
        <div style={{ marginTop: 12 }}>
          <Field label={`Type "${props.requireText}" to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- table */
export function DataTable<T>(props: {
  columns: Array<{ key: string; label: React.ReactNode; num?: boolean; render?: (row: T) => React.ReactNode }>;
  rows: T[];
  dense?: boolean;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  rowKey: (row: T, index: number) => string | number;
}) {
  if (props.rows.length === 0 && props.empty) {
    return <div className="table-wrap"><div className="empty">{props.empty}</div></div>;
  }
  return (
    <div className="table-wrap">
      <table className={`data${props.dense ? ' dense' : ''}`}>
        <thead><tr>{props.columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={props.rowKey(row, i)} className={props.onRowClick ? 'clickable' : ''} onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
              tabIndex={props.onRowClick ? 0 : undefined}
              onKeyDown={props.onRowClick ? (e) => { if (e.key === 'Enter') props.onRowClick!(row); } : undefined}>
              {props.columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination(props: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <div className="table-foot">
      <span className="tabular">{props.total.toLocaleString()} record{props.total === 1 ? '' : 's'} · page {props.page} of {pages}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>Previous</Button>
        <Button size="sm" disabled={props.page >= pages} onClick={() => props.onPage(props.page + 1)}>Next</Button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- empty state */
export const Empty: React.FC<{ icon?: React.ReactNode; title: string; hint: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="empty">
    {icon}
    <h3>{title}</h3>
    <p>{hint}</p>
    {action}
  </div>
);

/* ------------------------------------------------------------- stat card */
const STAT_TONE_ALIAS: Record<string, string> = { warning: 'warn', danger: 'bad', success: 'good', default: '' };
export const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'accent' | 'warn' | 'bad' | 'good' | 'warning' | 'danger' | 'success' | 'default'; sub?: React.ReactNode; money?: boolean }> = ({ label, value, tone, sub, money }) => (
  <div className={`stat ${tone ? (STAT_TONE_ALIAS[tone] ?? tone) : ''}`}>
    <div className="label">{label}</div>
    <div className={`value${money ? ' money' : ''}`}>{value}</div>
    {sub && <div className="trend muted">{sub}</div>}
  </div>
);

/* --------------------------------------------------------------- tabs */
export function Tabs(props: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={props.active === t.id} className={props.active === t.id ? 'active' : ''} onClick={() => props.onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- dropdown */
export function Dropdown(props: { trigger: React.ReactNode; align?: 'left' | 'right'; width?: number; children: React.ReactNode; open: boolean; onToggle: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) props.onToggle(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onToggle(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [props, props.open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <span onClick={() => props.onToggle(!props.open)}>{props.trigger}</span>
      {props.open && (
        <div className="menu" style={{ [props.align === 'right' ? 'right' : 'left']: 0, top: 'calc(100% + 4px)', width: props.width }}>
          {props.children}
        </div>
      )}
    </div>
  );
}

export const Money: React.FC<{ value: number | null | undefined; signed?: boolean; symbol?: string }> = ({ value, signed, symbol = '৳' }) => {
  const v = value ?? 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cls = signed ? (neg ? 'money neg' : v > 0 ? 'money pos' : 'money') : 'money';
  return <span className={cls}>{neg ? '−' : ''}{symbol}{whole}.{String(abs % 100).padStart(2, '0')}</span>;
};

export { useDebounce };
function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
