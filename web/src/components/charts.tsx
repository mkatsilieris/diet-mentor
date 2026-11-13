import { dayShort, int, kg, signedKcal } from '../format';
import type { DayRow } from '../types';

/**
 * Deficit per day: bars above the line are calories under maintenance, bars below are over it.
 * Days without entries leave a gap. The dashed line is the deficit the diet asks for.
 */
export function DeficitChart({ rows }: { rows: DayRow[] }) {
  const W = 360;
  const H = 150;
  const padL = 38;
  const padB = 18;
  const padT = 8;
  const counted = rows.filter((r) => r.counted);
  const planned = rows.map((r) => r.maintenance - r.target);
  const hi = Math.max(300, ...counted.map((r) => r.deficit), ...planned);
  const lo = Math.min(0, ...counted.map((r) => r.deficit));
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const bw = (W - padL - 2) / Math.max(1, rows.length);
  const labelEvery = Math.ceil(rows.length / 6);
  const plan = planned[planned.length - 1] ?? 0;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Έλλειμμα θερμίδων ανά ημέρα">
      {[hi, 0, ...(lo < -50 ? [lo] : [])].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'} />
          <text x={padL - 4} y={y(v) + 3.5} textAnchor="end">
            {int(v)}
          </text>
        </g>
      ))}
      {plan > 0 && <line x1={padL} x2={W} y1={y(plan)} y2={y(plan)} className="avg" />}
      {rows.map((r, i) => {
        if (!r.counted) return null;
        const top = y(Math.max(0, r.deficit));
        const bottom = y(Math.min(0, r.deficit));
        return (
          <rect
            key={r.day}
            x={padL + i * bw + 0.5}
            y={top}
            width={Math.max(1, bw - 1.5)}
            height={Math.max(1, bottom - top)}
            rx={1}
            className={`bar ${r.deficit >= 0 ? 'pos' : 'neg'}`}
          >
            <title>{`${dayShort(r.day)}: ${signedKcal(r.deficit)} (έφαγες ${int(r.intake)})`}</title>
          </rect>
        );
      })}
      {rows.map((r, i) =>
        i % labelEvery === 0 ? (
          <text key={r.day} x={padL + i * bw} y={H - 5}>
            {dayShort(r.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/**
 * The scale against the model: dots are the weigh-ins, the line is the weight expected from the
 * calories (fat lost plus the glycogen and water that came and went), starting at the first day.
 */
export function WeightChart({ rows }: { rows: DayRow[] }) {
  if (rows.length < 2) return <p className="muted small">Χρειάζονται τουλάχιστον δύο μέρες για το γράφημα.</p>;
  const W = 360;
  const H = 150;
  const padL = 38;
  const padB = 18;
  const padT = 8;
  const first = rows[0];
  const expected = rows.map((r) => first.weightKg - (r.fatCumKg - first.fatCumKg) + (r.glycogenCumKg - first.glycogenCumKg));
  const fatOnly = rows.map((r) => first.weightKg - (r.fatCumKg - first.fatCumKg));
  const weighed = rows.map((r, i) => ({ i, day: r.day, kg: r.weighedKg })).filter((p): p is { i: number; day: string; kg: number } => p.kg !== null);
  const all = [...expected, ...fatOnly, ...weighed.map((p) => p.kg)];
  const hi = Math.max(...all) + 0.3;
  const lo = Math.min(...all) - 0.3;
  const x = (i: number) => padL + (i / (rows.length - 1)) * (W - padL - 6);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const labelEvery = Math.ceil(rows.length / 6);

  return (
    <div className="stack">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Βάρος: ζυγίσεις και αναμενόμενο">
        {[hi, (hi + lo) / 2, lo].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 4} y={y(v) + 3.5} textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path(fatOnly)} className="line faint" />
        <path d={path(expected)} className="line" />
        {weighed.map((p) => (
          <circle key={p.day} cx={x(p.i)} cy={y(p.kg)} r={3.5} className="dot">
            <title>{`${dayShort(p.day)}: ${kg(p.kg)}`}</title>
          </circle>
        ))}
        {rows.map((r, i) =>
          i % labelEvery === 0 ? (
            <text key={r.day} x={x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : 'middle'}>
              {dayShort(r.day)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="legend">
        <span>
          <i className="legend-dot" /> ζύγιση
        </span>
        <span>
          <i className="legend-line" /> αναμενόμενο στη ζυγαριά
        </span>
        <span>
          <i className="legend-line faint" /> μόνο το λίπος
        </span>
      </div>
    </div>
  );
}
