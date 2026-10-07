import { giornataDiLavoro, lunediDi, aggiungiGiorni } from './calcolo'

// Scelta del periodo, uguale per Chiusure e Spese: un mese, oppure una settimana da lunedì a
// domenica da scorrere con ‹ ›. Lo stato lo tiene chi lo usa (vedi periodoIniziale e
// intervalloPeriodo in calcolo.js).
const breve = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

function FiltroPeriodo({ periodo, onChange }) {
  const { tipo, mese, lunedi } = periodo;
  const questoLunedi = lunediDi(giornataDiLavoro());
  return (
    <div className="albatros-periodo">
      <div className="albatros-filtri-listino" style={{ marginBottom: 0 }}>
        <button type="button" className={`albatros-chip ${tipo === 'mese' ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'mese' })}>Mese</button>
        <button type="button" className={`albatros-chip ${tipo === 'settimana' ? 'attivo' : ''}`} onClick={() => onChange({ ...periodo, tipo: 'settimana' })}>Settimana</button>
      </div>
      {tipo === 'mese' ? (
        <input type="month" value={mese} onChange={(e) => e.target.value && onChange({ ...periodo, mese: e.target.value })} className="albatros-campo" style={{ width: 'auto' }} />
      ) : (
        <div className="albatros-scorri">
          <button type="button" className="btn-icon-action" aria-label="Settimana prima" onClick={() => onChange({ ...periodo, lunedi: aggiungiGiorni(lunedi, -7) })}>‹</button>
          <span>{breve(lunedi)} – {breve(aggiungiGiorni(lunedi, 6))} {aggiungiGiorni(lunedi, 6).slice(0, 4)}</span>
          <button type="button" className="btn-icon-action" aria-label="Settimana dopo" onClick={() => onChange({ ...periodo, lunedi: aggiungiGiorni(lunedi, 7) })}>›</button>
          {lunedi !== questoLunedi && <button type="button" className="albatros-link" onClick={() => onChange({ ...periodo, lunedi: questoLunedi })}>Questa settimana</button>}
        </div>
      )}
    </div>
  );
}

export default FiltroPeriodo
