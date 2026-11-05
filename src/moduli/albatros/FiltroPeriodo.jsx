import { giornataDiLavoro, lunediDi, aggiungiGiorni } from './calcolo'

// Scelta del periodo, uguale per Chiusure e Spese: un mese, oppure una settimana da lunedì a
// domenica. Si scorrono con ‹ › come nei moduli di BFM (Cruscotto, Consuntivazione), e "Oggi"
// riporta al periodo corrente. Lo stato lo tiene chi lo usa (vedi periodoIniziale e
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
  const corrente = settimana ? lunedi === lunediDi(oggi) : mese === oggi.slice(0, 7);
  const sposta = (delta) => onChange(settimana
    ? { ...periodo, lunedi: aggiungiGiorni(lunedi, 7 * delta) }
    : { ...periodo, mese: spostaMese(mese, delta) });
  const tornaAOggi = () => onChange(settimana ? { ...periodo, lunedi: lunediDi(oggi) } : { ...periodo, mese: oggi.slice(0, 7) });
  return (
    <div className="albatros-periodo">
      <div className="albatros-filtri-listino" style={{ marginBottom: 0 }}>
        <button type="button" className={`albatros-chip ${!settimana ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'mese' })}>Mese</button>
        <button type="button" className={`albatros-chip ${settimana ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'settimana' })}>Settimana</button>
      </div>
      <div className="albatros-scorri">
        <button type="button" className="btn-icon-action" aria-label={settimana ? 'Settimana prima' : 'Mese prima'} onClick={() => sposta(-1)}>‹</button>
        <span className="albatros-scorri-etichetta">
          {settimana ? `${breve(lunedi)} – ${breve(aggiungiGiorni(lunedi, 6))} ${aggiungiGiorni(lunedi, 6).slice(0, 4)}` : etichettaMese(mese)}
        </span>
        <button type="button" className="btn-icon-action" aria-label={settimana ? 'Settimana dopo' : 'Mese dopo'} onClick={() => sposta(1)}>›</button>
        {!corrente && <button type="button" className="albatros-link" onClick={tornaAOggi}>Oggi</button>}
      </div>
    </div>
  );
}

export default FiltroPeriodo
