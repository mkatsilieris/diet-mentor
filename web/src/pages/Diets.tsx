import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { dayFull, days, kcal, kg, parseNumber, pct, signedKcal, signedKg } from '../format';
import type { DietStats, ReadySummary, Summary } from '../types';
import { Empty, ErrorBox, Field, Spinner, WarnBox } from '../components/ui';
import { ProgressBar, SetupPrompt, Stat } from '../components/widgets';

const rateLabel = (rate: number): string => `${String(rate).replace('.', ',')} kg την εβδομάδα`;

function StartForm({ summary, onDone }: { summary: ReadySummary; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState(0.5);
  const [planned, setPlanned] = useState('30');
  const [goal, setGoal] = useState('');
  const [startedOn, setStartedOn] = useState(summary.today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = summary.body.plans.find((p) => p.rateKgWeek === rate);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const plannedDays = planned.trim() === '' ? null : parseNumber(planned);
    const goalKg = goal.trim() === '' ? null : parseNumber(goal);
    if (plannedDays !== null && (!Number.isInteger(plannedDays) || plannedDays < 1)) return setError('Οι μέρες είναι ακέραιος αριθμός');
    if (goalKg !== null && !Number.isFinite(goalKg)) return setError('Το βάρος-στόχος γράφεται ως αριθμός');
    setBusy(true);
    setError(null);
    try {
      await api('/diets', {
        method: 'POST',
        body: { name: name.trim() || undefined, rate_kg_week: rate, planned_days: plannedDays, goal_weight_kg: goalKg, started_on: startedOn },
      });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Ξεκίνα δίαιτα</h2>
      <p className="muted small">
        Τώρα ζυγίζεις {kg(summary.body.weightKg)} και για να μείνεις εκεί τρως γύρω στις {kcal(summary.body.maintenance)} τη μέρα.
      </p>
      <form onSubmit={submit} className="stack">
        <ErrorBox error={error} />
        <Field label="Ρυθμός">
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {summary.body.plans.map((p) => (
              <option key={p.rateKgWeek} value={p.rateKgWeek}>
                {rateLabel(p.rateKgWeek)} · {kcal(p.intake)} τη μέρα
              </option>
            ))}
          </select>
        </Field>
        {plan?.tooLow && (
          <WarnBox>
            Αυτός ο ρυθμός θα ήθελε λιγότερες από {kcal(summary.body.minIntake)} τη μέρα. Ο στόχος μένει στις {kcal(plan.intake)} και η απώλεια
            θα είναι πιο αργή από {rateLabel(rate)}.
          </WarnBox>
        )}
        <div className="grid-2">
          <Field label="Διάρκεια (μέρες)" hint="άδειο = χωρίς προκαθορισμένο τέλος">
            <input inputMode="numeric" value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </Field>
          <Field label="Βάρος-στόχος (kg)" hint="προαιρετικό">
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Έναρξη">
            <input type="date" required max={summary.today} value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </Field>
          <Field label="Όνομα" hint="προαιρετικό">
            <input maxLength={80} placeholder="π.χ. Πριν το καλοκαίρι" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Έναρξη…' : 'Έναρξη δίαιτας'}
        </button>
      </form>
    </section>
  );
}

function DietFacts({ s }: { s: DietStats }) {
  return (
    <div className="stat-grid">
      <Stat label="Έλλειμμα" tone={s.totals.deficit > 0 ? 'pos' : undefined} value={signedKcal(s.totals.deficit)} sub={`${days(s.totals.loggedDays)} καταγραφής`} />
      <Stat label="Μ.Ο. την ημέρα" value={s.totals.loggedDays ? signedKcal(s.totals.avgDeficit) : '—'} sub={`στόχος +${Math.round(s.dailyDeficitTarget)} kcal`} />
      <Stat label="Λίπος (εκτίμηση)" value={signedKg(-s.totals.fatKg)} sub={`γλυκογόνο και νερό ${signedKg(s.totals.glycogenKg)}`} />
      <Stat
        label="Ζυγαριά"
        value={s.weightChangeKg !== null ? signedKg(s.weightChangeKg) : '—'}
        sub={s.startKg !== null && s.currentKg !== null ? `${kg(s.startKg)} → ${kg(s.currentKg)} · αναμενόμενο ${signedKg(s.totals.scaleKg)}` : 'χωρίς ζύγιση μέσα στη δίαιτα'}
      />
      {s.adherencePct !== null && <Stat label="Μέρες μέσα στον στόχο" value={pct(s.adherencePct)} sub={`${s.totals.onTargetDays} από ${s.totals.loggedDays}`} />}
    </div>
  );
}

function ActiveDiet({ s, summary, onDone }: { s: DietStats; summary: ReadySummary; onDone: () => Promise<void> }) {
  const [ending, setEnding] = useState(false);
  const [endWeight, setEndWeight] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function end(e: FormEvent) {
    e.preventDefault();
    const w = endWeight.trim() === '' ? null : parseNumber(endWeight);
    if (w !== null && !Number.isFinite(w)) return setError('Το βάρος γράφεται ως αριθμός');
    void run(() => api(`/diets/${s.diet.id}/end`, { method: 'POST', body: { end_weight_kg: w } }));
  }

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>{s.diet.name}</h2>
        <span className="chip">τρέχει</span>
      </div>
      <ErrorBox error={error} />
      <div className="stack tight">
        <div className="row between">
          <strong>
            Μέρα {s.dayNumber}
            {s.diet.planned_days ? ` από ${s.diet.planned_days}` : ''}
          </strong>
          <span className="muted small">
            από {dayFull(s.diet.started_on)}
            {s.daysLeft !== null && !s.overdue ? ` · απομένουν ${days(s.daysLeft)}` : ''}
          </span>
        </div>
        {s.timePct !== null && <ProgressBar value={s.timePct} label="Πρόοδος στον χρόνο" />}
      </div>
      {s.overdue && <WarnBox>Πέρασαν οι μέρες που είχες βάλει. Κλείσε τη δίαιτα και κάνε ένα διάλειμμα στη συντήρηση.</WarnBox>}
      <p>
        Στόχος σήμερα: <strong>{kcal(summary.day.target)}</strong>{' '}
        <span className="muted">
          (συντήρηση {kcal(summary.day.maintenance)}, ρυθμός {rateLabel(s.diet.rate_kg_week)})
        </span>
      </p>
      {summary.day.maintenance - summary.day.target < s.dailyDeficitTarget - 1 && (
        <WarnBox>Ο ρυθμός που ζήτησες θα ήθελε λιγότερες από {kcal(summary.body.minIntake)} τη μέρα, οπότε ο στόχος σταματά εκεί.</WarnBox>
      )}
      <DietFacts s={s} />
      {s.goalKg !== null && s.goalPct !== null && (
        <div className="stack tight">
          <div className="row between">
            <span>Προς τα {kg(s.goalKg)}</span>
            <span className="muted small">
              {pct(s.goalPct)}
              {s.projectedGoalDay ? ` · με αυτόν τον ρυθμό γύρω στις ${dayFull(s.projectedGoalDay)}` : ''}
            </span>
          </div>
          <ProgressBar value={s.goalPct} label="Πρόοδος προς το βάρος-στόχο" />
        </div>
      )}
      {ending ? (
        <form onSubmit={end} className="stack">
          <Field label="Βάρος σήμερα (kg)" hint="προαιρετικό· γράφεται και ως ζύγιση της ημέρας">
            <input inputMode="decimal" autoFocus value={endWeight} onChange={(e) => setEndWeight(e.target.value)} />
          </Field>
          <div className="row gap">
            <button className="btn btn-primary" disabled={busy}>
              Τέλος δίαιτας σήμερα
            </button>
            <button type="button" className="btn" onClick={() => setEnding(false)}>
              Άκυρο
            </button>
          </div>
        </form>
      ) : (
        <div className="row gap wrap">
          <button type="button" className="btn btn-primary" onClick={() => setEnding(true)}>
            Τέλος δίαιτας
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => window.confirm('Να σβηστεί η δίαιτα; Οι καταχωρίσεις φαγητού και οι ζυγίσεις μένουν.') && run(() => api(`/diets/${s.diet.id}`, { method: 'DELETE' }))}
          >
            Διαγραφή
          </button>
        </div>
      )}
    </section>
  );
}

/** Diet sessions: the one that runs now, starting a new one, and the ones that are over. */
export default function Diets() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [diets, setDiets] = useState<DietStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([api<Summary>('/summary'), api<{ diets: DietStats[] }>('/diets')]);
    setSummary(s);
    setDiets(d.diets);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function remove(id: number) {
    if (!window.confirm('Να σβηστεί η δίαιτα από το ιστορικό; Οι καταχωρίσεις φαγητού και οι ζυγίσεις μένουν.')) return;
    try {
      await api(`/diets/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!summary || !diets) {
    return (
      <div className="page">
        <ErrorBox error={error} />
        {!error && <Spinner full />}
      </div>
    );
  }
  if (!summary.ready) {
    return (
      <div className="page">
        <SetupPrompt />
      </div>
    );
  }

  const active = diets.find((d) => d.active);
  const past = diets.filter((d) => !d.active);

  return (
    <div className="page">
      <h1>Δίαιτες</h1>
      <ErrorBox error={error} />
      {active ? <ActiveDiet s={active} summary={summary} onDone={load} /> : <StartForm summary={summary} onDone={load} />}

      <section className="stack">
        <h2>Ιστορικό</h2>
        {past.length === 0 ? (
          <div className="card">
            <Empty title="Καμία ολοκληρωμένη δίαιτα ακόμη">
              <p className="small">Όταν τελειώσεις μια δίαιτα θα τη βρεις εδώ, με το τι πέτυχες.</p>
            </Empty>
          </div>
        ) : (
          past.map((s) => (
            <article key={s.diet.id} className="card stack">
              <div className="group-head">
                <div>
                  <h2>{s.diet.name}</h2>
                  <span className="muted small">
                    {dayFull(s.diet.started_on)} – {dayFull(s.diet.ended_on ?? s.diet.started_on)} · {days(s.dayNumber)}
                    {s.diet.planned_days ? ` (σχέδιο ${s.diet.planned_days})` : ''} · {rateLabel(s.diet.rate_kg_week)}
                  </span>
                </div>
                <button type="button" className="btn-icon" onClick={() => remove(s.diet.id)} aria-label={`Διαγραφή: ${s.diet.name}`}>
                  ✕
                </button>
              </div>
              <DietFacts s={s} />
            </article>
          ))
        )}
      </section>
    </div>
  );
}
