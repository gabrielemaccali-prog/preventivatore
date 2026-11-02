import { useState } from 'react'
import Icona from '../../components/Icona'
import EditorCategorie from './EditorCategorie'
import CategorieIncassi from './CategorieIncassi'

// ============================================================
// Configuratore delle spese: le categorie delle spese generali di BFM e quelle degli incassi
// generali, tutte e due su due livelli (categoria e sottocategoria). Una spesa o un incasso si
// attribuisce all'ultimo livello: a una sottocategoria, o a una categoria che non ne ha. Si
// aggiungono, si rinominano, si ordinano fra sorelle. Una voce usata non si cancella: si archivia, e
// sparisce dalle scelte. L'editor è lo stesso per le due tabelle.
// Le categorie delle spese di Albatros sono quelle di Albatros, e si cambiano dal suo Configuratore.
// ============================================================

function Configuratore({ categorie, spese, regole, movimenti, ricaricaConfigurazione, sottoIniziale }) {
  // Due sottoschede: le categorie delle spese e quelle degli incassi.
  const [sotto, setSotto] = useState(sottoIniziale || 'spese');
  return (
    <div className="albatros-pagina no-print">
      {/* Come le sottoschede degli altri moduli: larghe quanto il loro contenuto, con l'icona. */}
      <nav className="modulo-subnav subnav-segmented" style={{ margin: 0, alignSelf: 'flex-start' }}>
        <button type="button" className={`nav-btn ${sotto === 'spese' ? 'active' : ''}`} onClick={() => setSotto('spese')}><Icona nome="spese" />Categorie spese</button>
        <button type="button" className={`nav-btn ${sotto === 'incassi' ? 'active' : ''}`} onClick={() => setSotto('incassi')}><Icona nome="cashflow" />Categorie incassi</button>
      </nav>
      {sotto === 'incassi' && <CategorieIncassi movimenti={movimenti} />}
      {sotto === 'spese' && (
        <EditorCategorie
          tabella="spese_categorie" categorie={categorie} ricarica={ricaricaConfigurazione}
          usi={(c) => spese.filter(s => s.categoria_id === c.id).length + regole.filter(r => r.categoria_id === c.id).length}
          titolo="Categorie delle spese generali"
          nota="Due livelli: categoria e sottocategoria (es. Struttura › Magazzino/box). Una spesa va sempre all'ultimo livello. Le spese operative (compensi, campi, fornitori) non hanno categoria; quelle di Albatros usano le categorie di Albatros."
        />
      )}
    </div>
  );
}

export default Configuratore
