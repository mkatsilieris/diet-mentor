import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { ErrorBox, Field, Spinner, WarnBox } from './ui';

interface TokenInfo {
  id: number;
  name: string;
  /** the first characters of the token, to tell them apart */
  hint: string;
  scope: 'read' | 'write';
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}
interface TokenList {
  tokens: TokenInfo[];
  lifetimes: number[];
  max: number;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lifetimeLabel = (days: number) => (days === 365 ? '1 χρόνος' : `${days} ημέρες`);

function CopyButton({ text, label = 'Αντιγραφή' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      {done ? 'Αντιγράφηκε ✓' : label}
    </button>
  );
}

/**
 * Personal access tokens: what the person gives to Claude so that it can read and write their
 * diary for them. The token is shown once, right after it is made; the server keeps only its hash.
 */
export function ClaudeCard() {
  const [list, setList] = useState<TokenList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null);

  const serverUrl = `${window.location.origin}/api/mcp`;
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const insecure = window.location.protocol !== 'https:' && !local;

  const load = () =>
    api<TokenList>('/tokens')
      .then(setList)
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/tokens', { method: 'POST', body: { name, scope, days } });
      setFresh(r.token);
      setName('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: TokenInfo) {
    if (!window.confirm(`Ανάκληση του «${t.name}»; Ό,τι το χρησιμοποιεί θα σταματήσει αμέσως να έχει πρόσβαση.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tokens/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!list) {
    return (
      <section className="card stack">
        <h2>Σύνδεση με Claude</h2>
        <ErrorBox error={error} />
        {!error && <Spinner />}
      </section>
    );
  }

  const command = fresh ? `claude mcp add --transport http diet-mentor ${serverUrl} --header "x-api-key: ${fresh}"` : '';

  return (
    <section className="card stack">
      <h2>Σύνδεση με Claude</h2>
      <p className="muted small">
        Φτιάξε ένα token και δώσ' το στο Claude για να γράφει φαγητά και ζυγίσεις, να βλέπει την πρόοδό σου και να κάνει ό,τι κάνεις κι εσύ εδώ, χωρίς να ξέρει
        τον κωδικό σου. Το token είναι σαν κλειδί του λογαριασμού σου: μην το στέλνεις σε άλλους και ανακάλεσέ το αν δεν το χρειάζεσαι πια.
      </p>
      <ErrorBox error={error} />
      {insecure && <WarnBox>Η σελίδα δεν είναι σε https. Χρησιμοποίησε το token μόνο με τη διεύθυνση https της εφαρμογής, αλλιώς ταξιδεύει χωρίς κρυπτογράφηση.</WarnBox>}

      {fresh && (
        <div className="push-box stack">
          <div className="toggle-label">Το νέο σου token</div>
          <p className="small">Αντίγραψέ το τώρα. Δεν θα εμφανιστεί ξανά· αν το χάσεις, ανακάλεσέ το και φτιάξε άλλο.</p>
          <code className="token-secret">{fresh}</code>
          <div className="row gap wrap">
            <CopyButton text={fresh} label="Αντιγραφή token" />
            <CopyButton text={command} label="Αντιγραφή εντολής για Claude Code" />
            <button type="button" className="btn btn-small" onClick={() => setFresh(null)}>
              Το αποθήκευσα
            </button>
          </div>
          <p className="muted small">
            Διεύθυνση server: <code>{serverUrl}</code>
          </p>
        </div>
      )}

      {list.tokens.length > 0 && (
        <ul className="token-list">
          {list.tokens.map((t) => (
            <li key={t.id} className="row between">
              <div>
                <div className="toggle-label">{t.name}</div>
                <div className="muted small">
                  <code>{t.hint}…</code> · {t.scope === 'read' ? 'μόνο ανάγνωση' : 'ανάγνωση και αλλαγές'} · λήγει {date(t.expires_at)}
                </div>
                <div className="muted small">{t.last_used_at ? `Τελευταία χρήση ${dateTime(t.last_used_at)}` : 'Δεν έχει χρησιμοποιηθεί ακόμη'}</div>
              </div>
              <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void revoke(t)}>
                Ανάκληση
              </button>
            </li>
          ))}
        </ul>
      )}

      {list.tokens.length < list.max && (
        <form onSubmit={create} className="stack">
          <Field label="Όνομα" hint="Για να θυμάσαι πού το έβαλες, π.χ. «Claude στο laptop»">
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label="Τι επιτρέπεται">
              <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}>
                <option value="write">Ανάγνωση και αλλαγές</option>
                <option value="read">Μόνο ανάγνωση</option>
              </select>
            </Field>
            <Field label="Διάρκεια">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {list.lifetimes.map((d) => (
                  <option key={d} value={d}>
                    {lifetimeLabel(d)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <button className="btn btn-primary" disabled={busy || !name.trim()}>
              Δημιουργία token
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
