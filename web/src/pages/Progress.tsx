import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { dayShort, days, int, kcal, mass, monthLabel, pct, signedKcal, signedKg } from '../format';
import type { Aggregate, Summary } from '../types';
import { DeficitChart, WeightChart } from '../components/charts';
import { ErrorBox, Spinner } from '../components/ui';
import { ProgressBar, SetupPrompt, Stat } from '../components/widgets';

const tone = (n: number): 'pos' | 'neg' | undefined => (n > 0 ? 'pos' : n < 0 ? 'neg' : undefined);

function PeriodTable({ rows, label, name }: { rows: Aggregate[]; label: string; name: (a: Aggregate) => string }) {
  const shown = rows.filter((a) => a.loggedDays > 0);
  if (shown.length === 0) return <p className="muted small">Δεν υπάρχουν ακόμη ολοκληρωμένες μέρες με καταγραφή.</p>;
  return (
    <div className="table-scroll">
      <table className="table periods">
        <thead>
          <tr>
            <th>{label}</th>
            <th className="num">Μέρες</th>
            <th className="num">Έλλειμμα</th>
            <th className="num">Μ.Ο./μέρα</th>
            <th className="num">Λίπος</th>
            <th className="num">Γλυκογόνο</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr key={a.from}>
              <td>{name(a)}</td>
              <td className="num">{a.loggedDays}</td>
              <td className={`num ${tone(a.deficit) ?? ''}`}>{signedKcal(a.deficit)}</td>
              <td className="num">{signedKcal(a.avgDeficit)}</td>
              <td className="num">{signedKg(-a.fatKg)}</td>
              <td className="num">{signedKg(a.glycogenKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Deficit per day, week and month, what the glycogen is doing, the scale against the model, and what was achieved. */
export default function Progress() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Summary>('/summary')
      .then(setSummary)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!summary) return <Spinner full />;
  if (!summary.ready) {
    return (
      <div className="page">
        <SetupPrompt />
      </div>
    );
  }

  const { periods, glycogen, motivation, diet } = summary;
  const last30 = summary.days.slice(-31, -1); // finished days only
  const yesterday = summary.days.length >= 2 ? summary.days[summary.days.length - 2] : null;
  // the scale against the model: over the running diet, otherwise over the last 30 days
  const weightRows = diet ? summary.days.filter((r) => r.day >= diet.diet.started_on) : summary.days.slice(-30);
  const period = (label: string, a: Aggregate) => (
    <Stat
      label={label}
      tone={tone(a.deficit)}
      value={a.loggedDays ? signedKcal(a.deficit) : '—'}
      sub={a.loggedDays ? `${days(a.loggedDays)} · λίπος ${signedKg(-a.fatKg)}` : 'καμία μέρα με καταγραφή'}
    />
  );

  return (
    <div className="page">
      <h1>Πρόοδος</h1>

      <section className="stack">
        <div className="stat-grid">
          <Stat
            label="Χθες"
            tone={yesterday?.counted ? tone(yesterday.deficit) : undefined}
            value={yesterday?.counted ? signedKcal(yesterday.deficit) : '—'}
            sub={yesterday?.counted ? `έφαγες ${kcal(yesterday.intake)}` : 'χωρίς καταγραφή'}
          />
          {period('Αυτή η εβδομάδα', periods.week)}
          {period('Αυτός ο μήνας', periods.month)}
          {period('Τελευταίες 30 μέρες', periods.last30)}
        </div>
        <p className="muted small">
          Έλλειμμα = θερμίδες συντήρησης − θερμίδες που έφαγες. Θετικό σημαίνει ότι έφαγες λιγότερο από όσο καις. Μετράνε οι μέρες που
          έχουν τελειώσει και έχουν καταγραφή· η σημερινή μπαίνει αύριο.
        </p>
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Έλλειμμα ανά ημέρα</h2>
          <span className="muted small">30 μέρες, kcal</span>
        </div>
        <DeficitChart rows={last30} />
        <p className="muted small">
          Πάνω από τη γραμμή: έφαγες λιγότερο από τη συντήρηση. Κάτω: περισσότερο. Κενό: μέρα χωρίς καταγραφή.
          {diet ? ' Η διακεκομμένη είναι το έλλειμμα που ζητά η δίαιτα.' : ''}
        </p>
      </section>

      <section className="card stack">
        <h2>Ανά εβδομάδα</h2>
        <PeriodTable rows={summary.weeks} label="Εβδομάδα" name={(a) => `${dayShort(a.from)}–${dayShort(a.to)}`} />
      </section>

      <section className="card stack">
        <h2>Ανά μήνα</h2>
        <PeriodTable rows={summary.months} label="Μήνας" name={(a) => monthLabel(a.from)} />
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Γλυκογόνο</h2>
          <span className="muted small">εκτίμηση</span>
        </div>
        <ProgressBar value={glycogen.levelPct} label="Απόθεμα γλυκογόνου" />
        <div className="stat-grid">
          <Stat label="Απόθεμα" value={pct(glycogen.levelPct)} sub={`${int(glycogen.storeG)} από ${int(glycogen.capacityG)} g`} />
          <Stat
            label="Επίδραση στη ζυγαριά"
            value={signedKg(glycogen.scaleKg)}
            sub="γλυκογόνο μαζί με το νερό του, σε σχέση με γεμάτο απόθεμα"
          />
          {diet && <Stat label="Στη δίαιτα ως τώρα" value={signedKg(diet.totals.glycogenKg)} sub={`λίπος ${signedKg(-diet.totals.fatKg)}`} />}
        </div>
        <p className="muted small">
          Το σώμα κρατά περίπου μισό κιλό υδατάνθρακα (γλυκογόνο) σε μυς και συκώτι, και κάθε γραμμάριο δένει περίπου 3 g νερό. Όταν τρως
          κάτω από τη συντήρηση το απόθεμα αδειάζει μέσα σε λίγες μέρες: η ζυγαριά πέφτει γρήγορα, αλλά αυτό δεν είναι λίπος. Όταν φας ξανά
          κανονικά γεμίζει και η ζυγαριά ανεβαίνει, χωρίς να έχεις βάλει λίπος. Γι' αυτό το έλλειμμα που κάλυψε το γλυκογόνο δεν μετριέται
          ως λίπος, και η «αναμενόμενη ζυγαριά» παρακάτω το περιλαμβάνει. Αν γράφεις υδατάνθρακες σε όλες τις καταχωρίσεις μιας μέρας, η
          εκτίμηση βασίζεται σε αυτούς αντί για τις θερμίδες.
        </p>
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>Ζυγαριά και αναμενόμενο βάρος</h2>
          <span className="muted small">{diet ? 'από την αρχή της δίαιτας' : '30 μέρες'}</span>
        </div>
        <WeightChart rows={weightRows} />
        <p className="muted small">
          Η γραμμή ξεκινά από το βάρος της πρώτης μέρας και ακολουθεί τις θερμίδες σου. Αν οι ζυγίσεις μένουν σταθερά πάνω από τη γραμμή,
          μάλλον τρως περισσότερο από όσο γράφεις ή κινείσαι λιγότερο από όσο δήλωσες.
        </p>
      </section>

      <section className="card stack">
        <h2>Τι έχεις πετύχει</h2>
        <div className="stat-grid">
          <Stat label="Μέρες καταγραφής στη σειρά" value={motivation.streaks.log} sub={`ρεκόρ ${motivation.streaks.bestLog}`} />
          <Stat label="Μέρες στη σειρά μέσα στον στόχο" value={motivation.streaks.target} sub={`ρεκόρ ${motivation.streaks.bestTarget}`} />
          <Stat
            label="Συνολικό έλλειμμα"
            tone={tone(motivation.totalDeficit)}
            value={signedKcal(motivation.totalDeficit)}
            sub={`σε ${days(motivation.loggedDays)} καταγραφής`}
          />
          <Stat
            label="Λίπος που έχεις κάψει"
            value={motivation.totalFatKg > 0 ? mass(motivation.totalFatKg) : '—'}
            sub={motivation.butterPacks >= 1 ? `όσο ${int(motivation.butterPacks)} πακέτα βούτυρο των 250 g` : undefined}
          />
          {diet?.adherencePct != null && (
            <Stat label="Μέρες μέσα στον στόχο (δίαιτα)" value={pct(diet.adherencePct)} sub={`${diet.totals.onTargetDays} από ${diet.totals.loggedDays}`} />
          )}
          <Stat label="Δίαιτες που ολοκλήρωσες" value={motivation.dietsCompleted} />
        </div>
        <ul className="milestones">
          {motivation.milestones.map((m) => (
            <li key={m.key} className={m.done ? 'done' : ''}>
              <span aria-hidden="true">{m.done ? '★' : '☆'}</span>
              <span>{m.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
