import { giornataDiLavoro, lunediDi, aggiungiGiorni } from './calcolo'

// Scelta del periodo, uguale per Chiusure, Spese e Incassi: una settimana da lunedì a domenica,
// un mese o un anno. Si scorrono con ‹ › come nei moduli di BFM (Cruscotto, Consuntivazione), e
// "Oggi" riporta al periodo corrente. Lo stato lo tiene chi lo usa (vedi periodoIniziale e
// intervalloPeriodo in calcolo.js).
const breve = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const etichettaMese = (mese) => {
  const [a, m] = mese.split('-').map(Number);
  const testo = new Date(a, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return testo.charAt(0).toUpperCase() + testo.slice(1);
};
const spostaMese = (mese, delta) => {
  const [a, m] = mese.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function FiltroPeriodo({ periodo, onChange }) {
  const { tipo, mese, lunedi } = periodo;
  const oggi = giornataDiLavoro();
  const settimana = tipo === 'settimana';
  const annuale = tipo === 'anno';
  // Un periodo salvato prima che ci fosse l'anno non ce l'ha: si parte da quello del mese.
  const anno = periodo.anno || mese.slice(0, 4);
  const corrente = settimana ? lunedi === lunediDi(oggi) : annuale ? anno === oggi.slice(0, 4) : mese === oggi.slice(0, 7);
  const sposta = (delta) => onChange(settimana
    ? { ...periodo, lunedi: aggiungiGiorni(lunedi, 7 * delta) }
    : annuale ? { ...periodo, anno: String(Number(anno) + delta) }
      : { ...periodo, mese: spostaMese(mese, delta) });
  const tornaAOggi = () => onChange(settimana ? { ...periodo, lunedi: lunediDi(oggi) }
    : annuale ? { ...periodo, anno: oggi.slice(0, 4) } : { ...periodo, mese: oggi.slice(0, 7) });
  return (
    <div className="albatros-periodo">
      <div className="albatros-filtri-listino" style={{ marginBottom: 0 }}>
        <button type="button" className={`albatros-chip ${annuale ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'anno', anno })}>Anno</button>
        <button type="button" className={`albatros-chip ${tipo === 'mese' ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'mese' })}>Mese</button>
        <button type="button" className={`albatros-chip ${settimana ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'settimana' })}>Settimana</button>
      </div>
      <div className="albatros-scorri">
        <button type="button" className="btn-icon-action" aria-label={settimana ? 'Settimana prima' : annuale ? 'Anno prima' : 'Mese prima'} onClick={() => sposta(-1)}>‹</button>
        <span className="albatros-scorri-etichetta">
          {settimana ? `${breve(lunedi)} – ${breve(aggiungiGiorni(lunedi, 6))} ${aggiungiGiorni(lunedi, 6).slice(0, 4)}` : annuale ? anno : etichettaMese(mese)}
        </span>
        <button type="button" className="btn-icon-action" aria-label={settimana ? 'Settimana dopo' : annuale ? 'Anno dopo' : 'Mese dopo'} onClick={() => sposta(1)}>›</button>
        {!corrente && <button type="button" className="albatros-link" onClick={tornaAOggi}>Oggi</button>}
      </div>
    </div>
  );
}

export default FiltroPeriodo
