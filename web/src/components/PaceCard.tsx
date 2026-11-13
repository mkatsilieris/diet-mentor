import { Link } from 'react-router-dom';
import { int, kcal } from '../format';
import type { Pace, PaceStep } from '../types';

const STATUS: Record<Pace['status'], { label: string; chip: string }> = {
  on: { label: 'Στην ώρα σου', chip: 'good' },
  behind: { label: 'Πίσω από το πλάνο', chip: 'warn' },
  ahead: { label: 'Μπροστά από το πλάνο', chip: 'bad' },
};
const MARK: Record<PaceStep['state'], string> = { covered: '✓', late: '!', due: '•', upcoming: '' };
const STATE_TEXT: Record<PaceStep['state'], string> = { covered: 'καλύφθηκε', late: 'καθυστερεί', due: 'τώρα', upcoming: 'αργότερα' };

/** Today's calories against what the meal plan wants by this hour, and the steps of the plan. */
export function PaceCard({ pace }: { pace: Pace }) {
  const scale = Math.max(pace.target, pace.eaten, 1);
  const status = STATUS[pace.status];
  let line: string;
  if (pace.status === 'behind') line = `Σου λείπουν ${kcal(pace.shortBy)} για να πιάσεις το πλάνο. Φάε τώρα, πριν μαζευτεί η πείνα.`;
  else if (pace.status === 'ahead') line = `Έχεις φάει ${kcal(pace.eaten - pace.allowed)} παραπάνω απ' όσα θέλει το πλάνο ως αυτή την ώρα.`;
  else if (pace.next) line = `Επόμενο: ${pace.next.name} στις ${pace.next.time}, γύρω στα ${kcal(pace.next.kcal)}.`;
  else line = 'Όλα τα γεύματα του πλάνου έχουν περάσει.';

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Ρυθμός ημέρας</h2>
        <span className={`chip ${status.chip}`}>{status.label}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Έχεις φάει</dt>
          <dd>{kcal(pace.eaten)}</dd>
        </div>
        <div>
          <dt>Θα έπρεπε ως τις {pace.now}</dt>
          <dd>{kcal(pace.due)}</dd>
        </div>
        <div>
          <dt>Διαφορά</dt>
          <dd className={pace.status === 'on' ? '' : 'neg'}>
            {pace.diff > 0 ? '+' : pace.diff < 0 ? '−' : ''}
            {kcal(Math.abs(pace.diff))}
          </dd>
        </div>
      </dl>
      <div
        className={`pace-bar ${pace.status}`}
        role="img"
        aria-label={`Έχεις φάει ${int(pace.eaten)} kcal, το πλάνο θέλει ${int(pace.due)} ως τώρα, στόχος ημέρας ${int(pace.target)}`}
      >
        <div className="pace-fill" style={{ width: `${Math.min(100, (pace.eaten / scale) * 100)}%` }} />
        <div className="pace-marker" style={{ left: `${Math.min(100, (pace.due / scale) * 100)}%` }}>
          {pace.due > 0 && pace.due < scale && <span>{pace.now}</span>}
        </div>
      </div>
      <p className="small">{line}</p>
      <ul className="pace-steps">
        {pace.steps.map((s) => (
          <li key={s.time} className={s.state}>
            <span className="pace-mark" title={STATE_TEXT[s.state]} aria-label={STATE_TEXT[s.state]}>
              {MARK[s.state]}
            </span>
            <span className="num">{s.time}</span>
            <span>
              {s.name} <span className="muted small">· {kcal(s.kcal)}</span>
            </span>
            <span className="num">ως {int(s.cumKcal)}</span>
          </li>
        ))}
      </ul>
      <Link to="/profile" className="small">
        Αλλαγή πλάνου γευμάτων
      </Link>
    </section>
  );
}
