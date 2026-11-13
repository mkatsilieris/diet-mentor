import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { disablePush, enablePush, pushState, type PushState } from '../push';
import { ErrorBox, Field, Spinner, Toggle } from './ui';

interface Settings {
  reminders: boolean;
  reminder_times: string[];
  motivation: boolean;
  motivation_time: string;
  weekly: boolean;
  energy: boolean;
  energy_gap_min: number;
  energy_from: string;
  energy_until: string;
}
const GAPS = [180, 210, 240, 270, 300, 360];
const hoursLabel = (min: number) => `${(min / 60).toLocaleString('el-GR')} ώρες`;
interface Envelope {
  settings: Settings;
  devices: number;
}

/** Push on this device, and what the person wants to be told: meal reminders, the call to eat, motivation, the weekly summary. */
export function NotificationsCard() {
  const [push, setPush] = useState<PushState | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [devices, setDevices] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(r: Envelope) {
    setForm(r.settings);
    setSaved(r.settings);
    setDevices(r.devices);
  }

  useEffect(() => {
    void pushState().then(setPush);
    api<Envelope>('/notifications')
      .then(apply)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      setMsg(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPush(await pushState());
      setBusy(false);
    }
  }

  if (!form) {
    return (
      <section className="card stack">
        <h2>Ειδοποιήσεις</h2>
        <ErrorBox error={error} />
        {!error && <Spinner />}
      </section>
    );
  }

  const patch = (p: Partial<Settings>) => setForm({ ...form, ...p });
  const setTime = (i: number, value: string) => patch({ reminder_times: form.reminder_times.map((t, j) => (j === i ? value : t)) });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <section className="card stack">
      <h2>Ειδοποιήσεις</h2>
      <ErrorBox error={error} />

      <div className="push-box stack">
        <div className="toggle-label">Push σε αυτή τη συσκευή</div>
        {push === 'unsupported' && (
          <p className="muted small">
            Ο browser αυτός δεν υποστηρίζει ειδοποιήσεις push. Σε iPhone/iPad πρόσθεσε πρώτα την εφαρμογή στην αρχική οθόνη (Κοινή χρήση →
            Προσθήκη στην οθόνη Αφετηρίας) και άνοιξέ την από εκεί.
          </p>
        )}
        {push === 'denied' && <p className="muted small">Οι ειδοποιήσεις είναι μπλοκαρισμένες για αυτή τη σελίδα. Άλλαξέ το από τις ρυθμίσεις του browser.</p>}
        {push === 'off' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await enablePush();
                apply(await api<Envelope>('/notifications'));
                return 'Οι ειδοποιήσεις ενεργοποιήθηκαν σε αυτή τη συσκευή';
              })
            }
          >
            Ενεργοποίηση
          </button>
        )}
        {push === 'on' && (
          <div className="row gap wrap">
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ sent: number; failed: number }>('/push/test', { method: 'POST' });
                  return r.sent > 0 ? `Στάλθηκε δοκιμαστική ειδοποίηση σε ${r.sent} συσκευ${r.sent === 1 ? 'ή' : 'ές'}` : 'Δεν βρέθηκε συσκευή για αποστολή';
                })
              }
            >
              Δοκιμή
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await disablePush();
                  apply(await api<Envelope>('/notifications'));
                  return 'Οι ειδοποιήσεις απενεργοποιήθηκαν σε αυτή τη συσκευή';
                })
              }
            >
              Απενεργοποίηση
            </button>
          </div>
        )}
        <p className="muted small">
          {devices === 0 ? 'Καμία συσκευή δεν δέχεται ειδοποιήσεις ακόμη.' : `Ειδοποιήσεις φτάνουν σε ${devices} συσκευ${devices === 1 ? 'ή' : 'ές'} σου.`} Τα
          push χρειάζονται https, δηλαδή τη διεύθυνση της εφαρμογής στο Internet (ή localhost).
        </p>
        {msg && <p className="small pos">{msg}</p>}
      </div>

      <Toggle
        label="Υπενθυμίσεις γευμάτων"
        hint="Στις ώρες που ορίζεις, μόνο αν δεν έχεις γράψει κάτι από την προηγούμενη υπενθύμιση."
        checked={form.reminders}
        onChange={(v) => patch({ reminders: v })}
      />
      {form.reminders && (
        <div className="stack tight">
          <div className="row gap wrap">
            {form.reminder_times.map((t, i) => (
              <span key={i} className="time-chip">
                <input type="time" required value={t} onChange={(e) => setTime(i, e.target.value)} aria-label={`Υπενθύμιση ${i + 1}`} />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => patch({ reminder_times: form.reminder_times.filter((_, j) => j !== i) })}
                  aria-label={`Αφαίρεση υπενθύμισης ${t}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          {form.reminder_times.length < 8 && (
            <div>
              <button type="button" className="btn btn-small" onClick={() => patch({ reminder_times: [...form.reminder_times, '17:00'] })}>
                + Ώρα
              </button>
            </div>
          )}
        </div>
      )}

      <Toggle
        label="Φάε κάτι πριν πεινάσεις πολύ"
        hint="Όταν περάσουν πολλές ώρες από το τελευταίο γεύμα που έγραψες, πριν πέσει η ενέργεια και φας παραπάνω μετά. Δεν έρχεται όταν έχεις καλύψει τον στόχο της μέρας."
        checked={form.energy}
        onChange={(v) => patch({ energy: v })}
      />
      {form.energy && (
        <div className="entry-grid">
          <Field label="Μετά από">
            <select value={form.energy_gap_min} onChange={(e) => patch({ energy_gap_min: Number(e.target.value) })}>
              {[...new Set([...GAPS, form.energy_gap_min])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {hoursLabel(m)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Από">
            <input type="time" required value={form.energy_from} onChange={(e) => patch({ energy_from: e.target.value })} />
          </Field>
          <Field label="Ως">
            <input type="time" required value={form.energy_until} onChange={(e) => patch({ energy_until: e.target.value })} />
          </Field>
        </div>
      )}

      <Toggle
        label="Κίνητρο"
        hint="Μία φορά τη μέρα πώς πήγε η χθεσινή, και όταν πιάνεις ορόσημο ή σταθμό της δίαιτας."
        checked={form.motivation}
        onChange={(v) => patch({ motivation: v })}
      />
      <Toggle label="Σύνοψη εβδομάδας" hint="Κάθε Δευτέρα: έλλειμμα, λίπος και μέρες μέσα στον στόχο της εβδομάδας που πέρασε." checked={form.weekly} onChange={(v) => patch({ weekly: v })} />
      {(form.motivation || form.weekly) && (
        <Field label="Ώρα για κίνητρο και σύνοψη">
          <input type="time" required value={form.motivation_time} onChange={(e) => patch({ motivation_time: e.target.value })} />
        </Field>
      )}

      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() =>
            run(async () => {
              apply(await api<Envelope>('/notifications', { method: 'PUT', body: form }));
              return 'Οι ρυθμίσεις αποθηκεύτηκαν';
            })
          }
        >
          Αποθήκευση
        </button>
      </div>
    </section>
  );
}
