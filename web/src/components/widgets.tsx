import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { int } from '../format';
import type { Message } from '../types';

/** The day's calories as a ring: how much of the target is eaten, red once it is passed. */
export function CalorieRing({ eaten, target }: { eaten: number; target: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const share = target > 0 ? Math.min(1, eaten / target) : 0;
  const over = eaten > target;
  const left = Math.round(target - eaten);
  return (
    <svg className={`ring${over ? ' over' : ''}`} viewBox="0 0 128 128" role="img" aria-label={`${int(eaten)} από ${int(target)} kcal`}>
      <circle className="ring-track" cx="64" cy="64" r={R} />
      <circle className="ring-value" cx="64" cy="64" r={R} strokeDasharray={`${share * C} ${C}`} transform="rotate(-90 64 64)" />
      <text className="ring-number" x="64" y="62" textAnchor="middle">
        {int(Math.abs(left))}
      </text>
      <text className="ring-caption" x="64" y="80" textAnchor="middle">
        {over ? 'kcal πάνω' : 'kcal ακόμη'}
      </text>
    </svg>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="stat-sub muted">{sub}</div>}
    </div>
  );
}

const TONE_ICON: Record<Message['tone'], string> = { good: '✓', info: 'i', warn: '!' };

/** The mentor's remarks for today. */
export function Mentor({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return null;
  return (
    <section className="card stack">
      <h2>Ο μέντορας λέει</h2>
      <ul className="mentor">
        {messages.map((m, i) => (
          <li key={i} className={`mentor-item ${m.tone}`}>
            <span className="mentor-icon" aria-hidden="true">
              {TONE_ICON[m.tone]}
            </span>
            <span>{m.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shown on every page until the person has given sex, age, height and a weight. */
export function SetupPrompt() {
  return (
    <section className="card stack">
      <h2>Ξεκίνα από τα στοιχεία σου</h2>
      <p className="muted">
        Για να υπολογιστούν οι θερμίδες που χρειάζεσαι, πες μας φύλο, ημερομηνία γέννησης, ύψος, βάρος και πόσο κινείσαι.
      </p>
      <Link to="/body" className="btn btn-primary">
        Συμπλήρωση στοιχείων
      </Link>
    </section>
  );
}
