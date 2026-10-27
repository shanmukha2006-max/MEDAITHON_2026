import { X, Star, Inbox, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import { STATUS_LABEL } from '../data/actions.js';

export const Card = ({ title, sub, actions, children, className = '', bodyClass = '' }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <div className="card-head">
        <div>{title && <h2>{title}</h2>}{sub && <div className="sub">{sub}</div>}</div>
        {actions && <div className="row">{actions}</div>}
      </div>
    )}
    <div className={`card-body ${bodyClass}`}>{children}</div>
  </section>
);

export const Badge = ({ tone = 'neutral', children, title }) => <span className={`badge ${tone}`} title={title}>{children}</span>;
export const DemoTag = ({ children = 'Demo' }) => <Badge tone="demo">{children}</Badge>;

const STATUS_TONE = { approved: 'good', pending: 'info', more_info: 'warn', rejected: 'bad', suspended: 'bad',
  requested: 'info', confirmed: 'good', completed: 'neutral', declined: 'bad', cancelled: 'neutral', open: 'warn', dismissed: 'neutral', actioned: 'good' };
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || 'neutral'}>{STATUS_LABEL[status] || status[0].toUpperCase() + status.slice(1)}</Badge>;

export const OUTCOME_META = {
  within: { icon: CheckCircle2, short: 'Within expected range' },
  concerning: { icon: AlertTriangle, short: 'Potentially concerning' },
  insufficient: { icon: HelpCircle, short: 'Insufficient reliable data' },
};
export const OutcomeChip = ({ outcome }) => {
  const M = OUTCOME_META[outcome]; if (!M) return null;
  const I = M.icon;
  return <span className={`outcome-chip ${outcome} ${outcome === 'insufficient' ? 'hatch' : ''}`}><I size={14} aria-hidden />{M.short}</span>;
};

export const Btn = ({ variant = '', size = '', icon: I, children, ...p }) => (
  <button className={`btn ${variant} ${size}`} {...p}>{I && <I size={16} aria-hidden />}{children}</button>
);

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}{hint && <span className="hint"> · {hint}</span>}</span>{children}</label>
);

export const Empty = ({ icon: I = Inbox, title, text, action }) => (
  <div className="empty"><div className="ico"><I size={20} /></div><h3>{title}</h3>{text && <p className="small" style={{ maxWidth: '48ch', margin: '0 auto' }}>{text}</p>}{action && <div style={{ marginTop: 12 }}>{action}</div>}</div>
);

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Stars({ value = 0, onChange, size = 16 }) {
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const s = <Star size={size} fill={i <= Math.round(value) ? 'currentColor' : 'none'} />;
        return onChange ? <button key={i} type="button" onClick={() => onChange(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>{s}</button> : <span key={i}>{s}</span>;
      })}
    </span>
  );
}

export const Meter = ({ value, color }) => (
  <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
    <div style={{ width: `${Math.round(value * 100)}%`, background: color || (value >= 0.7 ? 'var(--within)' : value >= 0.45 ? '#c99a1c' : 'var(--concern)') }} />
  </div>
);

export const PageHead = ({ title, text, actions }) => (
  <div className="page-head"><div><h1>{title}</h1>{text && <p className="muted">{text}</p>}</div>{actions && <div className="row">{actions}</div>}</div>
);
