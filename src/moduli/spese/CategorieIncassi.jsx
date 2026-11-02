import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import EditorCategorie from './EditorCategorie'

// ============================================================
// Le categorie degli incassi generali: quelli che non vengono da una prenotazione né da un voucher
// (capitale versato, una vendita, un rimborso ricevuto). Due livelli, come le spese, e lo stesso
// editor. Si leggono qui perché le usano solo gli Incassi.
// ============================================================

export const leggiCategorieIncassi = () => supabase.from('incassi_categorie').select('id, nome, ordine, attiva, padre_id').order('ordine').order('nome');

function CategorieIncassi({ movimenti }) {
  const [categorie, setCategorie] = useState([]);
  const [errore, setErrore] = useState(null);

  const ricarica = async () => {
    const { data, error } = await leggiCategorieIncassi();
    setErrore(error?.message || null);
    setCategorie(data || []);
  };
  useEffect(() => { ricarica(); }, []);

  if (errore) {
    return <p className="albatros-avviso">Esegui <strong>sql/incassi_banca.sql</strong> e <strong>sql/incassi_categorie_due_livelli.sql</strong> nell'SQL Editor di Supabase. ({errore})</p>;
  }
  return (
    <EditorCategorie
      tabella="incassi_categorie" categorie={categorie} ricarica={ricarica}
      usi={(c) => movimenti.filter(m => m.incasso_categoria_id === c.id).length}
      titolo="Categorie degli incassi generali"
      nota="Due livelli: categoria e sottocategoria (es. Ricavi diversi › Vendite). Un incasso generale va sempre all'ultimo livello. Gli incassi abbinati a una prenotazione o a un voucher sono operativi e non hanno categoria."
    />
  );
}

export default CategorieIncassi
