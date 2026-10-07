import { categorieDi } from './calcolo'

// Tendina delle categorie di un tipo ('listino' o 'spesa'), lette dal Configuratore. Il valore
// segue idCategoriaScelta (calcolo.js). Una categoria archiviata resta nella tendina solo se è
// quella già assegnata, così modificare una voce vecchia non le cambia categoria di nascosto.
function SceltaCategoria({ categorie, tipo, valore, onChange, className = 'albatros-campo' }) {
  const attive = categorieDi(categorie, tipo);
  const effettivo = valore ?? String(attive[0]?.id ?? '');
  const assegnata = (categorie || []).find(c => String(c.id) === effettivo);
  const opzioni = assegnata && !assegnata.attiva ? [...attive, assegnata] : attive;
  return (
    <select value={effettivo} onChange={(e) => onChange(e.target.value)} className={className}>
      {opzioni.map(c => <option key={c.id} value={String(c.id)}>{c.nome}{c.attiva ? '' : ' (archiviata)'}</option>)}
      <option value="">Senza categoria</option>
    </select>
  );
}

export default SceltaCategoria
