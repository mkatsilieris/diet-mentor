import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { addDays, dayLong, days, int, kcal, nowTime, parseNumber } from '../format';
import type { Day, EntriesResponse, Entry, Food, Summary } from '../types';
import { pushState, type PushState } from '../push';
import { Empty, ErrorBox, Field, InfoBox, Spinner } from '../components/ui';
import { CalorieRing, Mentor, ProgressBar, SetupPrompt } from '../components/widgets';
import { PaceCard } from '../components/PaceCard';

/** The food diary of one day (today unless another is picked) next to the calories that day allows. */
export default function Today() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);

  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [kcalText, setKcalText] = useState('');
  const [carbsText, setCarbsText] = useState('');
  const [time, setTime] = useState(nowTime);

  const loadSummary = useCallback(async () => {
    const [s, f] = await Promise.all([api<Summary>('/summary'), api<{ foods: Food[] }>('/foods')]);
    setSummary(s);
    setFoods(f.foods);
    setDay((d) => d ?? s.today);
  }, []);

  useEffect(() => {
    loadSummary().catch((err) => setError(errorMessage(err)));
    void pushState().then(setPush);
    // the pace of the day moves with the clock: read it again every few minutes and when the app comes back
    const refresh = () => document.visibilityState === 'visible' && void loadSummary().catch(() => undefined);
    const timer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadSummary]);

  useEffect(() => {
    if (!day) return;
    let stale = false;
    setEntries(null);
    api<EntriesResponse>(`/entries?day=${day}`)
      .then((r) => !stale && setEntries(r.entries))
      .catch((err) => !stale && setError(errorMessage(err)));
    return () => {
      stale = true;
    };
  }, [day]);

  function resetForm() {
    setEditing(null);
    setName('');
    setKcalText('');
    setCarbsText('');
    setTime(nowTime());
  }

  /** Runs a change and then reads the day and the summary again. */
  async function change(action: () => Promise<unknown>) {
    if (!day) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      const r = await api<EntriesResponse>(`/entries?day=${day}`);
      setEntries(r.entries);
      await loadSummary();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const k = parseNumber(kcalText);
    if (!Number.isFinite(k) || k < 0) {
      setError('Γράψε τις θερμίδες ως αριθμό');
      return;
    }
    const c = carbsText.trim() === '' ? null : parseNumber(carbsText);
    if (c !== null && (!Number.isFinite(c) || c < 0)) {
      setError('Οι υδατάνθρακες γράφονται ως αριθμός (γραμμάρια)');
      return;
    }
    const body = { day, time, name, kcal: Math.round(k), carbs_g: c };
    const ok = await change(() =>
      editing ? api(`/entries/${editing}`, { method: 'PUT', body }) : api('/entries', { method: 'POST', body }),
    );
    if (ok) resetForm();
  }

  function pickName(value: string) {
    setName(value);
    const known = foods.find((f) => f.name.toLowerCase() === value.trim().toLowerCase());
    if (known && kcalText === '') {
      setKcalText(String(known.kcal));
      if (known.carbs_g !== null) setCarbsText(String(known.carbs_g));
    }
  }

  function edit(entry: Entry) {
    setEditing(entry.id);
    setName(entry.name);
    setKcalText(String(entry.kcal));
    setCarbsText(entry.carbs_g === null ? '' : String(entry.carbs_g));
    setTime(entry.time);
  }

  if (!summary || !day) {
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

  const isToday = day === summary.today;
  const row = summary.days.find((r) => r.day === day);
  const target = row?.target ?? summary.day.target;
  const maintenance = row?.maintenance ?? summary.day.maintenance;
  const eaten = entries?.reduce((s, e) => s + e.kcal, 0) ?? (isToday ? summary.day.intake : 0);
  const diet = summary.diet;
  const inDiet = Boolean(diet && day >= diet.diet.started_on);

  return (
    <div className="page">
      <ErrorBox error={error} />

      <div className="day-nav">
        <button type="button" className="btn btn-small" onClick={() => setDay(addDays(day, -1))} aria-label="Προηγούμενη μέρα">
          ‹
        </button>
        <div className="day-nav-title">
          <strong>{isToday ? 'Σήμερα' : day === addDays(summary.today, -1) ? 'Χθες' : dayLong(day)}</strong>
          {(isToday || day === addDays(summary.today, -1)) && <span className="muted small">{dayLong(day)}</span>}
        </div>
        <button type="button" className="btn btn-small" onClick={() => setDay(addDays(day, 1))} disabled={day >= summary.today} aria-label="Επόμενη μέρα">
          ›
        </button>
      </div>

      <section className="card calorie-card">
        <CalorieRing eaten={eaten} target={target} />
        <dl className="facts">
          <div>
            <dt>Έφαγες</dt>
            <dd>{kcal(eaten)}</dd>
          </div>
          <div>
            <dt>{inDiet ? 'Στόχος δίαιτας' : 'Στόχος (συντήρηση)'}</dt>
            <dd>{kcal(target)}</dd>
          </div>
          {inDiet && (
            <div>
              <dt>Συντήρηση</dt>
              <dd>{kcal(maintenance)}</dd>
            </div>
          )}
          <div>
            <dt>{isToday ? 'Έλλειμμα ως τώρα' : 'Έλλειμμα ημέρας'}</dt>
            <dd className={maintenance - eaten >= 0 ? 'pos' : 'neg'}>{entries && entries.length === 0 ? '—' : kcal(maintenance - eaten)}</dd>
          </div>
        </dl>
      </section>

      {isToday && <PaceCard pace={summary.pace} />}

      {isToday &&
        (diet ? (
          <Link to="/diets" className="card diet-strip">
            <div className="row between">
              <strong>{diet.diet.name}</strong>
              <span className="muted small">
                Μέρα {diet.dayNumber}
                {diet.diet.planned_days ? ` από ${diet.diet.planned_days}` : ''}
              </span>
            </div>
            {diet.timePct !== null && <ProgressBar value={diet.timePct} label="Πρόοδος δίαιτας" />}
            <span className="muted small">
              Έλλειμμα ως τώρα {kcal(diet.totals.deficit)} σε {days(diet.totals.loggedDays)} καταγραφής
            </span>
          </Link>
        ) : (
          <div className="card row between wrap">
            <span className="muted">Δεν τρέχει δίαιτα. Τρως για να μείνεις στα ίδια κιλά.</span>
            <Link to="/diets" className="btn btn-small btn-primary">
              Ξεκίνα δίαιτα
            </Link>
          </div>
        ))}

      <section className="card stack">
        <h2>{editing ? 'Διόρθωση καταχώρισης' : 'Τι έφαγες;'}</h2>
        <form onSubmit={submit} className="stack">
          <Field label="Φαγητό">
            <input
              list="own-foods"
              required
              maxLength={120}
              placeholder="π.χ. γιαούρτι με μέλι"
              value={name}
              onChange={(e) => pickName(e.target.value)}
            />
          </Field>
          <datalist id="own-foods">
            {foods.map((f) => (
              <option key={f.name} value={f.name}>{`${int(f.kcal)} kcal`}</option>
            ))}
          </datalist>
          <div className="entry-grid">
            <Field label="Θερμίδες (kcal)">
              <input inputMode="numeric" required value={kcalText} onChange={(e) => setKcalText(e.target.value)} />
            </Field>
            <Field label="Ώρα">
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Υδατάνθρακες (g)" hint="προαιρετικό">
              <input inputMode="decimal" value={carbsText} onChange={(e) => setCarbsText(e.target.value)} />
            </Field>
          </div>
          <div className="row gap">
            <button className="btn btn-primary" disabled={busy}>
              {editing ? 'Αποθήκευση' : 'Προσθήκη'}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={resetForm}>
                Άκυρο
              </button>
            )}
          </div>
        </form>
        {!editing && foods.length > 0 && (
          <div className="stack tight">
            <span className="muted small">Ξανά με ένα πάτημα (ώρα: τώρα)</span>
            <div className="row wrap gap">
              {foods.slice(0, 8).map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className="chip chip-button"
                  disabled={busy}
                  onClick={() => change(() => api('/entries', { method: 'POST', body: { day, time: nowTime(), name: f.name, kcal: f.kcal, carbs_g: f.carbs_g } }))}
                >
                  {f.name} · {int(f.kcal)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Ημερολόγιο</h2>
          <span className="muted small">{entries ? `${entries.length} καταχωρίσεις · ${kcal(eaten)}` : ''}</span>
        </div>
        {!entries ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty title="Τίποτα ακόμη αυτή τη μέρα">
            <p className="small">Μέρες χωρίς καταχωρίσεις δεν μετράνε στο έλλειμμα: δεν ξέρουμε τι έφαγες.</p>
          </Empty>
        ) : (
          <ul className="list plain">
            {entries.map((e) => (
              <li key={e.id} className="list-item static">
                <span className="entry-time muted">{e.time}</span>
                <div className="list-main">
                  <div className="list-title">{e.name}</div>
                  {e.carbs_g !== null && <div className="muted small">{int(e.carbs_g)} g υδατάνθρακες</div>}
                </div>
                <span className="amount">{int(e.kcal)}</span>
                <button type="button" className="btn-icon" onClick={() => edit(e)} aria-label={`Διόρθωση: ${e.name}`}>
                  ✎
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  disabled={busy}
                  onClick={() => change(() => api(`/entries/${e.id}`, { method: 'DELETE' })).then(() => editing === e.id && resetForm())}
                  aria-label={`Διαγραφή: ${e.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isToday && <Mentor messages={summary.motivation.messages} />}
      {isToday && push === 'off' && (
        <InfoBox>
          Θες υπενθύμιση να γράφεις τα γεύματα και νέα για την πρόοδό σου; <Link to="/profile">Ενεργοποίησε τις ειδοποιήσεις</Link>
        </InfoBox>
      )}
    </div>
  );
}
