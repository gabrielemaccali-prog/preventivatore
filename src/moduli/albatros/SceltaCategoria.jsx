import { alberoCategorie, foglieCategorie, nomeCategoria } from './calcolo'

// Tendina delle categorie di un tipo ('listino' o 'spesa'), lette dal Configuratore. Il valore
// segue idCategoriaScelta (calcolo.js). Una categoria archiviata resta nella tendina solo se è
// quella già assegnata, così modificare una voce vecchia non le cambia categoria di nascosto.
// Le categorie (delle spese e del listino) sono a due livelli (come nel modulo Spese di BFM): una categoria con
// sottocategorie fa da gruppo, e si sceglie l'ultimo livello.
function SceltaCategoria({ categorie, tipo, valore, onChange, className = 'albatros-campo' }) {
  const sceglibili = foglieCategorie(categorie, tipo);
  const effettivo = valore ?? String(sceglibili[0]?.id ?? '');
  // Quella già assegnata resta in elenco anche se archiviata, o se nel frattempo è diventata un gruppo.
  const assegnata = (categorie || []).find(c => String(c.id) === effettivo);
  const fuoriElenco = assegnata && !sceglibili.some(c => c.id === assegnata.id) ? assegnata : null;
  return (
    <select value={effettivo} onChange={(e) => onChange(e.target.value)} className={className}>
      {fuoriElenco && <option value={String(fuoriElenco.id)}>{nomeCategoria(categorie, fuoriElenco.id)}{fuoriElenco.attiva ? '' : ' (archiviata)'}</option>}
      {alberoCategorie(categorie, tipo).filter(c => !c.gruppo || c.figlie.length).map(c => (c.gruppo
        ? <optgroup key={c.id} label={c.nome}>{c.figlie.map(f => <option key={f.id} value={String(f.id)}>{f.nome}</option>)}</optgroup>
        : <option key={c.id} value={String(c.id)}>{c.nome}</option>))}
      <option value="">Senza categoria</option>
    </select>
  );
}

export default SceltaCategoria
