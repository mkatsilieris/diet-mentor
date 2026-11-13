import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { ACTIVITY_LABEL, dayFull, int, kcal, kg, parseNumber } from '../format';
import type { Activity, Profile, Sex, Summary, WeighIn } from '../types';
import { ErrorBox, Field, Spinner, SuccessBox } from '../components/ui';
import { Stat } from '../components/widgets';

const ACTIVITIES = Object.keys(ACTIVITY_LABEL) as Activity[];

/** Sex, age, height, activity and weight, and the calories that follow from them. */
export default function Body() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [weights, setWeights] = useState<WeighIn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sex, setSex] = useState<Sex>('male');
  const [birth, setBirth] = useState('');
  const [height, setHeight] = useState('');
  const [activity, setActivity] = useState<Activity>('light');
  const [weight, setWeight] = useState('');

  const [weighDay, setWeighDay] = useState('');
  const [weighKg, setWeighKg] = useState('');

  const refresh = useCallback(async () => {
    const [s, w] = await Promise.all([api<Summary>('/summary'), api<{ weights: WeighIn[] }>('/weights?limit=60')]);
    setSummary(s);
    setWeights(w.weights);
    setWeighDay((d) => d || s.today);
  }, []);

  useEffect(() => {
    Promise.all([api<{ profile: Profile | null }>('/profile'), refresh()])
      .then(([p]) => {
        if (p.profile) {
          setSex(p.profile.sex);
          setBirth(p.profile.birth_date);
          setHeight(String(p.profile.height_cm));
          setActivity(p.profile.activity);
        }
        setLoaded(true);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [refresh]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await action();
      await refresh();
      setOk(done);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const h = parseNumber(height);
    const w = weight.trim() === '' ? undefined : parseNumber(weight);
    if (!Number.isFinite(h)) return setError('Το ύψος γράφεται ως αριθμός (cm)');
    if (w !== undefined && !Number.isFinite(w)) return setError('Το βάρος γράφεται ως αριθμός (kg)');
    const saved = await run(
      () => api('/profile', { method: 'PUT', body: { sex, birth_date: birth, height_cm: h, activity, weight_kg: w } }),
      'Τα στοιχεία αποθηκεύτηκαν',
    );
    if (saved) setWeight('');
  }

  async function addWeight(e: FormEvent) {
    e.preventDefault();
    const w = parseNumber(weighKg);
    if (!Number.isFinite(w)) return setError('Το βάρος γράφεται ως αριθμός (kg)');
    const saved = await run(() => api('/weights', { method: 'POST', body: { day: weighDay, kg: w } }), 'Η ζύγιση γράφτηκε');
    if (saved) setWeighKg('');
  }

  if (!loaded || !summary) {
    return (
      <div className="page">
        <ErrorBox error={error} />
        {!error && <Spinner full />}
      </div>
    );
  }

  const needsWeight = weights.length === 0;

  return (
    <div className="page">
      <h1>Σώμα</h1>
      <ErrorBox error={error} />
      <SuccessBox message={ok} />

      <section className="card stack">
        <h2>Τα στοιχεία σου</h2>
        <form onSubmit={saveProfile} className="stack">
          <div className="grid-2">
            <Field label="Φύλο">
              <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                <option value="male">Άνδρας</option>
                <option value="female">Γυναίκα</option>
              </select>
            </Field>
            <Field label="Ημερομηνία γέννησης" hint={summary.ready ? `${summary.body.age} ετών` : 'από εδώ βγαίνει η ηλικία'}>
              <input type="date" required max={summary.today} value={birth} onChange={(e) => setBirth(e.target.value)} />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Ύψος (cm)">
              <input inputMode="decimal" required value={height} onChange={(e) => setHeight(e.target.value)} />
            </Field>
            <Field
              label={needsWeight ? 'Βάρος (kg)' : 'Βάρος σήμερα (kg)'}
              hint={needsWeight ? undefined : `προαιρετικό · τελευταία ζύγιση ${kg(weights[0].kg)}`}
            >
              <input inputMode="decimal" required={needsWeight} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
          </div>
          <Field label="Δραστηριότητα" hint={ACTIVITY_LABEL[activity].hint}>
            <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>
                  {ACTIVITY_LABEL[a].label}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn btn-primary" disabled={busy}>
            Αποθήκευση
          </button>
        </form>
      </section>

      {summary.ready && (
        <section className="card stack">
          <h2>Οι θερμίδες σου</h2>
          <div className="stat-grid">
            <Stat label="Για να μείνεις στα ίδια κιλά" value={kcal(summary.body.maintenance)} sub="την ημέρα (συντήρηση)" />
            <Stat label="Βασικός μεταβολισμός" value={kcal(summary.body.bmr)} sub="όσα καις σε πλήρη ανάπαυση" />
            <Stat label="Βάρος" value={kg(summary.body.weightKg)} sub={`ΔΜΣ ${summary.body.bmi.toFixed(1).replace('.', ',')} · ζύγιση ${dayFull(summary.body.weightDay)}`} />
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Για να χάνεις</th>
                  <th className="num">Έλλειμμα/μέρα</th>
                  <th className="num">Τρως/μέρα</th>
                </tr>
              </thead>
              <tbody>
                {summary.body.plans.map((p) => (
                  <tr key={p.rateKgWeek}>
                    <td>
                      {String(p.rateKgWeek).replace('.', ',')} kg την εβδομάδα
                      {p.tooLow && <div className="neg small">θα ήθελε κάτω από {int(summary.body.minIntake)} kcal· δεν προτείνεται</div>}
                    </td>
                    <td className="num">{kcal(p.dailyDeficit)}</td>
                    <td className="num">
                      <strong>{kcal(p.intake)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Βασικός μεταβολισμός με τον τύπο Mifflin-St Jeor, επί τον συντελεστή της δραστηριότητας. Ένα κιλό λίπους λογίζεται 7.700 kcal. Οι
            αριθμοί είναι εκτιμήσεις: ξαναϋπολογίζονται με κάθε ζύγιση, και η ζυγαριά σε βάθος εβδομάδων δείχνει αν θέλουν διόρθωση. Η εφαρμογή
            δεν αντικαθιστά γιατρό ή διαιτολόγο.
          </p>
        </section>
      )}

      <section className="card stack">
        <h2>Ζυγίσεις</h2>
        <form onSubmit={addWeight} className="stack">
          <div className="grid-2">
            <Field label="Ημέρα">
              <input type="date" required max={summary.today} value={weighDay} onChange={(e) => setWeighDay(e.target.value)} />
            </Field>
            <Field label="Βάρος (kg)">
              <input inputMode="decimal" required value={weighKg} onChange={(e) => setWeighKg(e.target.value)} />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            Προσθήκη
          </button>
        </form>
        <p className="muted small">Ζυγίσου το πρωί, πριν φας. Μία ζύγιση ανά ημέρα· αν ξαναγράψεις την ίδια μέρα, αντικαθίσταται.</p>
        {weights.length > 0 && (
          <ul className="list plain">
            {weights.map((w, i) => {
              const prev = weights[i + 1];
              const delta = prev ? w.kg - prev.kg : null;
              return (
                <li key={w.day} className="list-item static">
                  <div className="list-main">
                    <div className="list-title">{kg(w.kg)}</div>
                    <div className="muted small">{dayFull(w.day)}</div>
                  </div>
                  {delta !== null && Math.abs(delta) >= 0.05 && (
                    <span className={`delta ${delta < 0 ? 'down' : 'up'}`}>
                      {delta < 0 ? '−' : '+'}
                      {Math.abs(delta).toFixed(1).replace('.', ',')}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={busy}
                    onClick={() => run(() => api(`/weights/${w.day}`, { method: 'DELETE' }), 'Η ζύγιση σβήστηκε')}
                    aria-label={`Διαγραφή ζύγισης ${dayFull(w.day)}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
