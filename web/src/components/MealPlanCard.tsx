import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import type { MealPlan, PlanMeal } from '../types';
import { ErrorBox, Field, Spinner, Toggle } from './ui';

interface Envelope {
  plan: MealPlan;
  defaults: MealPlan;
}
const GRACE = [0, 15, 30, 45, 60, 90, 120];
const TOLERANCE = [0, 3, 5, 8, 10, 15];
const MAX_MEALS = 8;
const options = (list: number[], current: number) => [...new Set([...list, current])].sort((a, b) => a - b);

/** The meal plan behind the pace of the day: meals with a time and a share, the grace, the tolerance, the notification. */
export function MealPlanCard() {
  const [form, setForm] = useState<MealPlan | null>(null);
  const [saved, setSaved] = useState<MealPlan | null>(null);
  const [defaults, setDefaults] = useState<MealPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(r: Envelope) {
    setForm(r.plan);
    setSaved(r.plan);
    setDefaults(r.defaults);
  }

  useEffect(() => {
    api<Envelope>('/plan')
      .then(apply)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!form) {
    return (
      <section className="card stack">
        <h2>Πλάνο γευμάτων</h2>
        <ErrorBox error={error} />
        {!error && <Spinner />}
      </section>
    );
  }

  const patch = (p: Partial<MealPlan>) => {
    setForm({ ...form, ...p });
    setMsg(null);
  };
  const setMeal = (i: number, p: Partial<PlanMeal>) => patch({ meals: form.meals.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const sum = form.meals.reduce((s, m) => s + (Number.isFinite(m.pct) ? m.pct : 0), 0);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      apply(await api<Envelope>('/plan', { method: 'PUT', body: form }));
      setMsg('Το πλάνο αποθηκεύτηκε');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Πλάνο γευμάτων</h2>
      <p className="muted small">
        Τι μέρος των θερμίδων της μέρας θέλεις να έχεις φάει ως ποια ώρα. Από αυτό βγαίνει ο «Ρυθμός ημέρας» στη σελίδα Σήμερα και η ειδοποίηση
        όταν μένεις πίσω.
      </p>
      <ErrorBox error={error} />

      <div className="stack tight">
        {form.meals.map((m, i) => (
          <div key={i} className="plan-row">
            <input type="time" required value={m.time} onChange={(e) => setMeal(i, { time: e.target.value })} aria-label={`Ώρα γεύματος ${i + 1}`} />
            <input required maxLength={40} value={m.name} onChange={(e) => setMeal(i, { name: e.target.value })} aria-label={`Όνομα γεύματος ${i + 1}`} />
            <input
              inputMode="numeric"
              value={Number.isFinite(m.pct) ? String(m.pct) : ''}
              onChange={(e) => setMeal(i, { pct: e.target.value.trim() === '' ? NaN : Math.round(Number(e.target.value.replace(',', '.'))) })}
              aria-label={`Ποσοστό γεύματος ${i + 1} (%)`}
            />
            <button type="button" className="btn-icon" onClick={() => patch({ meals: form.meals.filter((_, j) => j !== i) })} aria-label={`Αφαίρεση: ${m.name}`}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row between wrap">
        <span className={`small ${sum === 100 ? 'muted' : 'neg'}`}>
          Σύνολο {sum}%{sum === 100 ? '' : ' (πρέπει να κάνει 100%)'}
        </span>
        <div className="row gap">
          {form.meals.length < MAX_MEALS && (
            <button type="button" className="btn btn-small" onClick={() => patch({ meals: [...form.meals, { time: '16:00', name: 'Σνακ', pct: 0 }] })}>
              + Γεύμα
            </button>
          )}
          {defaults && (
            <button type="button" className="btn btn-small" onClick={() => patch({ ...defaults })}>
              Προεπιλογή
            </button>
          )}
        </div>
      </div>

      <div className="grid-2">
        <Field label="Περιθώριο ώρας" hint="πόσο πριν ή μετά την ώρα ενός γεύματος είσαι ακόμη «στην ώρα σου»">
          <select value={form.grace_min} onChange={(e) => patch({ grace_min: Number(e.target.value) })}>
            {options(GRACE, form.grace_min).map((g) => (
              <option key={g} value={g}>
                {g} λεπτά
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ανοχή θερμίδων" hint="ποσοστό του στόχου της μέρας που δεν μετράει για διαφορά">
          <select value={form.tolerance_pct} onChange={(e) => patch({ tolerance_pct: Number(e.target.value) })}>
            {options(TOLERANCE, form.tolerance_pct).map((t) => (
              <option key={t} value={t}>
                {t}%
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Toggle
        label="Ειδοποίηση όταν μένω πίσω"
        hint="Μία για κάθε γεύμα του πλάνου, όταν περάσει το περιθώριο και οι θερμίδες που έγραψες δεν φτάνουν."
        checked={form.notify}
        onChange={(v) => patch({ notify: v })}
      />

      <div className="row gap wrap">
        <button type="button" className="btn btn-primary" disabled={busy || !dirty || sum !== 100} onClick={save}>
          Αποθήκευση
        </button>
        {msg && <span className="small pos">{msg}</span>}
      </div>
    </section>
  );
}
